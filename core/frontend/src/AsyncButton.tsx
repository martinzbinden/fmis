import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { errorText, notifyError } from './toast'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> & {
  onClick: () => Promise<unknown> | unknown
  children: ReactNode
  /** Text während des Speicherns */
  busyLabel?: string
  /** kurz nach Erfolg eingeblendet */
  doneLabel?: string
}

/** Speichern-Knopf mit sofortiger Rückmeldung: wird beim Tippen gesperrt
 * (kein Doppel-Tap → keine Doppeleinträge), zeigt «Speichert…», danach kurz
 * «✓ gespeichert». Fehler erscheinen als Hinweis statt still zu verschwinden. */
export default function AsyncButton({ onClick, children, busyLabel = 'Speichert…', doneLabel = '✓ gespeichert', disabled, ...rest }: Props) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  async function handle() {
    if (state === 'busy') return
    setState('busy')
    try {
      await onClick()
      setState('done')
      setTimeout(() => setState('idle'), 1400)
    } catch (err) {
      setState('idle')
      notifyError(errorText(err))
    }
  }
  return (
    <button type="button" {...rest} disabled={disabled || state === 'busy'} onClick={() => void handle()} aria-busy={state === 'busy'}>
      {state === 'busy' ? busyLabel : state === 'done' ? doneLabel : children}
    </button>
  )
}
