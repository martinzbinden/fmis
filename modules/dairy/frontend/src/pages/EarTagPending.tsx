import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { animalKey, shortEarTag } from '@fmis/core/earTag'
import { useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import { inTransaction } from '../db/transaction'
import { assignEarTag, checkEarTag, daysSince, loadPendingOffspring, markDied, MARKING_DAYS, type PendingOffspring } from '../lib/earTagPending'
import { fmtDate, localTodayIso } from '../lib/format'
import { speciesOf } from '../lib/species'
import type { Animal } from '../types'

async function loadData(pg: PGlite) {
  const [pending, animals] = await Promise.all([loadPendingOffspring(pg), pg.query<Animal>('select * from animals where deleted_at is null')])
  return { pending, animals: animals.rows }
}

/** Lebende Nachkommen ohne Ohrmarke (bei der Geburt als «später» erfasst) nachtragen. */
export default function EarTagPending({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const word = species === 'sheep' ? { young: 'Lamm', youngPl: 'Lämmer', event: 'Ablammung' } : { young: 'Kalb', youngPl: 'Kälber', event: 'Abkalbung' }
  const { data } = useQuery(loadData)
  const byId = useMemo(() => new Map((data?.animals ?? []).map((a) => [a.id, a])), [data])
  const [saved, setSaved] = useState<{ earTag: string; animalId: string; created: boolean }[]>([])
  const today = localTodayIso()
  const pending = data?.pending ?? []
  // Lesegerät: die Lesung geht an das gewählte (sonst das oberste) Lamm
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = pending.find((p) => p.id === activeId) ?? pending[0]
  const [scanned, setScanned] = useState<{ id: string; earTag: string; n: number } | null>(null)
  const reader = useTagReader({
    moduleKey,
    duplicate: (read) => (saved.some((s) => animalKey(s.earTag) === read.key) ? 'eben eingetragen' : null),
    onRead: (read) => {
      if (!active) return { text: `Keine offenen ${word.youngPl}`, tone: 'error' }
      setScanned((prev) => ({ id: active.id, earTag: read.earTag, n: (prev?.n ?? 0) + 1 }))
      return `${shortEarTag(read.earTag)} → ${word.young} von ${data ? (byId.get(active.dam_id)?.lauf_nr ?? shortEarTag(byId.get(active.dam_id)?.ear_tag)) : '?'}: Geschlecht prüfen, Speichern`
    },
  })

  return (
    <div className="mx-auto max-w-lg space-y-3 p-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Ohrmarken nachtragen</h1>
        <Link to="../geburt" relative="path" className="min-h-11 shrink-0 content-center rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-medium text-gray-800">
          + {word.event}
        </Link>
      </div>
      <p className="text-sm text-gray-600">
        {word.youngPl}, die bei der {word.event} noch keine Ohrmarke hatten. Markierfrist {MARKING_DAYS[species]} Tage nach der Geburt.
      </p>

      {saved.length > 0 && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Eingetragen:{' '}
          {saved.map((s, i) => (
            <span key={s.animalId}>
              {i > 0 && ', '}
              <Link to={`../kuehe/${s.animalId}`} relative="path" className="font-medium text-brand-700">
                {shortEarTag(s.earTag)}
              </Link>
              {!s.created && ' (schon im Bestand, verknüpft)'}
            </span>
          ))}
          <div className="mt-1 text-xs text-green-800">Die Meldung an die TVD bleibt wie bisher separat.</div>
        </div>
      )}

      {pending.length > 0 && <TagReaderButton reader={reader} hint={`Lesung geht an das markierte ${word.young}`} />}

      {data && pending.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Keine offenen Ohrmarken. 👍</p>}

      {pending.map((p, i) => (
        <PendingCard
          nr={i + 1}
          key={p.id}
          p={p}
          dam={byId.get(p.dam_id)}
          animals={data?.animals ?? []}
          today={today}
          deadline={MARKING_DAYS[species]}
          young={word.young}
          active={reader.on && active?.id === p.id}
          onActivate={() => setActiveId(p.id)}
          scanned={scanned?.id === p.id ? scanned : null}
          onSaved={(s) => setSaved((prev) => [...prev, s])}
        />
      ))}
    </div>
  )
}

function PendingCard({
  nr,
  p,
  dam,
  animals,
  today,
  deadline,
  young,
  active,
  onActivate,
  scanned,
  onSaved,
}: {
  nr: number
  p: PendingOffspring
  dam: Animal | undefined
  animals: Animal[]
  today: string
  deadline: number
  young: string
  active: boolean
  onActivate: () => void
  scanned: { earTag: string; n: number } | null
  onSaved: (s: { earTag: string; animalId: string; created: boolean }) => void
}) {
  const db = useDb()
  const [earTag, setEarTag] = useState('')
  const [sex, setSex] = useState<'w' | 'm' | null>(p.sex)
  const [dying, setDying] = useState(false)
  const [diedOn, setDiedOn] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (scanned) setEarTag(scanned.earTag)
  }, [scanned])
  const age = daysSince(p.birth_date, today)
  const tone = age > deadline ? 'border-red-500' : age > deadline - 7 ? 'border-amber-400' : 'border-transparent'
  const check = earTag.trim() ? checkEarTag(p, earTag, animals) : null
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-3 text-base'

  async function save() {
    if (!dam) return setError('Muttertier nicht gefunden.')
    if (!earTag.trim()) return setError('Ohrmarke eingeben.')
    setBusy(true)
    setError(null)
    try {
      const r = await inTransaction(db, (tx) => assignEarTag(tx, p, { earTag, sex }, dam, animals))
      onSaved({ earTag, ...r })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
      setBusy(false)
    }
  }

  async function died() {
    setBusy(true)
    setError(null)
    try {
      await markDied(db, p, diedOn)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
      setBusy(false)
    }
  }

  return (
    <div className={`space-y-2 rounded-lg border-2 bg-white p-3 shadow-sm ${tone} ${active ? 'ring-4 ring-green-600' : ''}`} onClickCapture={onActivate} onFocusCapture={onActivate}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-900">
          Mutter {dam ? (dam.lauf_nr ?? shortEarTag(dam.ear_tag)) : '?'}
          {dam?.lauf_nr && <span className="ml-1 text-xs font-normal text-gray-600">{shortEarTag(dam.ear_tag)}</span>}
        </span>
        <span className="text-right text-xs text-gray-600">
          {p.litter > 1 ? `Wurf ${p.litter}` : 'Einling'}
          {p.siblings.length > 0 && <span className="block">Geschwister {p.siblings.map(shortEarTag).join(', ')}</span>}
        </span>
      </div>
      <p className={`text-sm ${age > deadline ? 'font-semibold text-red-700' : age > deadline - 7 ? 'text-amber-800' : 'text-gray-700'}`}>
        geboren {fmtDate(p.birth_date)} · {age} {age === 1 ? 'Tag' : 'Tage'} alt
        {age > deadline ? ` – Markierfrist (${deadline} T.) überschritten` : age > deadline - 7 ? ` – Frist in ${deadline - age} T.` : ''}
      </p>
      <div className="flex gap-2">
        {(['w', 'm'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSex(s)}
            className={`flex-1 rounded-lg py-2.5 text-base ${sex === s ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {s === 'w' ? '♀ weiblich' : '♂ männlich'}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={earTag}
          onChange={(e) => setEarTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder="Ohrmarke"
          aria-label={`Ohrmarke ${young} ${nr}`}
          autoCapitalize="characters"
          className={input}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !earTag.trim() || (check != null && 'error' in check)}
          className="shrink-0 rounded-lg bg-brand-700 px-4 text-base font-semibold text-white disabled:opacity-50"
        >
          Speichern
        </button>
      </div>
      {check && 'error' in check && <p className="text-sm text-red-600">{check.error}</p>}
      {check && 'existing' in check && check.existing && (
        <p className="text-sm text-gray-700">Schon im Bestand (z.B. aus dem TVD-Import) – wird mit dieser {young === 'Lamm' ? 'Ablammung' : 'Abkalbung'} verknüpft.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {dying ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2 text-sm">
          <label className="flex items-center gap-2">
            verendet am
            <input type="date" value={diedOn} min={p.birth_date} max={today} onChange={(e) => setDiedOn(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-2" />
          </label>
          <button type="button" onClick={() => void died()} disabled={busy} className="min-h-11 rounded-lg bg-gray-700 px-3 font-semibold text-white">
            Bestätigen
          </button>
          <button type="button" onClick={() => setDying(false)} className="min-h-11 px-2 text-gray-700">
            Abbrechen
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setDying(true)} className="text-sm text-gray-600 underline">
          † vor dem Markieren verendet
        </button>
      )}
    </div>
  )
}
