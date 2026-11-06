import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import NumberInput from '@fmis/core/NumberInput'
import { fmtNum } from '@fmis/core/yearSummary'
import { useQuery } from '../hooks/useQuery'
import { dpCropName, DP_DEFAULTS, DP_LINE_LABEL, DP_RATES, estimateFarm, type DpParcel, type DpParcelEstimate, type DpSettings } from '../lib/directPayments'
import { cropLabel } from '../lib/rotationRules'

const YEAR = 2026
const PREF = 'fmis:fields:direktzahlungen'
const HANG_LABEL = ['18–35 %', 'über 35–50 %', 'über 50 %']
// Vorbelegung auf dieser Instanz, je Betrieb abwählbar
const SETTINGS_START: DpSettings = { ...DP_DEFAULTS, bio: true, gmf: true }

type Row = DpParcel & { farm_id: string }

async function loadData(pg: PGlite) {
  const { rows } = await pg.query<Row>(
    `select d.id, d.lineage_id, d.farm_id, d.flurname, d.kultur_code, d.kultur_name_de,
            d.area_a::float8 as area_a, d.baeume::float8 as baeume, mu.zone
     from field_declarations d
     left join management_units mu on mu.farm_id = d.farm_id and mu.external_id = d.management_unit_external_id
       and mu.jahr = d.jahr and mu.deleted_at is null
     where d.deleted_at is null and d.jahr = $1 and d.sequence_in_year = 1 and d.source = 'import'`,
    [YEAR],
  )
  const { rows: farms } = await pg.query<{ id: string; name: string }>('select id, name from farms where deleted_at is null order by name')
  return { rows, farms }
}

// Angaben je Betrieb, nur auf diesem Gerät
function loadPrefs(): Record<string, Partial<DpSettings>> {
  try {
    return JSON.parse(localStorage.getItem(PREF) ?? '{}') as Record<string, Partial<DpSettings>>
  } catch {
    return {}
  }
}
function savePrefs(p: Record<string, Partial<DpSettings>>) {
  try {
    localStorage.setItem(PREF, JSON.stringify(p))
  } catch {
    /* privates Fenster: dann eben nicht gemerkt */
  }
}

const fr = (v: number) => `${fmtNum(v, 0)} Fr.`
const rp = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function DirectPayments() {
  // Betriebszahlen: nicht für die Rolle Mitarbeit
  const allowed = useHasPermission('fields:fields:write')
  const { data } = useQuery(loadData)
  const [prefs, setPrefsState] = useState(loadPrefs)
  const [farmId, setFarmId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const farmsWithData = useMemo(() => (data?.farms ?? []).filter((f) => data?.rows.some((r) => r.farm_id === f.id)), [data])
  const farm = farmsWithData.find((f) => f.id === farmId) ?? farmsWithData[0]
  const saved = farm ? prefs[farm.id] : undefined
  // q2 war in der ersten Fassung eine Liste
  const settings: DpSettings = { ...SETTINGS_START, ...saved, q2: saved?.q2 && !Array.isArray(saved.q2) ? saved.q2 : {} }
  const estimate = useMemo(
    () => (farm && data ? estimateFarm(DP_RATES[YEAR], data.rows.filter((r) => r.farm_id === farm.id), settings) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [farm, data, prefs],
  )

  if (!allowed) return <p className="p-6 text-center text-gray-500">Diese Seite ist der Betriebsleitung und dem Büro vorbehalten.</p>
  if (!data) return <p className="p-6 text-center text-gray-500">Lädt…</p>
  if (!farm || !estimate) {
    return <div className="p-6 text-center text-gray-500">Keine Parzellen für {YEAR} — zuerst unter «Karte» Raumdaten importieren.</div>
  }

  const update = (p: Partial<DpSettings>) => {
    const next = { ...prefs, [farm.id]: { ...settings, ...p } }
    setPrefsState(next)
    savePrefs(next)
  }
  const setQ2 = (lineage: string, value: number) => update({ q2: { ...settings.q2, [lineage]: value } })

  const q = search.trim().toLowerCase()
  const parcels = estimate.parcels
    .filter((p) => !q || `${p.parcel.flurname ?? ''} ${p.parcel.kultur_name_de ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.parcel.flurname ?? '￿').localeCompare(b.parcel.flurname ?? '￿', 'de') || b.total - a.total)
  const offene = estimate.parcels.filter((p) => p.offen)
  const belowStock = settings.rgve != null && estimate.factor < 1

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Direktzahlungen {YEAR}</h1>
        <p className="text-sm text-gray-600">Schätzung nach DZV Anhang 7. Massgebend ist die Abrechnung des Kantons.</p>
      </div>

      {farmsWithData.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Betrieb">
          {farmsWithData.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={f.id === farm.id}
              onClick={() => {
                setFarmId(f.id)
                setOpen(null)
              }}
              className={`min-h-11 rounded-full px-4 text-sm font-medium ${f.id === farm.id ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 shadow-sm'}`}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-gray-800">{farm.name}</h2>
          <span className="text-sm text-gray-500">{fmtNum(estimate.lnHa, 1)} ha</span>
        </div>
        <div className="mt-1 text-3xl font-bold tabular-nums text-gray-900">≈ {fr(estimate.total)}</div>
        <p className="text-xs text-gray-500">pro Jahr, nur die unten aufgeführten Beiträge</p>
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {estimate.lines.map((l) => (
              <tr key={l.key}>
                <td className="py-1.5 pr-2 text-gray-700">{DP_LINE_LABEL[l.key]}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-900">{fr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {offene.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            Nicht eingerechnet: {fmtNum(estimate.offenHa, 2)} ha ohne klare Zuordnung
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {offene.map((p) => (
              <li key={p.parcel.id}>
                {p.parcel.flurname || `Code ${p.parcel.kultur_code}`}, {fmtNum(p.ha * 100, 2)} a: {p.offen}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-lg bg-white shadow-sm" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-gray-700">Angaben zum Betrieb</summary>
        <div className="space-y-3 border-t px-3 py-3 text-sm">
          <div className="flex flex-wrap gap-x-5">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={settings.bio} onChange={(e) => update({ bio: e.target.checked })} />
              Bio-Betrieb
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={settings.gmf} onChange={(e) => update({ gmf: e.target.checked })} />
              Teilnahme GMF
            </label>
          </div>
          <label className="block">
            <span className="font-medium text-gray-700">RGVE im Betrieb</span>
            <NumberInput
              value={settings.rgve ?? ''}
              onChange={(e) => update({ rgve: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="nicht angegeben"
              className="mt-1 block min-h-11 w-40 rounded-lg border-2 border-gray-300 px-2"
            />
            <span className={`mt-1 block text-xs ${belowStock ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
              Mindesttierbesatz {fmtNum(estimate.rgveMin, 1)} RGVE.{' '}
              {settings.rgve == null
                ? 'Ohne Angabe gilt er als erreicht.'
                : belowStock
                  ? `Nicht erreicht: Dauergrünland nur zu ${fmtNum(estimate.factor * 100, 0)} %.`
                  : 'Erreicht.'}
            </span>
          </label>
          <fieldset>
            <legend className="font-medium text-gray-700">Hanglagen in ha</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {HANG_LABEL.map((label, i) => (
                <label key={label} className="block text-xs text-gray-600">
                  {label}
                  <NumberInput
                    value={settings.hang[i] || ''}
                    onChange={(e) => {
                      const hang = [...settings.hang] as DpSettings['hang']
                      hang[i] = Number(e.target.value) || 0
                      update({ hang })
                    }}
                    placeholder="0"
                    className="mt-1 block min-h-11 w-full rounded-lg border-2 border-gray-300 px-2 text-sm"
                  />
                </label>
              ))}
            </div>
            <p className={`mt-1 text-xs ${estimate.hangZuKlein ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
              {estimate.hangZuKlein ? 'Unter 50 a Hanglagen gibt es keinen Beitrag. ' : ''}
              Weiden, Reben und Hecken zählen nicht.
            </p>
          </fieldset>
          <p className="text-xs text-gray-500">Diese Angaben und die Qualitätsstufe II bleiben nur auf diesem Gerät. Hanglagen und Qualitätsstufe II stehen in der Abrechnung des Kantons.</p>
        </div>
      </details>

      <section className="rounded-lg bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <h2 className="mr-auto text-sm font-semibold text-gray-700">Je Parzelle</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Flurname suchen"
            aria-label="Flurname suchen"
            className="min-h-11 w-44 rounded-lg border-2 border-gray-300 px-2 text-sm"
          />
        </div>
        {parcels.length === 0 ? (
          <p className="border-t px-3 py-4 text-center text-sm text-gray-500">Keine Parzelle gefunden.</p>
        ) : (
          <ul className="divide-y border-t">
            {parcels.map((p) => (
              <ParcelRow
                key={p.parcel.id}
                p={p}
                expanded={open === p.parcel.id}
                onToggle={() => setOpen(open === p.parcel.id ? null : p.parcel.id)}
                q2Input={settings.q2[p.parcel.lineage_id] ?? 0}
                onQ2={(v) => setQ2(p.parcel.lineage_id, v)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 text-xs text-gray-600 shadow-sm">
        <p>
          <span className="font-semibold text-gray-700">Nicht enthalten:</span> Tierwohl (BTS, RAUS, Weide), Nutzungsdauer der Kühe, Alpung,
          Übergangsbeitrag, Vernetzung und Landschaftsqualität (Ansätze des Kantons), Einzelkulturbeiträge, Verzicht auf Pflanzenschutzmittel,
          Bodenbedeckung und schonende Bearbeitung. Vorausgesetzt sind ÖLN und die übrigen Eintretensbedingungen.
        </p>
        <p>
          Vollständig rechnet der{' '}
          <a className="font-medium text-brand-700 underline" href="https://agripedia.ch/focus-ap-pa/de/beitragsrechner/" target="_blank" rel="noreferrer">
            Beitragsrechner von AGRIDEA
          </a>
          . Ansätze:{' '}
          <a className="font-medium text-brand-700 underline" href="https://www.fedlex.admin.ch/eli/cc/2013/765/de" target="_blank" rel="noreferrer">
            Direktzahlungsverordnung, Anhang 7
          </a>
          .
        </p>
      </section>
    </div>
  )
}

function ParcelRow({ p, expanded, onToggle, q2Input, onQ2 }: { p: DpParcelEstimate; expanded: boolean; onToggle: () => void; q2Input: number; onQ2: (v: number) => void }) {
  const name = cropLabel(dpCropName(p.parcel.kultur_code, p.parcel.kultur_name_de), p.parcel.kultur_code)
  const trees = p.parcel.baeume ?? 0
  const size = trees > 0 ? `${fmtNum(trees, 0)} ${trees === 1 ? 'Baum' : 'Bäume'}` : `${fmtNum(p.ha * 100, 2)} a`
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left active:bg-gray-50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">
            {p.parcel.flurname || name}
            {p.q2 > 0 && <span className="ml-1.5 rounded bg-green-100 px-1 text-[10px] font-semibold text-green-800">Q II</span>}
          </span>
          <span className="block truncate text-xs text-gray-600">
            {p.parcel.flurname ? `${name}, ` : ''}
            {size}
            {p.zoneLabel ? `, ${p.zoneLabel}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {p.offen ? <span className="text-amber-700">offen</span> : p.ohne ? <span className="text-gray-400">–</span> : <span className="font-semibold text-gray-900">{fr(p.total)}</span>}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          {(p.offen || p.ohne) && <p>{p.offen ?? p.ohne}</p>}
          {p.lines.map((l) => (
            <div key={l.key} className="flex justify-between gap-2">
              <span>
                {DP_LINE_LABEL[l.key]} <span className="text-gray-500">({rp(l.rate)} Fr./{p.isTree ? 'Baum' : 'ha'})</span>
              </span>
              <span className="tabular-nums">{rp(l.amount)}</span>
            </div>
          ))}
          {p.lines.length > 0 && (
            <div className="flex justify-between gap-2 border-t border-gray-200 pt-1 font-semibold">
              <span>Total pro Jahr</span>
              <span className="tabular-nums">{rp(p.total)}</span>
            </div>
          )}
          {!p.isTree && !p.offen && !p.ohne && (
            <p className="text-gray-500">{p.hangPossible ? 'Hangbeitrag je nach Neigung: nur im Betriebstotal.' : 'Kein Hangbeitrag für diese Nutzung.'}</p>
          )}
          {p.q2Possible && (
            <label className="flex min-h-11 items-center gap-2 font-medium">
              Davon Qualitätsstufe II
              <NumberInput
                value={q2Input || ''}
                onChange={(e) => onQ2(Number(e.target.value) || 0)}
                placeholder="0"
                className="min-h-11 w-24 rounded-lg border-2 border-gray-300 bg-white px-2 text-sm font-normal"
              />
              {p.isTree ? 'Bäume' : 'a'}
            </label>
          )}
        </div>
      )}
    </li>
  )
}
