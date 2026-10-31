import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { animalKey, shortEarTag } from '@fmis/core/earTag'
import { matchRead, useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'
import { useQuery } from '../hooks/useQuery'
import { WatchlistPicker } from '../components/AnimalWarnings'
import { loadPedigreeData } from '../components/PedigreeTree'
import { eventsOf, loadAnimalEvents } from '../lib/animalWarnings'
import { cullingReasons, fmtCells } from '../lib/culling'
import { useCullingThresholds } from '../lib/cullingSettings'
import { cullingInput } from '../lib/herdContext'
import { fmtInbreeding, inbreedingClass } from '../lib/inbreeding'
import { rankLambs } from '../lib/lambSelection'
import { loadLambSelection } from '../lib/lambSelectionData'
import { fmtDate, isoDate, localTodayIso, num } from '../lib/format'
import { matchAnimals, METHOD_LABEL, RESULT_LABEL } from '../lib/pregnancy'
import { speciesOf } from '../lib/species'
import { withdrawalUntil } from '../lib/treatments'
import { clawStatusByAnimal, examSummary, loadClawExams } from '../lib/clawHealth'
import { loadSettings } from './LambSelection'
import type { Animal, AnimalJournalEntry } from '../types'

async function loadInfo(pg: PGlite, species: 'cattle' | 'sheep', moduleKey: string) {
  const today = localTodayIso()
  const sel = await loadLambSelection(pg, species, today)
  const [pedigree, events, journal, claws] = await Promise.all([
    loadPedigreeData(pg, sel.context, species),
    loadAnimalEvents(pg),
    pg.query<AnimalJournalEntry>(
      "select * from animal_journal where deleted_at is null and (category in ('krankheit', 'behandlung') or withdrawal_milk_days is not null or withdrawal_meat_days is not null) order by entry_date desc",
    ),
    loadClawExams(pg),
  ])
  const lambs = rankLambs({
    candidates: sel.candidates,
    dams: sel.dams,
    sireValues: sel.sireValues,
    inbreeding: (dam, sire) => sel.inbreeding.offspring(dam, sire),
    decisions: new Map([...sel.decisions].map(([k, d]) => [k, d.purpose])),
    settings: loadSettings(moduleKey),
    today,
  })
  const journalByAnimal = new Map<string, AnimalJournalEntry[]>()
  for (const j of journal.rows) {
    const e = {
      ...j,
      entry_date: isoDate(j.entry_date)!,
      last_date: isoDate(j.last_date),
      release_milk_date: isoDate(j.release_milk_date),
      release_meat_date: isoDate(j.release_meat_date),
      withdrawal_milk_days: num(j.withdrawal_milk_days),
      withdrawal_meat_days: num(j.withdrawal_meat_days),
      withdrawal_factor: num(j.withdrawal_factor),
    }
    if (!e.animal_id) continue
    journalByAnimal.set(e.animal_id, [...(journalByAnimal.get(e.animal_id) ?? []), e])
  }
  return {
    today,
    context: sel.context,
    animals: [...sel.context.values()].map((c) => c.animal),
    lambByAnimal: new Map(lambs.filter((l) => l.animal_id).map((l) => [l.animal_id!, l])),
    pedigree,
    events,
    journalByAnimal,
    claws: clawStatusByAnimal(claws, species, today),
  }
}

const DAY = 86_400_000
const daysAgo = (iso: string, today: string) => Math.round((Date.parse(today) - Date.parse(iso)) / DAY)
function fmtAge(birth: string | null, today: string): string {
  if (!birth) return 'Alter ?'
  const months = Math.floor((Date.parse(today) - Date.parse(birth)) / (30.4375 * DAY))
  if (months < 1) return `${daysAgo(birth, today)} T.`
  if (months < 24) return `${months} Mt.`
  return `${Math.floor(months / 12)} J. ${months % 12} Mt.`
}
const nameOf = (a: Pick<Animal, 'lauf_nr' | 'ear_tag' | 'name'>) => `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}${a.name ? ` ${a.name}` : ''}`

/** Tier-Info: Nummer tippen oder lesen → das Wichtigste zum Tier auf einen Blick
 * (für das Handy, ohne Scrollen). */
export default function AnimalInfo({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const word = species === 'sheep' ? { birth: 'Ablammung', mating: 'Belegung', sire: 'Widder' } : { birth: 'Abkalbung', mating: 'Besamung', sire: 'Stier' }
  const { data } = useQuery((pg) => loadInfo(pg, species, moduleKey), [species, moduleKey])
  const { thresholds } = useCullingThresholds(moduleKey, species)
  const [query, setQuery] = useState('')
  const [id, setId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [listMsg, setListMsg] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const animals = useMemo(() => data?.animals ?? [], [data])
  // aktive Tiere zuerst (gleiche Endziffern bei abgegangenen Tieren)
  const matches = useMemo(() => {
    const m = matchAnimals(animals, query)
    return [...m.filter((a) => a.status === 'aktiv'), ...m.filter((a) => a.status !== 'aktiv')]
  }, [animals, query])

  function show(animalId: string) {
    setId(animalId)
    setPicking(false)
    setListMsg(null)
    input.current?.blur()
  }

  const reader = useTagReader({
    moduleKey,
    onRead: (read) => {
      const a = matchRead(read, animals)
      if (!a) return { text: `${shortEarTag(read.earTag)}: nicht im Bestand`, tone: 'error' }
      show(a.id)
      setQuery('')
      return nameOf(a)
    },
  })

  const ctx = id ? data?.context.get(id) : undefined

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-2 p-3 pb-24">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value.replace(/[^\d]/g, '').slice(0, 9))
              const m = matchAnimals(animals, e.target.value)
              if (m.length === 1 && e.target.value.replace(/\D/g, '').length >= 3) show(m[0].id)
            }}
            onKeyDown={(e) => e.key === 'Enter' && matches[0] && show(matches[0].id)}
            inputMode="numeric"
            enterKeyHint="go"
            autoComplete="off"
            placeholder="Laufnr. / Ohrmarke"
            aria-label="Laufnummer oder letzte Ziffern der Ohrmarke"
            className="min-h-12 w-full rounded-lg border-2 border-gray-500 px-3 text-xl tracking-widest focus:border-brand-700 focus:outline-none"
          />
        </div>
        <div className="shrink-0">
          <TagReaderButton reader={reader} />
        </div>
      </div>
      {query && matches.length > 1 && (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border-2 border-gray-300 bg-white">
          {matches.slice(0, 12).map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => show(a.id)} className={`flex min-h-11 w-full items-center px-3 text-left ${a.id === id ? 'bg-brand-50' : ''}`}>
                <span className="flex-1">{nameOf(a)}</span>
                {a.status !== 'aktiv' && <span className="text-xs text-gray-600">{a.status}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && matches.length === 0 && <p className="text-sm text-gray-700">Kein Tier mit dieser Nummer.</p>}

      {!data && <p className="text-center text-gray-500">Lädt…</p>}
      {data && !ctx && !query && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Laufnummer oder die letzten Ziffern der Ohrmarke eintippen – oder mit dem Lesegerät lesen.</p>}

      {data && ctx && (() => {
        const a = ctx.animal
        const today = data.today
        const key = animalKey(a.ear_tag) ?? a.ear_tag
        const node = data.pedigree.pedigreeByKey.get(key)
        const sire = node?.sire_key ? data.pedigree.pedigreeByKey.get(node.sire_key) : undefined
        const damId = node?.dam_key ? data.pedigree.herdIdByKey.get(node.dam_key) : undefined
        const dam = damId ? data.context.get(damId)?.animal : undefined
        const damNode = node?.dam_key ? data.pedigree.pedigreeByKey.get(node.dam_key) : undefined
        const f = data.pedigree.inbreeding.inbreeding(key)
        const lamb = data.lambByAnimal.get(a.id)
        const p = ctx.performance
        const ev = eventsOf(data.events, a.id)
        const lastBirth = ctx.births.at(-1)
        const lastService = ctx.fertility.last_service
        const preg = ctx.pregnancy ?? (ev.checks[0] ? { result: ev.checks[0].result, date: ev.checks[0].check_date, method: ev.checks[0].method, examiner: ev.checks[0].examiner, weeks: null } : null)
        const journal = data.journalByAnimal.get(a.id) ?? []
        const until = (kind: 'milk' | 'meat') =>
          journal
            .map((j) => withdrawalUntil(j, kind))
            .filter((d): d is string => d != null && d >= today)
            .sort()
            .at(-1)
        const milkUntil = until('milk')
        const meatUntil = until('meat')
        const lastTreatment = journal[0]
        const claw = data.claws.get(a.id)
        const reasons = a.sex !== 'm' && (ctx.births.length > 0 || ctx.lactationNumber) ? cullingReasons(cullingInput(ctx, species), thresholds) : []
        const lastScc = ctx.currentLactationScc.filter((v): v is number => v != null).at(-1)
        const inactive = a.status !== 'aktiv'
        return (
          <article className="space-y-2">
            <header className={`rounded-lg px-3 py-2 text-white ${inactive ? 'bg-gray-500' : 'bg-gray-900'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h1 className="truncate text-xl font-bold">{nameOf(a)}</h1>
                <span className="shrink-0 text-lg">{a.sex === 'm' ? '♂' : '♀'}</span>
              </div>
              <div className="text-sm text-gray-200">
                {fmtAge(a.birth_date, today)}
                {a.birth_date ? ` · geb. ${fmtDate(a.birth_date)}` : ''}
                {a.breed_code ? ` · ${a.breed_code}` : ''}
                {ctx.lactationNumber ? ` · ${ctx.lactationNumber}. Lakt.` : ''}
                {inactive ? ` · ${a.status}` : ''}
              </div>
            </header>

            {(milkUntil || meatUntil) && (
              <div className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white">
                ⚠ Absetzfrist {milkUntil ? `Milch bis ${fmtDate(milkUntil)}` : ''}
                {milkUntil && meatUntil ? ' · ' : ''}
                {meatUntil ? `Fleisch bis ${fmtDate(meatUntil)}` : ''}
              </div>
            )}
            {ev.lists.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {ev.lists.map((l) => (
                  <span key={l.entryId} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900" title={l.reason ?? undefined}>
                    📋 {l.name}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <Tile label="Abstammung">
                <Line>V {sire ? (sire.name ?? shortEarTag(sire.ear_tag)) : '?'}{sire?.bv ? ` (${sire.bv.label} ${sire.bv.value})` : ''}</Line>
                <Line>M {dam ? nameOf(dam) : damNode ? shortEarTag(damNode.ear_tag) : '?'}</Line>
                {f > 0 && <Line className={inbreedingClass(f) === 'high' || inbreedingClass(f) === 'medium' ? 'text-red-700' : ''}>Inzucht {fmtInbreeding(f)}</Line>}
              </Tile>
              <Tile label={lamb && !p?.idx_performance ? 'Index (Abstammung)' : 'Index Leistung / Zellzahl'}>
                {lamb && !p?.idx_performance ? (
                  <>
                    <Big tone={lamb.index != null && lamb.index < 95 ? 'bad' : lamb.index != null && lamb.index > 105 ? 'good' : undefined}>{lamb.index != null ? Math.round(lamb.index) : '–'}</Big>
                    {lamb.purpose && <Line>Entscheid: {lamb.purpose === 'zucht' ? 'Remonte' : 'Mast'}</Line>}
                  </>
                ) : (
                  <>
                    <Big tone={p?.idx_performance != null && p.idx_performance < 95 ? 'bad' : p?.idx_performance != null && p.idx_performance > 105 ? 'good' : undefined}>
                      {p?.idx_performance != null ? Math.round(p.idx_performance) : '–'} / {p?.idx_scc != null ? Math.round(p.idx_scc) : '–'}
                    </Big>
                    {p?.performance_rel != null && <Line>{Math.round(p.performance_rel * 100)} % ggü. Gleichaltrigen</Line>}
                  </>
                )}
              </Tile>
              <Tile label={`Letzte ${word.birth}`}>
                {lastBirth ? (
                  <>
                    <Line strong>{fmtDate(lastBirth.birth_date)} · vor {daysAgo(lastBirth.birth_date, today)} T.</Line>
                    <Line>
                      {lastBirth.offspring.length > 1 ? `Wurf ${lastBirth.offspring.length}` : lastBirth.offspring.length === 1 ? 'Einling' : 'ohne Nachkommen'}
                      {lastBirth.offspring.some((o) => o.stillborn || o.died_24h) ? `, ${lastBirth.offspring.filter((o) => !o.stillborn && !o.died_24h).length} lebend` : ''}
                      {ctx.births.length > 1 ? ` · ${ctx.births.length}. Geburt` : ''}
                    </Line>
                  </>
                ) : (
                  <Line>keine</Line>
                )}
              </Tile>
              <Tile label={`Letzte ${word.mating}`}>
                {lastService && (!lastBirth || lastService.service_date > lastBirth.birth_date) ? (
                  <>
                    <Line strong>
                      {fmtDate(lastService.service_date)}
                      {lastService.service_to ? `–${fmtDate(lastService.service_to)}` : ''}
                    </Line>
                    <Line>{lastService.sire_name ?? lastService.sire_key ?? `${word.sire} ?`}</Line>
                    {ctx.fertility.expected_birth && <Line>erw. {word.birth} {fmtDate(ctx.fertility.expected_birth)}</Line>}
                  </>
                ) : (
                  <Line>{lastBirth ? `seit der ${word.birth} keine` : 'keine'}</Line>
                )}
              </Tile>
              <Tile label="Trächtigkeit">
                {preg ? (
                  <>
                    <Big tone={preg.result === 'ja' ? 'good' : preg.result === 'nein' ? 'bad' : undefined}>{RESULT_LABEL[preg.result]}</Big>
                    <Line>
                      {fmtDate(preg.date)}
                      {preg.method ? ` · ${METHOD_LABEL[preg.method]}` : ''}
                    </Line>
                  </>
                ) : (
                  <Line>keine Meldung</Line>
                )}
              </Tile>
              <Tile label="Zellzahl">
                {p?.scc_geo_12m != null || lastScc != null ? (
                  <>
                    <Line strong>Ø 12 Mt. {p?.scc_geo_12m != null ? fmtCells(p.scc_geo_12m) : '–'}</Line>
                    <Line>letzte {lastScc != null ? fmtCells(lastScc) : '–'}</Line>
                  </>
                ) : (
                  <Line>keine Proben</Line>
                )}
              </Tile>
              <Tile label="Gesundheit / Klauen">
                <Line strong={!!lastTreatment}>
                  {lastTreatment ? `${fmtDate(lastTreatment.entry_date)} ${lastTreatment.diagnosis ?? lastTreatment.medication ?? lastTreatment.text ?? ''}` : 'keine Behandlung'}
                </Line>
                {claw ? (
                  <Line className={(claw.mh ?? 0) >= 3 || claw.lame ? 'font-semibold text-red-700' : ''}>
                    🐾 {fmtDate(claw.last.exam_date)}: {examSummary(claw.last, species)}
                  </Line>
                ) : (
                  <Line>🐾 nicht beurteilt</Line>
                )}
              </Tile>
              <Tile label="Ausmerzliste">
                {reasons.length > 0 ? (
                  <>
                    <Line strong className="text-red-700">
                      {reasons.length} {reasons.length === 1 ? 'Grund' : 'Gründe'}
                    </Line>
                    <Line>{reasons[0].text}</Line>
                  </>
                ) : (
                  <Line>keine Gründe</Line>
                )}
              </Tile>
            </div>

            <div className="flex gap-2">
              <Link to={`../kuehe/${a.id}`} relative="path" className="flex min-h-11 flex-1 items-center justify-center rounded-lg border-2 border-gray-300 bg-white font-semibold text-brand-800">
                Details ›
              </Link>
              <button type="button" onClick={() => setPicking((v) => !v)} className="min-h-11 flex-1 rounded-lg border-2 border-brand-700 bg-white font-semibold text-brand-800">
                + Merkliste
              </button>
            </div>
            {listMsg && <p className="text-sm font-semibold text-green-800">✓ {listMsg}</p>}
            {picking && (
              <WatchlistPicker
                animalIds={[a.id]}
                reason={null}
                onDone={(msg) => {
                  setPicking(false)
                  setListMsg(msg)
                }}
              />
            )}
          </article>
        )
      })()}
    </div>
  )
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg bg-white px-2.5 py-1.5 shadow-sm">
      <h2 className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</h2>
      {children}
    </section>
  )
}

function Line({ children, strong = false, className = '' }: { children: ReactNode; strong?: boolean; className?: string }) {
  return <div className={`truncate text-sm leading-snug ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'} ${className}`}>{children}</div>
}

function Big({ children, tone }: { children: ReactNode; tone?: 'good' | 'bad' }) {
  return <div className={`text-lg font-bold leading-tight ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-900'}`}>{children}</div>
}
