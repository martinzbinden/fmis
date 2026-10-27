import { useState } from 'react'
import AsyncButton from '@fmis/core/AsyncButton'
import { notifyError } from '@fmis/core/toast'
import Modal from './Modal'
import { CATEGORIES } from '../lib/categories'
import { addVariant, chooseVariant, removeVariant, renameVariant } from '../lib/data'
import { fmtLength } from '../lib/geometry'
import { compareVariants, nextVariantName } from '../lib/variants'
import type { BauFeature, Project, SurveyPoint, Variant } from '../types'

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-base'

/** Varianten verwalten (anlegen, umbenennen, festlegen, löschen) und vergleichen. */
export default function VariantsDialog({
  project,
  variants,
  features,
  points,
  canWrite,
  onClose,
  onShow,
}: {
  project: Project
  variants: Variant[]
  features: BauFeature[]
  points: SurveyPoint[]
  canWrite: boolean
  onClose: () => void
  /** eine Variante auf der Karte zeigen */
  onShow: (id: string) => void
}) {
  const [name, setName] = useState(() => nextVariantName(variants))
  const [notes, setNotes] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [edit, setEdit] = useState<Variant | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const { rows, categories } = compareVariants(features, variants)
  const common = features.filter((f) => !f.variant_id).length
  const chosen = project.chosen_variant_id

  async function add() {
    if (!name.trim()) return
    try {
      const id = await addVariant(project.id, name.trim(), notes.trim() || null, variants, features, copyFrom || undefined)
      onShow(id)
      onClose()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="Varianten" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-gray-600">
          Objekte gehören zu einer Variante oder zu allen (z.B. Gebäude, Schächte, Anschlüsse; jetzt {common}). Neue Objekte kommen in die Variante, die
          oben gewählt ist. Ist eine Variante festgelegt, gelten die anderen als verworfen und bleiben erhalten.
        </p>

        {variants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left">
              <thead>
                <tr className="border-b text-xs text-gray-500">
                  <th className="py-1 pr-2 font-medium">Länge</th>
                  {rows.map((r) => (
                    <th key={r.id} className={`py-1 pr-2 text-right font-semibold ${chosen === r.id ? 'text-green-800' : chosen ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      {r.name}
                      {chosen === r.id ? ' ✓' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      {CATEGORIES[c].icon} {CATEGORIES[c].label}
                    </td>
                    {rows.map((r) => (
                      <td key={r.id} className="py-1 pr-2 text-right tabular-nums">
                        {r.lengths[c] ? fmtLength(r.lengths[c]!) : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1 pr-2">Total Leitungen</td>
                  {rows.map((r) => (
                    <td key={r.id} className="py-1 pr-2 text-right tabular-nums">
                      {fmtLength(r.total)}
                    </td>
                  ))}
                </tr>
                <tr className="text-xs text-gray-500">
                  <td className="py-1 pr-2">eigene Objekte</td>
                  {rows.map((r) => (
                    <td key={r.id} className="py-1 pr-2 text-right tabular-nums">
                      {r.own}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-xs text-gray-500">Gemeinsame Leitungen zählen bei jeder Variante mit; verworfene Objekte nicht.</p>
          </div>
        )}

        <ul className="divide-y rounded-lg border">
          {variants.map((v) => (
            <li key={v.id} className="space-y-2 p-2">
              {edit?.id === v.id ? (
                <div className="space-y-2">
                  <input className={field} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Name der Variante" />
                  <input className={field} value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Beschreibung (optional)" />
                  <div className="flex gap-2">
                    <AsyncButton className="min-h-11 rounded-lg bg-brand-600 px-4 text-white" onClick={async () => { await renameVariant(v, edit.name.trim() || v.name, edit.notes?.trim() || null); setEdit(null) }}>
                      Speichern
                    </AsyncButton>
                    <button type="button" className="min-h-11 rounded-lg border border-gray-300 px-3" onClick={() => setEdit(null)}>
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { onShow(v.id); onClose() }}>
                    <b className={chosen && chosen !== v.id ? 'text-gray-500 line-through' : ''}>{v.name}</b>
                    {chosen === v.id && <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-800">gewählt</span>}
                    {chosen && chosen !== v.id && <span className="ml-2 text-xs text-gray-500">verworfen</span>}
                    {v.notes && <span className="block text-xs text-gray-600">{v.notes}</span>}
                  </button>
                  {canWrite && (
                    <>
                      {chosen === v.id ? (
                        <AsyncButton className="min-h-11 rounded-lg border border-gray-300 px-3" onClick={() => chooseVariant(project, null)}>
                          Wahl aufheben
                        </AsyncButton>
                      ) : (
                        <AsyncButton className="min-h-11 rounded-lg border border-green-700 px-3 text-green-800" onClick={async () => { await chooseVariant(project, v.id); onShow(v.id) }}>
                          ✓ Festlegen
                        </AsyncButton>
                      )}
                      <button type="button" className="min-h-11 rounded-lg px-2 text-brand-700" onClick={() => setEdit(v)}>
                        Umbenennen
                      </button>
                      {confirmDel === v.id ? (
                        <AsyncButton className="min-h-11 rounded-lg bg-red-600 px-3 text-white" onClick={async () => { await removeVariant(project, v, features, points); setConfirmDel(null) }}>
                          Wirklich löschen?
                        </AsyncButton>
                      ) : (
                        <button type="button" className="min-h-11 rounded-lg px-2 text-red-700" onClick={() => setConfirmDel(v.id)} title={`samt ${features.filter((f) => f.variant_id === v.id).length} eigenen Objekten`}>
                          Löschen
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
          {variants.length === 0 && <li className="p-2 text-gray-600">Noch keine Varianten: alle Objekte gehören zum Projekt.</li>}
        </ul>

        {canWrite && (
          <div className="space-y-2 rounded-lg bg-gray-50 p-2">
            <div className="font-semibold text-gray-700">Neue Variante</div>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z.B. «B: über Parzelle 246»" aria-label="Name der neuen Variante" />
            <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Beschreibung (optional)" />
            {variants.length > 0 && (
              <select className={field} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label="Objekte übernehmen">
                <option value="">leer beginnen</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    Objekte von {v.name} kopieren
                  </option>
                ))}
              </select>
            )}
            <AsyncButton className="min-h-11 rounded-lg bg-brand-600 px-4 font-medium text-white disabled:opacity-50" disabled={!name.trim()} onClick={add}>
              ＋ Variante anlegen
            </AsyncButton>
          </div>
        )}
      </div>
    </Modal>
  )
}
