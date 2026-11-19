import { useEffect, useRef, useState } from 'react'
import { useHasPermission } from '@fmis/core/AuthContext'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { useQuery } from '../hooks/useQuery'
import {
  applyView,
  captureView,
  deleteBoardView,
  loadBoardViews,
  readCurrent,
  renameBoardView,
  saveBoardView,
  viewSignature,
  viewSync,
  visibleViews,
  writeCurrent,
  type BoardView,
  type CurrentView,
} from '../lib/boardViews'

const ownerName = (email: string) => email.split('@')[0]

/** Aufklappmenü «Ansichten» im Dashboard: Einstellungen als Ansicht speichern, laden, freigeben. Eigene Ansichten gelten
 * auf allen Geräten der Person; wer eine Ansicht speichert, dessen andere Geräte übernehmen den neuen Stand von selbst
 * (sofern dort nichts ungespeichert geändert ist). `onApplied` baut die Seite mit den geladenen Einstellungen neu auf. */
export default function BoardViewsMenu({ moduleKey, onApplied }: { moduleKey: string; onApplied: () => void }) {
  const db = useDb()
  const me = getCurrentUserEmail()
  const canWrite = useHasPermission(`${moduleKey}:animals:write`) && !!me
  const views = useQuery((pg) => loadBoardViews(pg), []).data
  const [current, setCurrentState] = useState<CurrentView | null>(() => readCurrent(moduleKey))
  const setCurrent = (v: CurrentView | null) => {
    writeCurrent(moduleKey, v)
    setCurrentState(v)
  }
  // bei jedem Neuzeichnen der Seite: Stand dieses Geräts (ein Dutzend localStorage-Schlüssel)
  const localSig = viewSignature(captureView(moduleKey))
  const view = views?.find((v) => v.id === current?.id)
  const { mine, others } = visibleViews(views ?? [], me)
  const visible = !!view && (mine.includes(view) || others.includes(view))
  const state = views ? viewSync(current, view, localSig, visible) : 'none'
  const owned = !!view && mine.includes(view)

  function load(v: BoardView, quiet = false) {
    applyView(moduleKey, v.settings)
    setCurrent({ id: v.id, sig: viewSignature(v.settings) })
    setOpen(false)
    if (!quiet) notifySuccess(`Ansicht «${v.name}» geladen`)
    onApplied()
  }

  // Abgleich: anderswo gespeichert und hier unverändert → übernehmen; gelöscht → vergessen; gleich → Stand nachführen
  const adopted = useRef<string | null>(null)
  useEffect(() => {
    if (!current) return
    if (state === 'gone') setCurrent(null)
    else if (state === 'same' && current.sig !== localSig) setCurrent({ ...current, sig: localSig })
    else if (state === 'adopt' && view) {
      const key = `${view.id}:${viewSignature(view.settings)}`
      if (adopted.current === key) return
      adopted.current = key
      notifySuccess(`Ansicht «${view.name}»: neuer Stand übernommen`)
      load(view, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, localSig, view])

  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState<string | null>(null)
  const [newShared, setNewShared] = useState(false)
  const [edit, setEdit] = useState<{ id: string; name: string; shared: boolean } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  async function run(label: string, fn: () => Promise<void>, done: string) {
    try {
      await undoAction(label, fn)
      notifySuccess(done)
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  function saveInto(v: BoardView) {
    const settings = captureView(moduleKey)
    void run(`Ansicht «${v.name}» gespeichert`, async () => {
      await saveBoardView(db, { id: v.id, name: v.name, owner: v.owner, shared: v.shared, settings })
      setCurrent({ id: v.id, sig: viewSignature(settings) })
    }, `Ansicht «${v.name}» gespeichert – gilt auch auf deinen anderen Geräten`)
  }

  function saveNew() {
    const name = newName?.trim()
    if (!name || !me) return
    const settings = captureView(moduleKey)
    void run(`Ansicht «${name}» angelegt`, async () => {
      const id = await saveBoardView(db, { name, owner: me, shared: newShared, settings })
      setCurrent({ id, sig: viewSignature(settings) })
    }, `Ansicht «${name}» gespeichert`)
    setNewName(null)
    setNewShared(false)
  }

  function saveEdit() {
    if (!edit || !edit.name.trim()) return
    const e = edit
    void run(`Ansicht «${e.name.trim()}» geändert`, () => renameBoardView(db, e.id, { name: e.name, shared: e.shared }), `Ansicht «${e.name.trim()}» geändert`)
    setEdit(null)
  }

  function remove(v: BoardView) {
    if (!window.confirm(`Ansicht «${v.name}» löschen?${v.shared ? ' Sie verschwindet auch bei allen anderen.' : ''}`)) return
    void run(`Ansicht «${v.name}» gelöscht`, () => deleteBoardView(db, v.id), `Ansicht «${v.name}» gelöscht`)
    setEdit(null)
  }

  const dirty = state === 'changed' || state === 'conflict'
  const row = (v: BoardView, mineRow: boolean) => {
    const active = v.id === current?.id
    if (edit?.id === v.id)
      return (
        <li key={v.id} className="space-y-2 rounded-lg border-2 border-brand-700 p-2">
          <input aria-label="Name der Ansicht" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} className="min-h-11 w-full rounded-lg border-2 border-gray-300 px-2 text-sm" autoFocus />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={edit.shared} onChange={(e) => setEdit({ ...edit, shared: e.target.checked })} />
            Für alle Benutzer abrufbar
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => remove(v)} className="min-h-11 rounded-lg border-2 border-red-300 px-3 text-sm text-red-800">
              🗑 Löschen
            </button>
            <span className="flex-1" />
            <button type="button" onClick={() => setEdit(null)} aria-label="Abbrechen" className="min-h-11 w-11 rounded-lg border-2 border-gray-300 text-sm">
              ✕
            </button>
            <button type="button" onClick={saveEdit} aria-label="Übernehmen" className="min-h-11 w-11 rounded-lg border-2 border-brand-700 bg-brand-700 text-sm font-semibold text-white">
              ✓
            </button>
          </div>
        </li>
      )
    return (
      <li key={v.id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => load(v)}
          aria-current={active ? 'true' : undefined}
          title={mineRow ? 'Laden' : `Laden – Ansicht von ${ownerName(v.owner)}`}
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm ${active ? 'bg-brand-50 font-semibold text-brand-900' : 'active:bg-gray-100'}`}
        >
          <span className="w-4 shrink-0 text-brand-700">{active ? '✓' : ''}</span>
          <span className="min-w-0 flex-1 truncate">{v.name}</span>
          {mineRow && v.shared && <span title="Für alle abrufbar" className="shrink-0 text-xs text-gray-600">👥</span>}
          {!mineRow && <span className="shrink-0 text-xs font-normal text-gray-600">{ownerName(v.owner)}</span>}
        </button>
        {mineRow && canWrite && (
          <button type="button" onClick={() => setEdit({ id: v.id, name: v.name, shared: v.shared })} aria-label={`Ansicht «${v.name}» bearbeiten`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-700 active:bg-gray-100">
            ✎
          </button>
        )}
      </li>
    )
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        title={dirty ? 'Ansicht geändert, noch nicht gespeichert' : 'Gespeicherte Ansichten'}
        className={`flex min-h-11 max-w-[14rem] items-center gap-1 rounded-lg border-2 px-3 text-sm ${dirty ? 'border-amber-500 bg-amber-50' : 'border-gray-300 bg-white'}`}
      >
        <span className="truncate">📑 {visible && view ? view.name : 'Ansichten'}</span>
        {dirty && <span aria-label="geändert" className="text-amber-700">●</span>}
        <span>▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Gespeicherte Ansichten" className="fixed inset-x-3 top-20 z-40 max-h-[80vh] space-y-2 overflow-y-auto rounded-xl border border-gray-300 bg-white p-2 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:z-30 sm:mt-1 sm:max-h-none sm:w-80 sm:overflow-visible">
          {view && state === 'conflict' && (
            <div className="space-y-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              <p>«{view.name}» wurde inzwischen anderswo gespeichert, hier ist aber auch etwas geändert.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => load(view)} className="min-h-11 flex-1 rounded-lg border-2 border-amber-600 bg-white px-2 font-semibold">
                  Neuen Stand laden
                </button>
                {owned && canWrite && (
                  <button type="button" onClick={() => saveInto(view)} className="min-h-11 flex-1 rounded-lg border-2 border-amber-600 bg-white px-2">
                    Meine speichern
                  </button>
                )}
              </div>
            </div>
          )}
          {view && state === 'changed' && (
            <div className="space-y-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              <p>Seit dem Laden von «{view.name}» geändert.</p>
              <div className="flex flex-wrap gap-2">
                {owned && canWrite ? (
                  <button type="button" onClick={() => saveInto(view)} className="min-h-11 flex-1 rounded-lg border-2 border-brand-700 bg-brand-700 px-2 font-semibold text-white">
                    💾 In «{view.name}» speichern
                  </button>
                ) : (
                  <span className="flex-1 self-center text-xs">Ansicht von {ownerName(view.owner)}: als eigene speichern (unten).</span>
                )}
                <button type="button" onClick={() => load(view)} className="min-h-11 rounded-lg border-2 border-amber-600 bg-white px-3">
                  Verwerfen
                </button>
              </div>
            </div>
          )}

          {!views ? (
            <p className="p-2 text-sm text-gray-600">Lädt…</p>
          ) : (
            <>
              <section>
                <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Meine Ansichten</h3>
                {mine.length ? <ul>{mine.map((v) => row(v, true))}</ul> : <p className="px-1 py-1 text-sm text-gray-600">Noch keine. Speichere die jetzigen Einstellungen als Ansicht, dann gelten sie auf all deinen Geräten.</p>}
              </section>
              {others.length > 0 && (
                <section>
                  <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Von anderen</h3>
                  <ul>{others.map((v) => row(v, false))}</ul>
                </section>
              )}
            </>
          )}

          {canWrite &&
            (newName == null ? (
              <button type="button" onClick={() => setNewName(view && !owned ? `${view.name} (Kopie)` : '')} className="min-h-11 w-full rounded-lg border-2 border-dashed border-gray-400 px-2 text-sm font-semibold text-gray-800">
                + Jetzige Einstellungen als neue Ansicht
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border-2 border-brand-700 p-2">
                <input aria-label="Name der neuen Ansicht" placeholder="Name, z.B. Melkstand oder Büro" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNew()} className="min-h-11 w-full rounded-lg border-2 border-gray-300 px-2 text-sm" autoFocus />
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={newShared} onChange={(e) => setNewShared(e.target.checked)} />
                  Für alle Benutzer abrufbar
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setNewName(null)} aria-label="Abbrechen" className="min-h-11 w-11 rounded-lg border-2 border-gray-300 text-sm">
                    ✕
                  </button>
                  <button type="button" onClick={saveNew} disabled={!newName.trim()} aria-label="Speichern" className="min-h-11 w-11 rounded-lg border-2 border-brand-700 bg-brand-700 text-sm font-semibold text-white disabled:opacity-40">
                    ✓
                  </button>
                </div>
              </div>
            ))}

          {current && visible && (
            <button type="button" onClick={() => setCurrent(null)} className="min-h-11 w-full rounded-lg px-2 text-left text-xs text-gray-600 underline">
              Auf diesem Gerät von «{view?.name}» lösen (nicht mehr abgleichen)
            </button>
          )}
          <p className="px-1 text-xs text-gray-600">
            Eine Ansicht umfasst Kartenfelder, Spalten, Sortierung, Filter, Summen und die Einstellungen der Kartenwerte. Speicherst du sie, übernehmen deine anderen Geräte (und wer eine freigegebene Ansicht geladen hat) den neuen Stand beim nächsten Öffnen.
          </p>
        </div>
      )}
    </div>
  )
}
