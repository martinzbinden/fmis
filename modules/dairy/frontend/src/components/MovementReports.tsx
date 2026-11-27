// Abgänge aus Begleitdokumenten auf Papier (pages/Begleitdokument.tsx), die noch in der TVD zu melden sind:
// Nummern zum Kopieren, nach dem Melden abhaken. Auf der Seite TVD (pages/TvdBirths.tsx).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow } from '../db/write'
import { countOlderReported, fmtDay, loadMovementDocs, PURPOSES, setMovementReported, tagList, type MovementDoc } from '../lib/begleitdokument'
import { localTodayIso } from '../lib/format'

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export default function MovementReports() {
  const db = useDb()
  const today = localTodayIso()
  // offene immer, gemeldete noch 30 Tage (zum Zurücknehmen), ältere auf Wunsch
  const [showOld, setShowOld] = useState(false)
  const since = showOld ? '1900-01-01' : addDays(today, -30)
  const { data } = useQuery(async (pg) => ({ docs: await loadMovementDocs(pg, since), older: await countOlderReported(pg, since) }), [since])
  const docs = data?.docs ?? []
  const older = data?.older ?? 0
  const open = docs.filter((d) => !d.tvd_reported_on)
  // ✎ je Dokument: «PDF erneut» und «Löschen»
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const edit = (id: string | null) => {
    setEditId(id)
    setConfirmDel(false)
  }
  async function remove(d: MovementDoc) {
    try {
      await undoAction(`Begleitdokument ${fmtDay(d.doc_date)} gelöscht`, () => softDeleteRow(db, 'movement_docs', d.id))
      edit(null)
    } catch (e) {
      notifyError(errorText(e, 'Löschen fehlgeschlagen'))
    }
  }

  async function mark(d: MovementDoc, date: string | null) {
    try {
      await undoAction(date ? `Abgang ${fmtDay(d.doc_date)} gemeldet` : 'Meldung zurückgenommen', () => setMovementReported(db, d.id, date))
    } catch (e) {
      notifyError(errorText(e, 'Speichern fehlgeschlagen'))
    }
  }
  const copy = (d: MovementDoc) =>
    void navigator.clipboard.writeText(tagList(d)).then(
      () => notifySuccess(`${d.animals.length} Nummern kopiert`),
      () => notifyError('Kopieren nicht möglich (Browser-Berechtigung)'),
    )

  return (
    <section id="abgaenge" className="scroll-mt-20 space-y-2 rounded-lg bg-white p-3 shadow-sm" aria-labelledby="abgaenge-titel">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="abgaenge-titel" className="font-semibold text-gray-900">
          🚚 Abgänge melden {open.length > 0 && <span className="rounded-full bg-red-600 px-2 text-sm text-white">{open.length}</span>}
        </h2>
        <Link to="../begleitdokument" relative="path" className="min-h-11 content-center text-sm font-medium text-brand-700">
          + Begleitdokument
        </Link>
      </div>
      {docs.length === 0 ? (
        <p className="text-sm text-gray-600">Keine Begleitdokumente auf Papier. Wenn die TVD nicht geht: Tiergruppe → «📄 Begleitdokument».</p>
      ) : (
        <ul className="divide-y text-sm">
          {docs.map((d) => (
            <li key={d.id} className={`space-y-1 py-2 ${d.tvd_reported_on ? 'text-gray-500' : ''}`}>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium text-gray-900">
                    {fmtDay(d.doc_date)} · {d.animal_count} Tiere · {PURPOSES.find((p) => p.key === d.purpose)?.label ?? '–'}
                  </span>
                  {d.tvd_reported_on ? (
                    <button type="button" onClick={() => void mark(d, null)} className="min-h-11 text-xs text-gray-600 underline">
                      ✓ gemeldet {fmtDay(d.tvd_reported_on)} · zurücknehmen
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-red-700">Abgang offen</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => edit(editId === d.id ? null : d.id)}
                  aria-expanded={editId === d.id}
                  aria-label={`Begleitdokument ${fmtDay(d.doc_date)} bearbeiten`}
                  className={`min-h-11 min-w-11 shrink-0 rounded-lg text-base ${editId === d.id ? 'bg-brand-700 text-white' : 'text-brand-700'}`}
                >
                  ✎
                </button>
              </div>
              {editId === d.id && (
                <div className="flex flex-wrap gap-2 rounded-lg bg-gray-50 p-2">
                  <Link to={`../begleitdokument?dokument=${d.id}`} relative="path" className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand-700 bg-white px-3 font-medium text-brand-800">
                    📄 PDF erneut
                  </Link>
                  {confirmDel ? (
                    <button type="button" onClick={() => void remove(d)} className="min-h-11 rounded-lg bg-red-600 px-3 font-medium text-white">
                      Wirklich löschen?
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmDel(true)} className="min-h-11 rounded-lg px-3 text-red-700">
                      Löschen
                    </button>
                  )}
                </div>
              )}
              {d.destination && <p className="text-xs text-gray-600">→ {d.destination}</p>}
              <p className="text-xs text-gray-700">{d.animals.map((a) => shortEarTag(a.ear_tag)).join(', ')}</p>
              {!d.tvd_reported_on && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => copy(d)} className="min-h-11 rounded-lg border-2 border-brand-700 px-3 font-medium text-brand-800">
                    ⧉ Nummern kopieren
                  </button>
                  <button type="button" onClick={() => void mark(d, today)} className="min-h-11 rounded-lg bg-brand-700 px-3 font-semibold text-white">
                    ✓ In der TVD gemeldet
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!showOld && older > 0 && (
        <button type="button" onClick={() => setShowOld(true)} className="min-h-11 text-sm font-medium text-brand-700">
          Ältere anzeigen ({older} gemeldet, vor mehr als 30 Tagen)
        </button>
      )}
    </section>
  )
}
