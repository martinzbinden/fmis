import { useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '@fmis/core/Modal'
import { useDb } from '@fmis/core/DbContext'
import { animalKey } from '@fmis/core/earTag'
import { errorText, notifySuccess } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { localTodayIso } from '../lib/format'
import { preselectionLabel, type Preselection } from '../lib/lambRecommendation'
import { rankLambs } from '../lib/lambSelection'
import { choiceOfKey, loadLambSelection, recommendationsFor, saveDecision } from '../lib/lambSelectionData'
import { speciesOf } from '../lib/species'
import { loadSettings } from '../pages/LambSelection'
import ChoiceScale from './ChoiceScale'

/** Zuchtauswahl eines Tiers als kleiner Dialog (Dashboard-Karte): Empfehlung mit Begründung und die Skala.
 * Ein Tipp speichert und schliesst. */
export default function ChoiceDialog({ moduleKey, animalId, earTag, title, onClose }: { moduleKey: string; animalId: string; earTag: string; title: string; onClose: () => void }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const today = localTodayIso()
  const key = animalKey(earTag) ?? earTag
  const { data } = useQuery(
    async (pg) => {
      const sel = await loadLambSelection(pg, species, today)
      const settings = loadSettings(moduleKey)
      const rows = rankLambs({
        candidates: sel.candidates,
        dams: sel.dams,
        sireValues: sel.sireValues,
        inbreeding: (dam, sire) => sel.inbreeding.offspring(dam, sire),
        decisions: new Map([...sel.decisions].map(([k, d]) => [k, d.purpose])),
        settings,
        today,
      })
      const row = rows.find((r) => r.animal_id === animalId || r.key === key)
      return { sel, rec: row ? (recommendationsFor([row], sel, settings, species).get(row.key) ?? null) : null }
    },
    [species, today, animalId, key, moduleKey],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(next: Preselection | null) {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      await saveDecision(db, key, next, data.sel.decisions.get(key), today)
      notifySuccess(next ? `Zuchtauswahl: ${preselectionLabel(next)}` : 'Zuchtauswahl zurückgenommen')
      onClose()
    } catch (e) {
      setError(errorText(e, 'Speichern fehlgeschlagen'))
      setBusy(false)
    }
  }

  const rec = data?.rec ?? null
  return (
    <Modal title={`Zuchtauswahl ${title}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {!data && <p className="text-gray-600">Lade Empfehlung …</p>}
        {data && rec && (
          <p className="text-gray-800">
            Empfehlung: <b>{preselectionLabel(rec.choice)}</b>
            {rec.reasons.length > 0 && <span className="text-gray-600"> ({rec.reasons.join(', ')})</span>}
          </p>
        )}
        {data && !rec && <p className="text-gray-600">Keine Empfehlung: das Tier ist älter als die Jungtier-Selektion (Einstellung Höchstalter).</p>}
        <ChoiceScale value={data ? choiceOfKey(data.sel, key) : null} recommended={rec?.choice} onChoose={(n) => void choose(n)} disabled={!data || busy} label="Zuchtauswahl" />
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-between gap-2 text-sm">
          <Link to={`/${moduleKey}/tiere/${animalId}#zuchtauswahl`} className="text-brand-700 underline">
            Eltern und Details
          </Link>
          <Link to={`/${moduleKey}/selektion?tier=${animalId}`} className="text-brand-700 underline">
            Jungtier-Selektion
          </Link>
        </div>
      </div>
    </Modal>
  )
}
