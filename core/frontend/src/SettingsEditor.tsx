import { useState, type ReactNode } from 'react'

/** Grundverhalten für Einstellungen: erst nur ansehen, ändern erst nach dem Stift (✏️); mit ✕ verwerfen, mit ✓ speichern.
 * `children` bekommt den Wert (beim Bearbeiten den Entwurf), `set` ändert den Entwurf und `editing`. Mit `onReset`
 * erscheint beim Bearbeiten «Vorgaben»: es setzt den Entwurf zurück und gilt erst mit ✓. */
export default function SettingsEditor<T>({
  value,
  onSave,
  onReset,
  title,
  label = 'Einstellungen',
  className = '',
  children,
}: {
  value: T
  onSave: (next: T) => void
  /** liefert die Vorgaben; wirkt nur auf den Entwurf */
  onReset?: () => T
  title?: ReactNode
  /** Name für die Beschriftung der Knöpfe (z.B. «Preise») */
  label?: string
  className?: string
  children: (s: { value: T; set: (next: T) => void; editing: boolean }) => ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const icon = 'grid h-11 w-11 place-items-center rounded-lg border-2 text-lg font-bold'
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm text-gray-600">{title}</div>
        {editing ? (
          <div className="flex shrink-0 gap-1 print:hidden">
            <button type="button" onClick={() => setEditing(false)} className={`${icon} border-gray-400 text-gray-700`} aria-label="Abbrechen" title="Abbrechen">
              ✕
            </button>
            <button
              type="button"
              onClick={() => {
                onSave(draft)
                setEditing(false)
              }}
              className={`${icon} border-brand-700 bg-brand-700 text-white`}
              aria-label="Speichern"
              title="Speichern"
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(value)
              setEditing(true)
            }}
            className={`${icon} shrink-0 border-gray-300 text-gray-700 print:hidden`}
            aria-label={`${label} bearbeiten`}
            title="Bearbeiten"
          >
            ✏️
          </button>
        )}
      </div>
      {children({ value: editing ? draft : value, set: setDraft, editing })}
      {editing && onReset && (
        <button type="button" onClick={() => setDraft(onReset())} className="mt-2 min-h-11 rounded-lg border-2 border-gray-400 px-3 text-sm font-semibold text-gray-800">
          Vorgaben wiederherstellen
        </button>
      )}
    </div>
  )
}

/** Zahl in der Ansicht als Wert, beim Bearbeiten als Feld: gleiche Breite, damit nichts springt. */
export function ReadValue({ children }: { children: ReactNode }) {
  return <span className="min-w-12 rounded-lg bg-gray-100 px-3 py-2 text-right font-semibold text-gray-900">{children}</span>
}
