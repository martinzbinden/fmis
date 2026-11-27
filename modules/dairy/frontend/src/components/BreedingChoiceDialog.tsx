import { useMemo, useState } from 'react'
import Modal from '@fmis/core/Modal'
import { useDb } from '@fmis/core/DbContext'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { inTransaction } from '../db/transaction'
import { saveLoss } from '../lib/birthFollowUp'
import { saveChoice } from '../lib/breedingChoice'
import { localTodayIso } from '../lib/format'
import { loadLambSelection } from '../lib/lambSelectionData'
import { speciesOf } from '../lib/species'
import BirthFollowUp, { draftSize, EMPTY_DRAFT, type FollowUpDraft } from './BirthFollowUp'

export interface ChoiceBirth {
  birthId: string
  /** nur diese Nachkommen; ohne = alle des Wurfs */
  offspringIds?: string[]
}

/** Zuchtauswahl als Dialog: nach der Geburt, aus der Liste der letzten Geburten und beim Absetzen, wenn die Wahl
 * noch offen ist. Eingaben gelten erst mit «Speichern»; «Überspringen» lässt alles, wie es war. */
export default function BreedingChoiceDialog({ moduleKey, births, title, intro, onClose }: { moduleKey: string; births: ChoiceBirth[]; title: string; intro?: string; onClose: () => void }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const today = localTodayIso()
  const [draft, setDraft] = useState<FollowUpDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  // Herdenvergleich einmal für alle Geburten im Dialog
  const base = useMemo(() => loadLambSelection(db, species, today), [db, species, today])
  const n = draftSize(draft)

  function skip() {
    if (n > 0 && !window.confirm('Eingaben verwerfen?')) return
    onClose()
  }

  async function save() {
    if (n === 0) return onClose()
    setBusy(true)
    try {
      await undoAction('Zuchtauswahl gespeichert', () =>
        inTransaction(db, async (tx) => {
          for (const [id, choice] of Object.entries(draft.choices)) await saveChoice(tx, id, choice, today)
          for (const [id, patch] of Object.entries(draft.losses)) await saveLoss(tx, id, patch)
        }),
      )
      notifySuccess('Zuchtauswahl gespeichert')
      onClose()
    } catch (e) {
      notifyError(errorText(e, 'Speichern fehlgeschlagen'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} onSubmit={() => void save()} dirty={n > 0}>
      <div className="space-y-3">
        {intro && <p className="text-sm text-gray-700">{intro}</p>}
        {births.map((b) => (
          <BirthFollowUp key={b.birthId} birthId={b.birthId} moduleKey={moduleKey} only={b.offspringIds} draft={draft} onDraft={setDraft} base={base} />
        ))}
        <p className="text-xs text-gray-600">Später wieder: Tierseite des Jungtiers, «Letzte Geburten → Eltern und Entscheid» oder Mehr → Jungtier-Selektion. Ist die Wahl offen, fragt FMIS beim Absetzen nochmals.</p>
      </div>
      <div className="sticky -bottom-4 -mx-4 mt-3 flex gap-2 border-t border-gray-200 bg-white px-4 py-3">
        <button type="button" onClick={skip} disabled={busy} className="min-h-11 flex-1 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-medium text-gray-800">
          Überspringen
        </button>
        <button type="button" onClick={() => void save()} disabled={busy} className="min-h-11 flex-1 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? 'speichert …' : n > 0 ? `Speichern (${n})` : 'Fertig'}
        </button>
      </div>
    </Modal>
  )
}
