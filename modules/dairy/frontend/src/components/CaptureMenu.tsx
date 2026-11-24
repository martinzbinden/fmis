// «＋ Erfassen» beim Einzeltier (Tier-Info): Menü mit den Erfassungen, die für dieses Tier in Frage kommen.
// Jede Seite übernimmt das Tier über ?tier=<id> (Geburt, Belegung, Trächtigkeit, Klauen, Journal, Jungtiere);
// Gewicht und CH-TAX beim Rindvieh öffnen den Dialog gleich hier.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '../hooks/useQuery'
import { localTodayIso } from '../lib/format'
import { loadLambs } from '../lib/lambs'
import type { Animal } from '../types'
import { ChTaxDialog, WeightDialog } from './CarcassSection'

interface Entry {
  key: string
  icon: string
  label: string
  /** Seite des Moduls (mit ?tier=…); ohne `to` ein Dialog */
  to?: string
  dialog?: 'gewicht' | 'chtax'
}

/** Erfassungen für ein Tier: weiblich Geburt/Belegung/Trächtigkeit, Jungtiere wägen/absetzen, Rindvieh Gewicht/CH-TAX. */
export function captureEntries(a: Pick<Animal, 'id' | 'sex'>, sheep: boolean, lamb: { nursing: boolean } | null, nursingLambs: number): Entry[] {
  const t = `tier=${a.id}`
  const female = a.sex !== 'm'
  const out: Entry[] = [
    { key: 'behandlung', icon: '💉', label: 'Behandlung / Medikament', to: `journal?${t}&art=behandlung` },
    { key: 'krankheit', icon: '🤒', label: 'Krankheit', to: `journal?${t}&art=krankheit` },
    { key: 'beobachtung', icon: '👁️', label: 'Beobachtung', to: `journal?${t}&art=beobachtung` },
  ]
  if (female && !lamb) {
    out.push(
      { key: 'geburt', icon: sheep ? '🐑' : '🐄', label: sheep ? 'Ablammung' : 'Abkalbung', to: `geburt?${t}` },
      { key: 'belegung', icon: '💞', label: sheep ? 'Belegung' : 'Besamung', to: `belegung?${t}` },
      { key: 'traechtigkeit', icon: '🤰', label: 'Trächtigkeit', to: `traechtigkeit?${t}` },
      { key: 'brunst', icon: '❤️', label: 'Brunst', to: `journal?${t}&art=brunst` },
      { key: 'trocken', icon: '⏸️', label: 'Trockenstellen', to: `journal?${t}&art=trocken` },
    )
  }
  out.push({ key: 'klauen', icon: '🦶', label: 'Klauen', to: `klauen?${t}` })
  if (nursingLambs > 0) out.push({ key: 'absetzen', icon: '✂️', label: `${sheep ? 'Lämmer' : 'Kälber'} absetzen (${nursingLambs})`, to: `laemmer?aktion=absetzen&mutter=${a.id}` })
  if (lamb) {
    out.push({ key: 'waegen', icon: '⚖️', label: 'Wägen', to: `laemmer?aktion=waegen&${t}` })
    out.push({ key: 'fuetterung', icon: '🍼', label: 'Fütterung', to: `laemmer?aktion=fuetterung&${t}` })
    if (lamb.nursing) out.push({ key: 'absetzen', icon: '✂️', label: 'Absetzen', to: `laemmer?aktion=absetzen&${t}` })
  }
  if (!sheep) {
    if (!lamb) out.push({ key: 'gewicht', icon: '⚖️', label: 'Gewicht', dialog: 'gewicht' })
    out.push({ key: 'chtax', icon: '🏷️', label: 'CH-TAX schätzen', dialog: 'chtax' })
  }
  out.push({ key: 'notiz', icon: '📝', label: 'Notiz', to: `journal?${t}&art=notiz` })
  return out
}

/** Knopf + aufklappbares Menü (Kacheln) für das gewählte Tier. */
export default function CaptureMenu({ moduleKey, animal, open, onToggle }: { moduleKey: string; animal: Animal; open: boolean; onToggle: () => void }) {
  const sheep = moduleKey === 'dairy_schafe'
  const [dialog, setDialog] = useState<'gewicht' | 'chtax' | null>(null)
  // Jungtier (bis 1 Jahr) oder Mutter mit saugenden Jungtieren: erst beim Öffnen laden
  const { data: lambs } = useQuery((pg) => (open ? loadLambs(pg, localTodayIso()) : Promise.resolve(null)), [open])
  const lamb = lambs?.find((l) => l.animalId === animal.id) ?? null
  const nursing = lambs?.filter((l) => l.damId === animal.id && l.nursing).length ?? 0
  const entries = captureEntries(animal, sheep, lamb, nursing)
  const tile = 'flex min-h-12 items-center gap-2 rounded-lg border-2 border-gray-300 bg-white px-2.5 text-left text-sm font-medium text-gray-900 active:bg-gray-50'

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`min-h-11 flex-1 rounded-lg border-2 font-semibold ${open ? 'border-brand-700 bg-brand-700 text-white' : 'border-brand-700 bg-white text-brand-800'}`}
      >
        ＋ Erfassen
      </button>
      {open && (
        <nav aria-label="Erfassen für dieses Tier" className="order-last grid w-full grid-cols-2 gap-1.5">
          {entries.map((e) =>
            e.to ? (
              <Link key={e.key} to={`/${moduleKey}/${e.to}`} className={tile}>
                <span aria-hidden className="text-lg leading-none">{e.icon}</span>
                <span className="min-w-0">{e.label}</span>
              </Link>
            ) : (
              <button key={e.key} type="button" onClick={() => setDialog(e.dialog ?? null)} className={tile}>
                <span aria-hidden className="text-lg leading-none">{e.icon}</span>
                <span className="min-w-0">{e.label}</span>
              </button>
            ),
          )}
        </nav>
      )}
      {dialog === 'gewicht' && <WeightDialog animalId={animal.id} onClose={() => setDialog(null)} />}
      {dialog === 'chtax' && <ChTaxDialog animalId={animal.id} current={null} onClose={() => setDialog(null)} />}
    </>
  )
}
