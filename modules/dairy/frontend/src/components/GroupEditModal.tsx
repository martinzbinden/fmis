import { useState } from 'react'
import Modal from '@fmis/core/Modal'

/** Gruppe im Dashboard umbenennen oder löschen. Löschen fragt immer nach: Die Tiere bleiben erhalten und stehen danach
 * «ohne Gruppe», Stall und Weide der Gruppe enden, der Verlauf bleibt (wie «Gruppe auflösen» im Modul Tiere). */
export default function GroupEditModal({
  name,
  memberCount,
  blockedReason,
  onRename,
  onDelete,
  onClose,
}: {
  name: string
  memberCount: number
  /** z.B. offener Entwurf: dann ist Löschen gesperrt */
  blockedReason: string | null
  onRename: (next: string) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(name)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const trimmed = draft.trim()
  const changed = trimmed !== name && trimmed.length > 0

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      onClose()
    } catch {
      // die Meldung zeigt der Aufrufer; der Dialog bleibt offen
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={confirming ? `Gruppe «${name}» löschen?` : `Gruppe «${name}»`} onClose={onClose} dirty={changed}>
      {confirming ? (
        <div className="space-y-3 text-sm text-gray-800">
          <p>
            {memberCount === 0 ? 'Die Gruppe hat keine Tiere.' : `${memberCount} ${memberCount === 1 ? 'Tier steht' : 'Tiere stehen'} danach «ohne Gruppe».`} Die Tiere selbst bleiben erhalten. Stall und Weide der Gruppe enden heute, die Gruppe verschwindet aus dem Dashboard. Der Verlauf (wer wann wo stand) bleibt.
          </p>
          <p className="text-gray-600">Mit «Rückgängig» nimmst du es danach wieder zurück.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="min-h-12 flex-1 rounded-lg border-2 border-gray-400 px-3 font-semibold text-gray-800">
              Abbrechen
            </button>
            <button type="button" onClick={() => void run(onDelete)} disabled={busy} className="min-h-12 flex-1 rounded-lg bg-red-700 px-3 font-semibold text-white disabled:opacity-50">
              {busy ? 'löscht …' : 'Gruppe löschen'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (changed) void run(() => onRename(trimmed))
            }}
          >
            <label className="block text-sm text-gray-700">
              Name
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} className="mt-1 min-h-11 w-full rounded-lg border-2 border-gray-300 px-3 text-base" />
            </label>
            <button type="submit" disabled={!changed || busy} className="min-h-12 w-full rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50">
              Umbenennen
            </button>
          </form>
          <div className="border-t pt-3">
            {blockedReason && <p className="mb-2 text-sm text-amber-800">{blockedReason}</p>}
            <button type="button" disabled={!!blockedReason} onClick={() => setConfirming(true)} className="min-h-12 w-full rounded-lg border-2 border-red-700 px-3 font-semibold text-red-700 disabled:opacity-40">
              Gruppe löschen …
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
