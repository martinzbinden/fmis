import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '../hooks/useQuery'
import { buildTimeline, filterTimeline, loadTimelineInput, timelineTopics, type TimelineItem, type TimelineTopic } from '../lib/animalTimeline'
import { fmtDate } from '../lib/format'
import type { Species } from '../lib/fertility'
import type { Animal } from '../types'

const FIRST = 15

type Prefs = { topic: TimelineTopic | 'alle'; order: 'neu' | 'alt' }

// Thema und Reihenfolge bleiben beim nächsten Tier gleich (je Modul, nur dieses Gerät)
function loadPrefs(moduleKey: string): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(`fmis:${moduleKey}:tierinfo-verlauf`) ?? '{}') as Partial<Prefs>
    return { topic: p.topic ?? 'alle', order: p.order === 'alt' ? 'alt' : 'neu' }
  } catch {
    return { topic: 'alle', order: 'neu' }
  }
}
function savePrefs(moduleKey: string, p: Prefs) {
  try {
    localStorage.setItem(`fmis:${moduleKey}:tierinfo-verlauf`, JSON.stringify(p))
  } catch {
    /* privates Fenster: dann eben nicht gemerkt */
  }
}

/** Verlauf in der Tier-Info: alle Erfassungen zum Tier nach Datum, nach Thema
 * einschränkbar, Reihenfolge umschaltbar. Ein Tipp führt zum Abschnitt im Tierdetail. */
export default function AnimalTimeline({ animal, species, moduleKey }: { animal: Animal; species: Species; moduleKey: string }) {
  const { data } = useQuery((pg) => loadTimelineInput(pg, animal.id), [animal.id])
  const [prefs, setPrefsState] = useState(() => loadPrefs(moduleKey))
  const [all, setAll] = useState(false)
  const setPrefs = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p }
    setPrefsState(next)
    savePrefs(moduleKey, next)
    setAll(false)
  }
  const items = useMemo(() => (data ? buildTimeline({ ...data, animal }, species) : []), [data, animal, species])
  const counts = useMemo(() => {
    const m = new Map<TimelineTopic, number>()
    for (const i of items) m.set(i.topic, (m.get(i.topic) ?? 0) + 1)
    return m
  }, [items])
  const topics = timelineTopics(species).filter((t) => counts.has(t.key) || t.key === prefs.topic)
  const shown = filterTimeline(items, prefs.topic, prefs.order)
  const visible = all ? shown : shown.slice(0, FIRST)
  const topicLabel = timelineTopics(species).find((t) => t.key === prefs.topic)?.label

  return (
    <section className="rounded-lg bg-white px-2.5 py-2 shadow-sm" aria-labelledby="verlauf-titel">
      <div className="mb-1.5 flex items-center gap-2">
        <h2 id="verlauf-titel" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Verlauf
        </h2>
        <select
          value={prefs.topic}
          onChange={(e) => setPrefs({ topic: e.target.value as Prefs['topic'] })}
          aria-label="Thema"
          className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-gray-300 bg-white px-2 text-sm"
        >
          <option value="alle">Alle Themen{data ? ` (${items.length})` : ''}</option>
          {topics.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label} ({counts.get(t.key) ?? 0})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPrefs({ order: prefs.order === 'neu' ? 'alt' : 'neu' })}
          className="min-h-11 shrink-0 rounded-lg border-2 border-gray-300 bg-white px-2 text-sm font-medium text-gray-800"
          aria-label={prefs.order === 'neu' ? 'Neueste zuerst – umschalten auf älteste zuerst' : 'Älteste zuerst – umschalten auf neueste zuerst'}
        >
          {prefs.order === 'neu' ? '↓ Neueste' : '↑ Älteste'}
        </button>
      </div>
      {!data ? (
        <p className="py-2 text-sm text-gray-500">Lädt…</p>
      ) : shown.length === 0 ? (
        <p className="py-2 text-sm text-gray-600">{prefs.topic === 'alle' ? 'Noch nichts erfasst.' : `Keine Einträge zu «${topicLabel}».`}</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {visible.map((i) => (
            <li key={i.id}>
              <Row item={i} animalId={animal.id} />
            </li>
          ))}
        </ol>
      )}
      {!all && shown.length > FIRST && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 min-h-11 w-full rounded-lg text-sm font-medium text-brand-700">
          Alle {shown.length} zeigen
        </button>
      )}
    </section>
  )
}

function Row({ item, animalId }: { item: TimelineItem; animalId: string }) {
  const body = (
    <>
      <span className="w-[4.6rem] shrink-0 pt-px text-xs tabular-nums text-gray-500">{fmtDate(item.date)}</span>
      <span className="w-5 shrink-0 text-center" aria-hidden>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${item.tone === 'bad' ? 'text-red-700' : item.tone === 'good' ? 'text-green-700' : 'text-gray-900'}`}>{item.title}</span>
        {item.detail && <span className="block truncate text-xs text-gray-600">{item.detail}</span>}
      </span>
    </>
  )
  const cls = 'flex min-h-11 items-start gap-1.5 py-1.5'
  if (!item.to) return <div className={cls}>{body}</div>
  const to = item.to.startsWith('#') ? `../tiere/${animalId}${item.to}` : item.to
  return (
    <Link to={to} relative="path" className={`${cls} active:bg-gray-50`}>
      {body}
    </Link>
  )
}
