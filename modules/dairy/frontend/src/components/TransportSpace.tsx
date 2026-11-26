import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorText, notifyError } from '@fmis/core/toast'
import { loadDocuments, openDocument, storedDocuments, type TierDocument } from '@fmis/tiere/lib/documents'
import { useQuery } from '../hooks/useQuery'
import { useCattlePrices } from '../lib/carcassData'
import { localTodayIso } from '../lib/format'
import { loadTransportAnimals } from '../lib/transportData'
import { transportSummary } from '../lib/transportSpace'
import { speciesOf } from '../lib/species'

const m2 = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, '')} m²`

/** Merkblätter zum Thema Transport (Modul Tiere → Merkblätter); ohne Netz die zuletzt geholte Liste. */
function useTransportDocs(): TierDocument[] {
  const [docs, setDocs] = useState(() => storedDocuments().filter((d) => d.topic === 'transport' && d.kind !== 'formular'))
  useEffect(() => {
    let live = true
    loadDocuments()
      .then((d) => live && setDocs(d.filter((x) => x.topic === 'transport' && x.kind !== 'formular')))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return docs
}

/** Platz beim Transport für die Tiere einer Gruppe: Fläche nach TSchV Anhang 4 und Höhe des Abteils. */
export default function TransportSpace({ moduleKey, ids }: { moduleKey: string; ids: string[] }) {
  const species = speciesOf(moduleKey)
  const prices = useCattlePrices().prices
  const today = localTodayIso()
  const { data } = useQuery((pg) => loadTransportAnimals(pg, species, today, prices), [species, today, prices])
  const [shorn, setShorn] = useState(false)
  const docs = useTransportDocs()
  const sum = useMemo(() => (data ? transportSummary(ids.map((id) => data.get(id)).filter((a): a is NonNullable<typeof a> => !!a), { shorn }) : null), [data, ids, shorn])

  return (
    <details className="group rounded-lg bg-white text-sm shadow-sm" aria-label="Platz beim Transport">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3">
        <span className="font-semibold text-gray-900">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span> 🚚 Platz beim Transport
        </span>
        <span className="font-bold text-gray-900">{sum ? `mind. ${m2(sum.m2)}` : '…'}</span>
      </summary>
      {sum && (
        <div className="space-y-1.5 px-3 pb-3">
          <ul className="text-gray-700">
            {sum.bands.map((b) => (
              <li key={b.band} className="flex justify-between gap-2">
                <span>
                  {b.n} × {b.band}
                </span>
                <span>
                  {b.n} × {m2(b.m2)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-gray-700">
            Höhe Abteil: Widerristhöhe des grössten Tiers + {sum.addCm} cm
            {species === 'cattle' ? '. Wand bis zur ersten Öffnung: 1.50 m (Kälber unter 3 Mt.: 0.60 m).' : '. Wand bis zur ersten Öffnung: 0.60 m.'}
          </p>
          {species === 'sheep' && (
            <label className="flex items-center gap-2 text-gray-800">
              <input type="checkbox" checked={shorn} onChange={(e) => setShorn(e.target.checked)} className="h-5 w-5" />
              geschoren (weniger Platz ab 45 kg)
            </label>
          )}
          <p className="text-xs text-gray-600">
            {sum.estimated > 0 && `${sum.estimated} von ${sum.counted} Gewichten geschätzt (${species === 'cattle' ? 'Messband, Auge oder Alter und Rasse' : 'Lämmer nach Alter, Schafe als «über 60 kg»'}); `}
            {sum.unknown > 0 && `${sum.unknown} ohne Gewicht nicht gezählt; `}
            {species === 'sheep' && 'hochträchtige Auen und Zuchtwidder 0.5 m²; '}
            Tiere nach Geschlecht und Alter abtrennen. Mehr als doppelt so viel Platz: Trennwand einsetzen. Massgebend sind TSchV Anhang 4 und die Ladefläche im Fahrzeugausweis.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {docs.map((d) => (
              <button key={d.id} type="button" onClick={() => void openDocument(d).catch((e: unknown) => notifyError(errorText(e)))} className="min-h-9 text-left font-medium text-brand-700 underline">
                📄 {d.title}
              </button>
            ))}
            <Link to="/tiere/merkblaetter" className="min-h-9 content-center text-brand-700 underline">
              {docs.length ? 'Merkblätter' : 'Merkblatt hinterlegen'}
            </Link>
          </div>
        </div>
      )}
    </details>
  )
}
