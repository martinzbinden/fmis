// Jahresband einer Parzelle (Wochen als Felder) und Legende; für die Ansicht «Jahr» und den Steckbrief.
import { USAGE_COLOR, type UsageColorFamily } from '../lib/format'
import type { Woche } from '../lib/jahresband'

export function Feld({ w, i, aktuell, heute }: { w: Woche; i: number; aktuell: boolean; heute: boolean }) {
  const titel = [w.weide ? `Weide ${w.weide} ${w.weide === 1 ? 'Tag' : 'Tage'}` : null, ...w.text.filter((t) => t !== 'Weide')].filter(Boolean).join(', ')
  return (
    <div
      data-w={i}
      title={titel ? `KW ${i + 1}: ${titel}` : `KW ${i + 1}`}
      className={`relative cursor-pointer border-l border-gray-100 first:border-l-0 ${aktuell ? 'bg-amber-100' : heute ? 'bg-amber-50' : i % 2 ? 'bg-gray-50/60' : ''}`}
    >
      {w.weide > 0 && (
        <span className="absolute inset-x-0 bottom-0 bg-[#15803d]" style={{ height: `${Math.max(3, Math.round((w.weide / 7) * 100))}%`, opacity: 0.85 }} />
      )}
      {w.schnitt && (
        <span
          className="absolute inset-0 flex items-center justify-center text-[10px] font-bold leading-none"
          style={{ color: w.weide > 3 ? '#fff' : USAGE_COLOR[w.schnitt.familie as UsageColorFamily] ?? '#374151' }}
        >
          {w.schnitt.buchstabe}
        </span>
      )}
      {w.duengung && <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[8px] leading-none text-[#7c2d12]">▲</span>}
      {w.pflege && !w.schnitt && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#6d28d9]" />}
    </div>
  )
}

export function Legende() {
  return (
    <details className="text-xs text-gray-700">
      <summary className="cursor-pointer select-none">Legende</summary>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <li>
          <span className="mr-1 inline-block h-3 w-3 bg-[#15803d] align-middle" aria-hidden /> Weide (Höhe = Tage der Woche)
        </li>
        <li>
          <b className="text-[#0f766e]">E</b> Eingrasen · <b className="text-[#b45309]">S</b> Silage · <b className="text-[#854d0e]">Db/Du</b> Dürrfutter
        </li>
        <li>
          <span className="text-[#7c2d12]">▲</span> Düngung
        </li>
        <li>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#6d28d9] align-middle" aria-hidden /> Pflege
        </li>
        <li>Tipp auf eine Woche: im Raster zeigen</li>
      </ul>
    </details>
  )
}
