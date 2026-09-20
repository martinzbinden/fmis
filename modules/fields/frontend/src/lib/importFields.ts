import JSZip from 'jszip'
import { parseShp, parseDbf, combine } from 'shpjs'
import proj4 from 'proj4'
import { getDb } from '../db/pglite'
import { upsertRow } from '../db/write'
import { num } from './format'

// CH1903+/LV95 (EPSG:2056), amtliche Projektionsdefinition (Swiss Oblique
// Mercator), Parameter gegen die .prj-Dateien im Export verifiziert.
// shpjs bekommt bewusst KEINE .prj übergeben (siehe extractLayers) — wir
// reprojizieren explizit selbst, um sicherzugehen, dass diese für die
// Schweiz etwas ungewöhnliche Projektion korrekt behandelt wird (siehe
// Plan-Notiz zur Verifikation gegen die bekannte Lage in Kanton Bern).
const CH1903_LV95 =
  '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 ' +
  '+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel ' +
  '+towgs84=674.4,15.1,405.3,0,0,0,0 +units=m +no_defs'

const LAYER_NAMES = [
  'betrieb_betrieb',
  'betrieb_bewirtschaftungseinheit',
  'lnf_nutzung_flaeche',
  'lnf_nutzung_punkt',
] as const
type LayerName = (typeof LAYER_NAMES)[number]

interface Feature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown } | null
}
interface FeatureCollection {
  type: 'FeatureCollection'
  features: Feature[]
}

function findZipEntry(zip: JSZip, filename: string): JSZip.JSZipObject | null {
  const matches = zip.file(new RegExp(`(^|/)${filename}$`, 'i'))
  return matches[0] ?? null
}

function reprojectPoint([x, y]: [number, number]): [number, number] {
  return proj4(CH1903_LV95, proj4.WGS84, [x, y]) as [number, number]
}

function mapCoordinates(coords: unknown): unknown {
  if (Array.isArray(coords) && typeof coords[0] === 'number') {
    return reprojectPoint(coords as [number, number])
  }
  if (Array.isArray(coords)) {
    return coords.map(mapCoordinates)
  }
  return coords
}

function reprojectFeatureCollection(fc: FeatureCollection): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      geometry: f.geometry ? { ...f.geometry, coordinates: mapCoordinates(f.geometry.coordinates) } : null,
    })),
  }
}

/**
 * Liest die 4 bekannten Shapefile-Layer direkt aus dem hochgeladenen
 * Raumdatenexport-ZIP (Struktur `ESRISHAPE_1/shapefile/<layer>.{shp,dbf}`).
 * Bewusst NICHT shpjs' eigene Ganzes-ZIP-Erkennung (shp(buffer)) genutzt:
 * das ZIP enthält zusätzlich einen GEOPACKAGE_1/-Ordner mit einer .gpkg-
 * Datei, und wir wollen exakt kontrollieren, welche 4 Layer wie gelesen
 * werden, statt uns auf Auto-Erkennung zu verlassen.
 */
async function extractLayers(file: File): Promise<Partial<Record<LayerName, FeatureCollection>>> {
  const zip = await JSZip.loadAsync(file)
  const result: Partial<Record<LayerName, FeatureCollection>> = {}
  for (const layer of LAYER_NAMES) {
    const shpEntry = findZipEntry(zip, `${layer}.shp`)
    const dbfEntry = findZipEntry(zip, `${layer}.dbf`)
    if (!shpEntry || !dbfEntry) continue
    const [shpBuf, dbfBuf] = await Promise.all([
      shpEntry.async('arraybuffer'),
      dbfEntry.async('arraybuffer'),
    ])
    const geometries = parseShp(shpBuf)
    // DBF-Feldnamen der echten Exporte sind ohne Leerzeichen (Unterstrich)
    // und auf 10 Zeichen abgeschnitten (DBF-Spezifikation), z.B. "ID Kultur"
    // → "ID_Kultur", "Kultur_Name" → "Kultur_Nam" — siehe field() unten,
    // das robust gegen beide Schreibweisen ist. Kein .cpg im Export
    // enthalten; die Textfelder sind windows-1252-kodiert (gegen die
    // Umlaute/Accents in Kultur_Name verifiziert, z.B. "pâturages").
    const properties = parseDbf(dbfBuf, 'windows-1252')
    const collection = combine([geometries, properties]) as FeatureCollection
    result[layer] = reprojectFeatureCollection(collection)
  }
  return result
}

/**
 * Liest ein Attribut robust gegen beide Schreibweisen: DBF-Feldnamen sind
 * ohne Leerzeichen (Unterstrich statt Space) und auf 10 Zeichen
 * abgeschnitten (z.B. "ID Kultur" → "ID_Kultur", "Kultur_Name" →
 * "Kultur_Nam"); GDAL/ogrinfo zeigt dagegen die "schönen" Namen mit
 * Leerzeichen. Erster übergebener Name, der im Objekt existiert, gewinnt.
 */
function field(props: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (props[name] !== undefined) return props[name]
  }
  return undefined
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function int(v: unknown): number | null {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

/** `Kultur_Name`-Feld: `[{"Language":"de","Text":"..."},{"Language":"fr","Text":"..."}]`. */
function parseKulturName(v: unknown): { de: string | null; fr: string | null } {
  try {
    const entries = JSON.parse(String(v)) as { Language: string; Text: string }[]
    return {
      de: entries.find((e) => e.Language === 'de')?.Text ?? null,
      fr: entries.find((e) => e.Language === 'fr')?.Text ?? null,
    }
  } catch {
    return { de: null, fr: null }
  }
}

export interface ImportSummary {
  farmsImported: number
  managementUnitsImported: number
  fieldDeclarationsImported: number
  warnings: string[]
}

async function loadExistingIds(
  pg: Awaited<ReturnType<typeof getDb>>,
  table: string,
  keyColumns: string[],
): Promise<Map<string, string>> {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select id, ${keyColumns.map((c) => `"${c}"`).join(', ')} from "${table}" where deleted_at is null`,
  )
  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(keyColumns.map((c) => String(row[c] ?? '')).join('|'), row.id as string)
  }
  return map
}

export async function importFieldsZips(files: File[]): Promise<ImportSummary> {
  const pg = await getDb()
  const summary: ImportSummary = {
    farmsImported: 0,
    managementUnitsImported: 0,
    fieldDeclarationsImported: 0,
    warnings: [],
  }

  const farmsByUid = await loadExistingIds(pg, 'farms', ['external_uid'])
  const unitsByKey = await loadExistingIds(pg, 'management_units', ['farm_id', 'external_id', 'jahr'])
  const declByKey = await loadExistingIds(pg, 'field_declarations', [
    'farm_id',
    'external_kultur_id',
    'jahr',
    'sequence_in_year',
  ])
  // Für die lineage_id-Vererbung: irgendeine bisherige Zeile mit derselben
  // (farm_id, external_kultur_id) unabhängig vom Jahr finden.
  const { rows: lineageRows } = await pg.query<{ farm_id: string; external_kultur_id: string; lineage_id: string }>(
    `select farm_id, external_kultur_id, lineage_id from field_declarations
     where deleted_at is null and external_kultur_id is not null`,
  )
  const lineageByKultur = new Map<string, string>()
  for (const r of lineageRows) {
    lineageByKultur.set(`${r.farm_id}|${r.external_kultur_id}`, r.lineage_id)
  }

  for (const file of files) {
    const layers = await extractLayers(file)
    const betriebFeature = layers.betrieb_betrieb?.features[0]
    if (!betriebFeature) {
      summary.warnings.push(`${file.name}: Layer "betrieb_betrieb" nicht gefunden — Datei übersprungen.`)
      continue
    }

    const p = betriebFeature.properties
    const uid = str(field(p, 'UID'))
    if (!uid) {
      summary.warnings.push(`${file.name}: Betrieb ohne UID — Datei übersprungen.`)
      continue
    }
    const farmId = farmsByUid.get(uid) ?? crypto.randomUUID()
    farmsByUid.set(uid, farmId)
    await upsertRow('farms', {
      id: farmId,
      external_uid: uid,
      bur_nr: str(field(p, 'BUR_NR')),
      name: str(field(p, 'Name')) ?? uid,
    })
    summary.farmsImported++

    for (const feature of layers.betrieb_bewirtschaftungseinheit?.features ?? []) {
      const up = feature.properties
      const externalId = str(field(up, 'ID_BewE', 'ID BewE'))
      const jahr = int(field(up, 'JAHR'))
      if (!externalId || jahr == null) {
        summary.warnings.push(`${file.name}: Bewirtschaftungseinheit ohne ID/Jahr übersprungen.`)
        continue
      }
      const key = `${farmId}|${externalId}|${jahr}`
      const id = unitsByKey.get(key) ?? crypto.randomUUID()
      unitsByKey.set(key, id)
      await upsertRow('management_units', {
        id,
        farm_id: farmId,
        external_id: externalId,
        jahr,
        gemeinde_bfs_nr: str(field(up, 'Gemeinde')),
        zone: str(field(up, 'Zone')),
        name: str(field(up, 'Name_BewE', 'Name BewE')),
        area_total_a: num(field(up, 'Fl_Total', 'Fl Total')),
        area_unprod_a: num(field(up, 'Fl_Unprod', 'Fl Unprod')),
        area_wald_a: num(field(up, 'Fl_Wald', 'Fl Wald')),
        area_land_a: num(field(up, 'Fl_Land', 'Fl Land')),
      })
      summary.managementUnitsImported++
    }

    const declFeatures = [
      ...(layers.lnf_nutzung_flaeche?.features ?? []),
      ...(layers.lnf_nutzung_punkt?.features ?? []),
    ]
    for (const feature of declFeatures) {
      const fp = feature.properties
      const externalKulturId = str(field(fp, 'ID_Kultur', 'ID Kultur'))
      const jahr = int(field(fp, 'Jahr'))
      const kulturCode = str(field(fp, 'Kultur'))
      if (!kulturCode || jahr == null) {
        summary.warnings.push(`${file.name}: Kulturfläche ohne Kultur-Code/Jahr übersprungen.`)
        continue
      }
      const sequenceInYear = 1
      const declKey = `${farmId}|${externalKulturId ?? ''}|${jahr}|${sequenceInYear}`
      const id = declByKey.get(declKey) ?? crypto.randomUUID()
      declByKey.set(declKey, id)

      const lineageKey = externalKulturId ? `${farmId}|${externalKulturId}` : null
      const lineageId = (lineageKey && lineageByKultur.get(lineageKey)) || crypto.randomUUID()
      if (lineageKey) lineageByKultur.set(lineageKey, lineageId)

      const { de, fr } = parseKulturName(field(fp, 'Kultur_Nam', 'Kultur_Name'))
      await upsertRow('field_declarations', {
        id,
        farm_id: farmId,
        lineage_id: lineageId,
        management_unit_external_id: str(field(fp, 'ID_BewE', 'ID BewE')),
        external_kultur_id: externalKulturId,
        jahr,
        sequence_in_year: sequenceInYear,
        kultur_code: kulturCode,
        kultur_name_de: de,
        kultur_name_fr: fr,
        flurname: str(field(fp, 'Flurname')),
        area_a: num(field(fp, 'Fl_Land', 'Fl Land')),
        baeume: int(field(fp, 'Baeume')),
        geometry: feature.geometry ? JSON.stringify(feature.geometry) : null,
        source: 'import',
      })
      summary.fieldDeclarationsImported++
    }
  }

  return summary
}
