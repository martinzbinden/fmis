import { useEffect, useMemo, useState } from 'react'
import { animalProviders, type ReaderFacts } from '@fmis/core/animals'
import { errorText } from '@fmis/core/toast'
import { todayIso } from '../lib/format'
import { memberAt, type HerdData } from '../lib/herds'
import { buildReaderLists, VARIANTS, type ListVariant, type ReaderEntry } from '../lib/readerLists'
import Modal from './Modal'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Listen für AgriLink: nach dem Lesen zeigt das Gerät eine Zeile Stand zum Tier (Nummer + Alarmtext, je 20 Zeichen).
 * Der Stand ist der von heute; nach Änderungen die Listen neu erzeugen und hochladen. */
export default function ReaderListsDialog({ data, onClose }: { data: HerdData; onClose: () => void }) {
  const today = todayIso()
  const [variant, setVariant] = useState<ListVariant>('gruppe')
  const [entries, setEntries] = useState<ReaderEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const out: ReaderEntry[] = []
        for (const [, provider] of animalProviders()) {
          const [animals, facts] = await Promise.all([provider.listAnimals(), provider.readerFacts?.() ?? Promise.resolve(new Map<string, ReaderFacts>())])
          for (const a of animals) {
            const m = memberAt(data, a.id, today)
            out.push({ earTag: a.ear_tag, laufNr: a.lauf_nr, group: m ? (data.groups.find((g) => g.id === m.group_id)?.name ?? null) : null, facts: facts.get(a.id) ?? null })
          }
        }
        if (live) setEntries(out)
      } catch (e) {
        if (live) setError(errorText(e))
      }
    })()
    return () => {
      live = false
    }
  }, [data, today])

  const lists = useMemo(() => (entries ? buildReaderLists(entries, variant, today) : null), [entries, variant, today])
  const label = VARIANTS.find((v) => v.key === variant)!.label.replace(/\W+/g, '')

  return (
    <Modal title="Listen fürs Lesegerät" onClose={onClose} dirty={false}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-700">
          Nach dem Lesen einer Ohrmarke zeigt das Gerät eine Zeile zum Tier: die Nummer und einen Alarmtext (je höchstens 20 Zeichen). Auf dem Gerät liegt eine Liste;
          lade vor der Aufgabe die passende Variante.
        </p>
        <div className="space-y-1" role="radiogroup" aria-label="Variante">
          {VARIANTS.map((v) => (
            <label key={v.key} className="flex items-start gap-2">
              <input type="radio" name="variant" checked={variant === v.key} onChange={() => setVariant(v.key)} className="mt-1 h-5 w-5" />
              <span>
                <b>{v.label}</b>
                <span className="block text-gray-600">{v.example}</span>
              </span>
            </label>
          ))}
        </div>

        {error && <p className="rounded-lg bg-red-50 p-2 text-red-800">{error}</p>}
        {!entries && !error && <p className="text-gray-500">Lädt …</p>}
        {lists && (
          <>
            <p className="rounded-lg bg-gray-50 p-2">
              {lists.stats.animals} Tiere, {lists.stats.withAlert} mit Alarmtext ({lists.stats.alerts} verschiedene).
              {lists.stats.noTag > 0 && <span className="text-amber-800"> {lists.stats.noTag} ohne verwertbare Ohrmarke fehlen.</span>}
              {lists.stats.alertOverflow > 0 && <span className="text-amber-800"> {lists.stats.alertOverflow} ohne Alarm: das Gerät kennt höchstens 250 verschiedene Texte.</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => download(`Alarmliste_${label}.alAlert`, lists.alertList)} className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white">
                1. Alarmliste laden
              </button>
              <button type="button" onClick={() => download(`Linkliste_${label}.alLink`, lists.linkList)} className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white">
                2. Link-Liste laden
              </button>
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-gray-700">
              <li>In AgriLink die Alarmliste öffnen (Alertlist → Load) und aufs Gerät hochladen (Upload).</li>
              <li>Dann die Link-Liste öffnen (Linklist → Load) und hochladen.</li>
              <li>Am Gerät eine Ohrmarke lesen: Nummer und Alarmtext erscheinen.</li>
            </ol>
            <p className="text-xs text-gray-500">Stand von heute. Nach Gruppenwechseln, Ablammungen oder Untersuchungen neue Listen erzeugen.</p>
          </>
        )}
      </div>
    </Modal>
  )
}
