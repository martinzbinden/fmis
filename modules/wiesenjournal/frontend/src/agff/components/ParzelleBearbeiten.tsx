import { umbenennen } from '../lib/kurzname'
import { useState } from 'react'
import Modal from './Modal'
import { softDeleteRow, upsertRow } from '../db/write'
import { getDb } from '../db/db'
import { recomputeYear } from '../lib/fertilization'
import { fmtNum, INTENSITAET_LABEL, num, PARCEL_CATEGORY_LABEL } from '../lib/format'
import { geoAdminUrl } from '../lib/geoAdmin'
import type { Intensitaet, Parcel, ParcelCategory } from '../types'

const WIESENTYP_VORSCHLAEGE = [
  'Raigras-Weissklee',
  'Knaulgras-Weissklee',
  'Fromental',
  'Goldhafer',
  'Kammgras-Weide',
  'Rotschwingel-Straussgras',
  'Kunstwiese SM 330',
  'Kunstwiese SM 440',
  'Luzerne-Gras',
]

export default function ParzelleBearbeiten({ parcel, year, onClose }: { parcel: Parcel | null; year: number; onClose: () => void }) {
  const isNew = !parcel
  const manual = !parcel || parcel.source === 'manual'
  const [name, setName] = useState(parcel?.name ?? '')
  const [area, setArea] = useState(parcel?.area_a != null ? String(num(parcel.area_a)) : '')
  const [category, setCategory] = useState<ParcelCategory>(parcel?.category ?? 'futter')
  const [wiesentyp, setWiesentyp] = useState(parcel?.wiesentyp ?? '')
  const [intensitaet, setIntensitaet] = useState<Intensitaet | ''>(parcel?.intensitaet ?? '')
  const [notes, setNotes] = useState(parcel?.notes ?? '')
  const [immerZeigen, setImmerZeigen] = useState(!!parcel?.immer_zeigen)
  const [error, setError] = useState<string | null>(null)
  // nur mit Umriss oder Punkt (ohne Geometrie kein Link)
  const geoUrl = geoAdminUrl(parcel?.base_geometry ?? null)

  async function save() {
    if (manual && !name.trim()) {
      setError('Name fehlt.')
      return
    }
    const areaNum = area.trim() === '' ? null : Number(area.replace(',', '.'))
    const areaChanged = manual && parcel && num(parcel.area_a) !== areaNum
    await upsertRow('parcels', {
      ...(parcel ?? { id: crypto.randomUUID(), season_year: year, source: 'manual', sort_order: 9999, gelan_missing: false }),
      ...(manual ? { name: name.trim(), area_a: areaNum, category } : umbenennen(parcel!, name)),
      wiesentyp: wiesentyp.trim() || null,
      intensitaet: intensitaet || null,
      notes: notes.trim() || null,
      immer_zeigen: immerZeigen,
    })
    if (areaChanged) recomputeYear(await getDb(), year)
    onClose()
  }

  async function remove() {
    if (!parcel) return
    const st = await getDb()
    const n =
      st.rows('usage_entries').filter((u) => u.parcel_id === parcel.id).length +
      st.rows('fertilization_shares').filter((x) => x.parcel_id === parcel.id).length
    if (!window.confirm(n ? `«${parcel.name}» hat ${n} Einträge. Trotzdem löschen? Die Einträge verschwinden aus Raster und Bericht.` : `«${parcel.name}» löschen?`)) return
    await softDeleteRow('parcels', parcel.id)
    onClose()
  }

  return (
    <Modal title={isNew ? 'Parzelle von Hand' : parcel!.name} onClose={onClose} onSubmit={() => void save()}>
      <div className="space-y-3 text-sm">
        {!manual && (
          <div className="rounded bg-gray-50 p-2 text-xs text-gray-600">
            <div>
              GELAN · ID Kultur {parcel!.external_kultur_id} · {parcel!.kultur_code} {parcel!.kultur_name_de}
            </div>
            <div>
              {fmtNum(parcel!.area_a, 2)} a · {parcel!.farm_name ?? '–'}
              {parcel!.gelan_missing && <span className="ml-1 font-semibold text-red-700">· fehlt im letzten GELAN-Export</span>}
            </div>
            <div className="mt-1">
              Fläche und Kultur kommen aus dem Import und werden beim nächsten Import abgeglichen. Ein eigener Name bleibt; der Name
              aus dem Import wird nur daneben nachgeführt.
            </div>
          </div>
        )}
        {!manual && (
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Name</span>
            <input className="inp w-full" value={name} onChange={(e) => setName(e.target.value)} data-testid="parzelle-name" />
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-600">
              Im Import: {parcel!.name_import ?? parcel!.name}
              {name.trim() !== (parcel!.name_import ?? parcel!.name) && (
                <button type="button" className="text-brand-700 underline" onClick={() => setName(parcel!.name_import ?? parcel!.name)}>
                  zurück zum Namen aus dem Import
                </button>
              )}
            </span>
          </label>
        )}
        {geoUrl && (
          <a
            href={geoUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 font-medium text-gray-800 active:bg-gray-50"
          >
            🗺️ In map.geo.admin.ch zeigen ↗
          </a>
        )}
        {manual && (
          <>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">Name</span>
              <input className="inp w-full" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="mb-1 block font-medium text-gray-700">Fläche (a)</span>
                <input className="inp w-full" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} />
              </label>
              <label className="block flex-1">
                <span className="mb-1 block font-medium text-gray-700">Kategorie</span>
                <select className="inp w-full" value={category} onChange={(e) => setCategory(e.target.value as ParcelCategory)}>
                  {Object.entries(PARCEL_CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-gray-500">Ohne Umriss: keine Teilflächen, nicht auf der Karte und nicht in der Fuhren-Zählung.</p>
          </>
        )}
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Wiesentyp</span>
          <input className="inp w-full" list="wiesentypen" value={wiesentyp} onChange={(e) => setWiesentyp(e.target.value)} />
          <datalist id="wiesentypen">
            {WIESENTYP_VORSCHLAEGE.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </label>
        <div>
          <span className="mb-1 block font-medium text-gray-700">Intensität</span>
          <div className="flex flex-wrap gap-1">
            {(['', 'i', 'mi', 'wi', 'e'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`chip ${intensitaet === k ? 'chip-on' : 'chip-off'}`}
                onClick={() => setIntensitaet(k)}
              >
                {k ? INTENSITAET_LABEL[k] : 'offen'}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
          <textarea className="inp w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={immerZeigen} onChange={(e) => setImmerZeigen(e.target.checked)} />
          Immer zeigen, auch wenn kleine Parzellen ausgeblendet sind
        </label>
        {error && <p className="rounded bg-red-50 p-2 text-red-800">{error}</p>}
        <div className="flex items-center justify-between border-t pt-3">
          {parcel && (manual || parcel.gelan_missing) ? (
            <button type="button" className="text-sm text-red-600" onClick={() => void remove()}>
              Löschen
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" onClick={() => void save()}>
              Speichern
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

