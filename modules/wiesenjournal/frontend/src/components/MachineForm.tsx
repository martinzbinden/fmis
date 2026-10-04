import { useState } from 'react'
import Modal from './Modal'
import { upsertRow } from '../db/write'
import { isSelfPropelled, isTractor, MACHINE_KIND_LABEL } from '../lib/machines'
import { CATEGORY_LABEL, KIND_CATEGORY } from '../lib/maintenance'
import type { DuengungUnit, Machine, MachineCategory, MachineKind } from '../types'

const s = (v: string | number | null | undefined) => (v == null ? '' : String(v))
const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

/** Maschine erfassen/bearbeiten — Typenschild, Traktor-Angaben bzw.
 * Fass/Arbeitsbreite und Standard-Traktor eines Anbaugeräts. */
export default function MachineForm({
  machine,
  machines,
  onClose,
  onSaved,
}: {
  machine: Machine | null
  machines: Machine[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [f, setF] = useState({
    name: s(machine?.name),
    kind: machine?.kind ?? ('guellefass' as MachineKind),
    manufacturer: s(machine?.manufacturer),
    model: s(machine?.model),
    type_no: s(machine?.type_no),
    serial_no: s(machine?.serial_no),
    year_built: s(machine?.year_built),
    weight_kg: s(machine?.weight_kg),
    power_hp: s(machine?.power_hp),
    front_pto: machine?.front_pto ?? false,
    capacity: s(machine?.capacity),
    capacity_unit: (machine?.capacity_unit ?? (machine ? '' : 'm3')) as DuengungUnit | '',
    width_m: s(machine?.width_m),
    tractor_id: machine?.tractor_id ?? '',
    notes: s(machine?.notes),
    active: machine?.active ?? true,
    owner: s(machine?.owner),
    category: (machine?.category ?? '') as MachineCategory | '',
  })
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }))
  // Träger (Traktor, Hoflader): Leistung statt Fass/Breite; selbstfahrend
  // (Motormäher): Breite, aber kein Träger
  const tractor = isTractor({ kind: f.kind })
  const selfPropelled = isSelfPropelled({ kind: f.kind })
  const tractors = machines.filter((m) => isTractor(m) && m.id !== machine?.id)

  async function save() {
    if (!f.name.trim()) return
    setSaving(true)
    try {
      const id = machine?.id ?? crypto.randomUUID()
      await upsertRow('machines', {
        ...(machine ?? { sort_order: (machines.length + 1) * 10 }),
        id,
        name: f.name.trim(),
        kind: f.kind,
        manufacturer: f.manufacturer.trim() || null,
        model: f.model.trim() || null,
        type_no: f.type_no.trim() || null,
        serial_no: f.serial_no.trim() || null,
        year_built: n(f.year_built),
        weight_kg: n(f.weight_kg),
        power_hp: tractor ? n(f.power_hp) : null,
        front_pto: f.kind === 'traktor' ? f.front_pto : false,
        capacity: tractor ? null : n(f.capacity),
        capacity_unit: tractor || n(f.capacity) == null ? null : f.capacity_unit || null,
        width_m: tractor ? null : n(f.width_m),
        tractor_id: tractor || selfPropelled ? null : f.tractor_id || null,
        active: f.active,
        notes: f.notes.trim() || null,
        owner: f.owner.trim() || null,
        category: f.category || null,
      } as never)
      onSaved(id)
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
  const label = 'mb-1 block font-medium text-gray-700'

  return (
    <Modal title={machine ? 'Maschine bearbeiten' : 'Neue Maschine'} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className={label}>Bezeichnung</span>
          <input className={field} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="z.B. Güllefass Fliegl 6.5 m³" />
        </label>
        <label className="block">
          <span className={label}>Art</span>
          <select className={field} value={f.kind} onChange={(e) => set({ kind: e.target.value as MachineKind })}>
            {Object.entries(MACHINE_KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={label}>Kategorie (Wartung, Liste)</span>
          <select className={field} value={f.category} onChange={(e) => set({ category: e.target.value as MachineCategory | '' })}>
            <option value="">automatisch: {CATEGORY_LABEL[KIND_CATEGORY[f.kind] ?? 'uebrige']}</option>
            {(Object.keys(CATEGORY_LABEL) as MachineCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        {f.kind === 'auto' ? null : tractor ? (
          <div className="grid grid-cols-2 items-end gap-2">
            <label className="block">
              <span className={label}>Leistung (PS)</span>
              <input className={field} inputMode="decimal" value={f.power_hp} onChange={(e) => set({ power_hp: e.target.value })} />
            </label>
            {f.kind === 'traktor' && (
              <label className="flex items-center gap-2 pb-2">
                <input type="checkbox" checked={f.front_pto} onChange={(e) => set({ front_pto: e.target.checked })} />
                Frontzapfwelle
              </label>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <label className="col-span-2 block">
                <span className={label}>Fass / Ladevolumen</span>
                <input className={field} inputMode="decimal" value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} />
              </label>
              <label className="block">
                <span className={label}>Einheit</span>
                <select className={field} value={f.capacity_unit} onChange={(e) => set({ capacity_unit: e.target.value as DuengungUnit | '' })}>
                  <option value="">–</option>
                  <option value="m3">m³</option>
                  <option value="t">t</option>
                  <option value="kg">kg</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={label}>Arbeitsbreite (m)</span>
                <input className={field} inputMode="decimal" value={f.width_m} onChange={(e) => set({ width_m: e.target.value })} />
              </label>
              {!selfPropelled && (
                <label className="block">
                  <span className={label}>{f.kind === 'ladergeraet' ? 'Standard-Hoflader' : 'Standard-Traktor'}</span>
                  <select className={field} value={f.tractor_id} onChange={(e) => set({ tractor_id: e.target.value })}>
                    <option value="">— erster in der Liste —</option>
                    {tractors
                      .filter((t) => (f.kind === 'ladergeraet') === (t.kind === 'hoflader') || t.id === f.tractor_id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
          </>
        )}

        <label className="block">
          <span className={label}>Eigentümer</span>
          <input
            className={field}
            list="machine-owners"
            value={f.owner}
            onChange={(e) => set({ owner: e.target.value })}
            placeholder="leer = eigener Betrieb"
          />
          <datalist id="machine-owners">
            {[...new Set(machines.map((m) => m.owner).filter((o): o is string => !!o))].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <span className="mt-0.5 block text-xs text-gray-500">Fremde Maschinen (Nachbar, Lohnunternehmer) — Stunden und Kosten getrennt auswerten.</span>
        </label>

        <fieldset className="space-y-2 rounded border border-gray-200 p-2">
          <legend className="px-1 text-xs font-medium text-gray-500">Typenschild</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={label}>Hersteller</span>
              <input className={field} value={f.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} />
            </label>
            <label className="block">
              <span className={label}>Modell</span>
              <input className={field} value={f.model} onChange={(e) => set({ model: e.target.value })} />
            </label>
            <label className="block">
              <span className={label}>Typen-Nr.</span>
              <input className={field} value={f.type_no} onChange={(e) => set({ type_no: e.target.value })} />
            </label>
            <label className="block">
              <span className={label}>Fabrikations-/Serie-Nr.</span>
              <input className={field} value={f.serial_no} onChange={(e) => set({ serial_no: e.target.value })} />
            </label>
            <label className="block">
              <span className={label}>Baujahr</span>
              <input className={field} inputMode="numeric" value={f.year_built} onChange={(e) => set({ year_built: e.target.value })} />
            </label>
            <label className="block">
              <span className={label}>Gewicht (kg)</span>
              <input className={field} inputMode="decimal" value={f.weight_kg} onChange={(e) => set({ weight_kg: e.target.value })} />
            </label>
          </div>
        </fieldset>

        <label className="block">
          <span className={label}>Bemerkung</span>
          <textarea className={field} rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="z.B. Schleppschuhverteiler" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          aktiv (in Auswahllisten)
        </label>
        <button
          type="button"
          disabled={saving || !f.name.trim()}
          onClick={() => void save()}
          className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          Speichern
        </button>
      </div>
    </Modal>
  )
}
