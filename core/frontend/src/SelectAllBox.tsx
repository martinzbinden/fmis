import { useEffect, useRef } from 'react'

/** «Alle / keine auswählen» für Listen mit Kontrollkästchen, möglichst kompakt: ein Kästchen im Listenkopf
 * (ganz leer = keine, Strich = einige, Haken = alle). Antippen: sind alle gewählt, werden alle abgewählt, sonst
 * alle gewählt. Mit `label` steht ein kurzer Text daneben (z.B. «3 von 10 gewählt»). */
export default function SelectAllBox({ total, selected, onChange, label, className = '' }: { total: number; selected: number; onChange: (all: boolean) => void; label?: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const all = total > 0 && selected >= total
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && selected < total
  }, [selected, total])
  const text = all ? 'Keine auswählen' : 'Alle auswählen'
  return (
    <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 ${className}`} title={text}>
      <input ref={ref} type="checkbox" checked={all} disabled={total === 0} onChange={() => onChange(!all)} className="h-5 w-5 accent-brand-700" aria-label={text} />
      {label && <span className="text-xs text-gray-600">{label}</span>}
    </label>
  )
}
