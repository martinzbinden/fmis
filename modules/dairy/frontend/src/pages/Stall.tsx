import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { animalProvider } from '@fmis/core/animals'
import { shortEarTag } from '@fmis/core/earTag'
import { useDb } from '@fmis/core/DbContext'
import FooterBar, { FOOTER_SLOT_ID } from '@fmis/core/FooterBar'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { useQuery } from '../hooks/useQuery'
import { completeReminder, dueText } from '../lib/reminders'
import { addDays, fmtDate, localTodayIso } from '../lib/format'
import { speciesOf } from '../lib/species'
import { lambTitle, loadStall, saveDecisions, type StallData } from '../lib/stallData'
import { buildFeedingPlan, buildStallHints, dueState, type DecisionStep, type DecisionValue, type HintItem, type HintKind, type PhaseKey, type StallHint } from '../lib/stallCalendar'
import { RULE_FIELDS, useStallRules, type StallRules } from '../lib/stallRules'
import AnimalInfo from './AnimalInfo'
import JournalEntry from './JournalEntry'
import Milchwaegung from './Milchwaegung'
import PregnancyEntry from './PregnancyEntry'
import TreatmentJournal from './TreatmentJournal'
import { loadVet, type VetData } from '../lib/vetVisit'
import { loadMilk, sortMilkRows, summarize, type MilkRow, type MilkSort } from '../lib/milkAmounts'

// Stallkalender mit Arbeitsfokus: Jungtiere (Hinweise + Tränkeplan), Melken, Tierarzt, Milchwägung.
// Jeder Fokus hat unten seine Werkzeugleiste; die Tier-Info lässt sich über jeden Fokus ein- und
// ausblenden und zeigt das Tier im Fokus, solange nichts im Suchfeld steht.

type Focus = 'jungtiere' | 'melken' | 'tierarzt' | 'milchwaegung'
const FOCI: { key: Focus; icon: string; label: string }[] = [
  { key: 'jungtiere', icon: '🍼', label: 'Jungtiere' },
  { key: 'melken', icon: '🥛', label: 'Melken' },
  { key: 'tierarzt', icon: '🩺', label: 'Tierarzt' },
  { key: 'milchwaegung', icon: '⚖️', label: 'Milchwägung' },
]

const INFO_KEY = 'fmis_stall_info_open'
const readInfoOpen = () => {
  try {
    return localStorage.getItem(INFO_KEY) === '1'
  } catch {
    return false
  }
}

/** Höhe des festen Bereichs unten (Rückgängig, Werkzeugleiste, Menü), damit die Tier-Info darüber sitzt. */
function useBottomOffset(): number {
  const [h, setH] = useState(120)
  useEffect(() => {
    const bar = document.getElementById(FOOTER_SLOT_ID)?.parentElement
    if (!bar) return
    const measure = () => setH(Math.round(bar.getBoundingClientRect().height))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])
  return h
}

const mod = (path: string) => ({ to: `../${path}`, relative: 'path' as const })

export default function Stall({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const sheep = species === 'sheep'
  const today = localTodayIso()
  const { rules, update, reset } = useStallRules(moduleKey, species)
  const [params, setParams] = useSearchParams()
  const focus: Focus = FOCI.some((f) => f.key === params.get('fokus')) ? (params.get('fokus') as Focus) : 'jungtiere'
  const ansicht = params.get('ansicht')
  const view = ansicht === 'plan' ? 'plan' : 'hinweise'
  const vetView: VetView = VET_VIEWS.some((v) => v.key === ansicht) ? (ansicht as VetView) : 'besuch'
  const tier = params.get('tier')
  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v == null) n.delete(k)
        else n.set(k, v)
        return n
      },
      { replace: true },
    )
  const [infoOpen, setInfoOpenState] = useState(readInfoOpen)
  const setInfoOpen = (open: boolean) => {
    setInfoOpenState(open)
    try {
      localStorage.setItem(INFO_KEY, open ? '1' : '0')
    } catch {
      // nur bis zum Neuladen
    }
  }
  const bottom = useBottomOffset()

  const { data } = useQuery((pg) => loadStall(pg, species, today, rules), [species, today, rules])
  const vet = useQuery((pg) => loadVet(pg, today, rules), [today, rules]).data
  const bans = useMemo(() => new Map((data?.today.withdrawals ?? []).map((w) => [w.id, w.until])), [data])
  const milkLoaded = useQuery((pg) => loadMilk(pg, today), [today]).data
  const milk = useMemo(() => milkLoaded?.map((r) => ({ ...r, banUntil: bans.get(r.animal.id) ?? null })), [milkLoaded, bans])
  const hints = useMemo(
    () => (data ? buildStallHints({ lambs: data.lambs, decisions: data.decisions, expected: data.expected, dryIds: data.dryIds, species, rules, today }) : []),
    [data, species, rules, today],
  )
  const plan = useMemo(() => (data ? buildFeedingPlan(data.lambs, data.decisions, species, rules, today) : []), [data, species, rules, today])

  const focusAnimal = (id: string | null) => {
    if (!id) return
    setParam('tier', id)
    setInfoOpen(true)
  }

  const tools: Record<Focus, ReactNode> = {
    jungtiere: (
      <>
        <ToolLink {...mod(`laemmer?aktion=waegen${tier ? `&tier=${tier}` : ''}`)} icon="⚖️" label="Wägen" />
        <ToolLink {...mod(`laemmer?aktion=fuetterung${tier ? `&tier=${tier}` : ''}`)} icon="🍼" label="Schoppen" />
        <ToolLink {...mod(`laemmer?aktion=behandlung${tier ? `&tier=${tier}` : ''}`)} icon="💉" label="Behandlung" />
        <ToolLink {...mod('geburt')} icon={sheep ? '🐑' : '🐄'} label={sheep ? 'Ablammung' : 'Abkalbung'} />
      </>
    ),
    melken: (
      <>
        <ToolLink {...mod('leistung')} icon="🥛" label="Leistung" />
        <ToolLink {...mod('milchwaegung')} icon="⚖️" label="Milchwägung" />
        <ToolLink {...mod('journal')} icon="🚫" label="Absetzfrist" />
      </>
    ),
    tierarzt: (
      <>
        {VET_VIEWS.filter((v) => v.key !== 'besuch').map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setParam('ansicht', vetView === v.key ? null : v.key)}
            aria-pressed={vetView === v.key}
            className={`flex min-h-11 items-center gap-1 rounded-lg border-2 px-3 font-semibold ${vetView === v.key ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-gray-300 bg-white text-gray-800'}`}
          >
            <span aria-hidden>{v.icon}</span> {v.short}
          </button>
        ))}
        <ToolLink {...mod('klauen')} icon="🐾" label="Klauen" />
      </>
    ),
    milchwaegung: (
      <>
        <ToolLink {...mod('leistung')} icon="🥛" label="Leistung" />
        <ToolLink {...mod('journal')} icon="🚫" label="Absetzfrist" />
      </>
    ),
  }

  return (
    <div className={`mx-auto space-y-3 p-3 ${focus === 'tierarzt' && vetView === 'journal' ? 'max-w-3xl' : 'max-w-lg'}`} style={{ paddingBottom: infoOpen ? '58vh' : '9rem' }}>
      {/* in den eingebetteten Seiten (Milchwägung, Tierarzt ausser «Besuch») steht deren eigener Titel */}
      {!(focus === 'milchwaegung' || (focus === 'tierarzt' && vetView !== 'besuch')) && (
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-gray-800">Stall</h1>
          <span className="text-sm text-gray-600">{fmtDate(today)}</span>
        </div>
      )}

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1" role="tablist" aria-label="Arbeitsfokus">
        {FOCI.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={focus === f.key}
            onClick={() =>
              setParams(
                (p) => {
                  const n = new URLSearchParams(p)
                  if (f.key === 'jungtiere') n.delete('fokus')
                  else n.set('fokus', f.key)
                  n.delete('ansicht')
                  return n
                },
                { replace: true },
              )
            }
            className={`flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border-2 px-4 font-semibold ${focus === f.key ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-800'}`}
          >
            <span aria-hidden>{f.icon}</span>
            {f.label}
          </button>
        ))}
      </div>

      {!data && <p className="py-6 text-center text-gray-500">Lädt…</p>}

      {data && focus === 'jungtiere' && (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200 p-1" role="tablist">
            {(['hinweise', 'plan'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setParam('ansicht', v === 'plan' ? 'plan' : null)}
                className={`min-h-11 rounded-lg font-semibold ${view === v ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-700'}`}
              >
                {v === 'hinweise' ? `Hinweise${hints.length ? ` (${hints.length})` : ''}` : 'Tränkeplan'}
              </button>
            ))}
          </div>
          {view === 'hinweise' ? (
            <Hints hints={hints} data={data} rules={rules} today={today} moduleKey={moduleKey} sheep={sheep} tier={tier} onFocus={focusAnimal} />
          ) : (
            <FeedingPlan plan={plan} data={data} today={today} tier={tier} onFocus={focusAnimal} sheep={sheep} />
          )}
        </>
      )}

      {data && focus === 'melken' && <Melken data={data} milk={milk} today={today} tier={tier} onFocus={focusAnimal} />}
      {data && focus === 'tierarzt' && (
        <Tierarzt data={data} vet={vet} today={today} moduleKey={moduleKey} view={vetView} onView={(v) => setParam('ansicht', v === 'besuch' ? null : v)} onFocus={focusAnimal} tier={tier} />
      )}
      {focus === 'milchwaegung' && (
        <div className="-mx-3">
          <Milchwaegung moduleKey={moduleKey} />
        </div>
      )}

      <details className="rounded-xl bg-white p-3 shadow-sm">
        <summary className="cursor-pointer font-semibold text-gray-800">⚙️ Regeln für die Hinweise</summary>
        <RulesForm species={species} rules={rules} onChange={update} onReset={reset} />
      </details>

      {infoOpen && (
        <div className="fixed inset-x-0 z-10 flex max-h-[55vh] flex-col rounded-t-2xl border-t-2 border-brand-700 bg-gray-100 shadow-[0_-4px_12px_rgba(0,0,0,0.15)] lg:left-52" style={{ bottom }}>
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-sm font-semibold text-gray-700">Tier-Info</span>
            <button type="button" onClick={() => setInfoOpen(false)} aria-label="Tier-Info ausblenden" className="grid h-10 w-10 place-items-center rounded-full text-lg active:bg-gray-200">
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AnimalInfo moduleKey={moduleKey} embedded />
          </div>
        </div>
      )}

      <FooterBar>
        <button
          type="button"
          onClick={() => setInfoOpen(!infoOpen)}
          aria-pressed={infoOpen}
          className={`flex min-h-11 items-center gap-1 rounded-lg border-2 px-3 font-semibold ${infoOpen ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-400 bg-white text-gray-800'}`}
        >
          <span aria-hidden>ⓘ</span> Tier-Info
        </button>
        {tools[focus]}
      </FooterBar>
    </div>
  )
}

function ToolLink({ to, relative, icon, label }: { to: string; relative: 'path'; icon: string; label: string }) {
  return (
    <Link to={to} relative={relative} className="flex min-h-11 items-center gap-1 rounded-lg border-2 border-gray-300 bg-white px-3 font-semibold text-gray-800 active:bg-gray-50">
      <span aria-hidden>{icon}</span> {label}
    </Link>
  )
}

// ---- Hinweise ----

const KIND_ICON: Record<HintKind, string> = { eimer: '🪣', absetzen: '✂️', milchzusatz: '🥛', abtraenken: '🍼', trockenstellen: '🛑' }

function kindText(kind: HintKind, rules: StallRules, sheep: boolean): { title: string; help: string } {
  switch (kind) {
    case 'eimer':
      return { title: 'Auf Eimer umstellen?', help: `Lämmer ab Tag ${rules.eimerDay}: Eimer, bei der Mutter aufziehen oder später entscheiden. Meist für die ganze Gruppe.` }
    case 'absetzen':
      return { title: sheep ? 'Lämmer absetzen' : 'Absetzen', help: `Bei der Mutter aufgezogen, ab ca. Tag ${rules.absetzenDay}.` }
    case 'milchzusatz':
      return { title: 'Milchzusatz beenden', help: `Kälber: Milchzusatz bis ca. Tag ${rules.milchzusatzDays}, dann absetzen.` }
    case 'abtraenken':
      return { title: 'Abtränken', help: `Kälber ab ca. Tag ${rules.abtraenkenDays} (3,5 Monate).` }
    case 'trockenstellen':
      return { title: 'Trockenstellen', help: `${rules.trockenDays} Tage vor der erwarteten ${sheep ? 'Ablammung' : 'Abkalbung'}.` }
  }
}

function Hints({ hints, data, rules, today, moduleKey, sheep, tier, onFocus }: { hints: StallHint[]; data: StallData; rules: StallRules; today: string; moduleKey: string; sheep: boolean; tier: string | null; onFocus: (id: string | null) => void }) {
  if (hints.length === 0) return <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Nichts fällig in den nächsten {rules.lookaheadDays} Tagen. 👍</p>
  return (
    <div className="space-y-3">
      {hints.map((h) => (
        <HintCard key={h.kind} hint={h} data={data} rules={rules} today={today} moduleKey={moduleKey} sheep={sheep} tier={tier} onFocus={onFocus} />
      ))}
    </div>
  )
}

function HintCard({ hint, data, rules, today, moduleKey, sheep, tier, onFocus }: { hint: StallHint; data: StallData; rules: StallRules; today: string; moduleKey: string; sheep: boolean; tier: string | null; onFocus: (id: string | null) => void }) {
  const db = useDb()
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const t = kindText(hint.kind, rules, sheep)
  const chosen = hint.items.filter((i) => !skipped.has(i.key))
  const toggle = (key: string) =>
    setSkipped((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const decide = (step: DecisionStep, decision: DecisionValue, text: string, until: string | null = null) =>
    run(`${chosen.length} ${text}`, async () => {
      await saveDecisions(db, chosen.flatMap((i) => (i.lamb ? [i.lamb] : [])), step, decision, today, until)
    })
  async function run(label: string, fn: () => Promise<void>) {
    if (chosen.length === 0) return
    setBusy(true)
    try {
      await undoAction(label, fn)
      notifySuccess(label)
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const animalIds = chosen.flatMap((i) => (i.lamb?.animalId ?? i.animal?.id ?? []))
  const btn = 'min-h-12 flex-1 rounded-lg border-2 px-3 font-semibold disabled:opacity-50'
  const primary = `${btn} border-brand-700 bg-brand-700 text-white`
  const secondary = `${btn} border-gray-400 bg-white text-gray-800`

  return (
    <section className="rounded-xl bg-white shadow-sm">
      <header className="px-4 pt-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <span aria-hidden>{KIND_ICON[hint.kind]}</span> {t.title}
          <span className="ml-auto rounded-full bg-amber-700 px-2.5 py-0.5 text-sm font-bold text-white">{hint.items.length}</span>
        </h2>
        <p className="text-sm text-gray-600">{t.help}</p>
      </header>
      <ul className="mt-1 divide-y">
        {hint.items.map((i) => (
          <ItemRow key={i.key} item={i} data={data} today={today} checked={!skipped.has(i.key)} onToggle={() => toggle(i.key)} focused={!!tier && (i.lamb?.animalId === tier || i.animal?.id === tier)} onFocus={onFocus} />
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 p-3">
        {hint.kind === 'eimer' && (
          <>
            <button type="button" disabled={busy || !chosen.length} onClick={() => void decide('eimer', 'eimer', 'auf Eimer umgestellt')} className={primary}>
              🪣 Auf Eimer ({chosen.length})
            </button>
            <button type="button" disabled={busy || !chosen.length} onClick={() => void decide('eimer', 'mutter', 'bei der Mutter aufziehen')} className={primary}>
              🐑 Bei Mutter ({chosen.length})
            </button>
            <button type="button" disabled={busy || !chosen.length} onClick={() => void decide('eimer', 'spaeter', 'später entscheiden', addDays(today, 3))} className={secondary}>
              ⏳ Später (3 Tage)
            </button>
          </>
        )}
        {(hint.kind === 'absetzen' || hint.kind === 'abtraenken') && (
          <Link
            {...mod(`laemmer?aktion=absetzen&tier=${chosen.flatMap((i) => (i.lamb ? [i.lamb.animalId ?? i.lamb.key] : [])).join(',')}`)}
            className={`${primary} flex items-center justify-center ${chosen.length ? '' : 'pointer-events-none opacity-50'}`}
          >
            ✂️ {hint.kind === 'abtraenken' ? 'Abtränken' : 'Absetzen'} ({chosen.length}) …
          </Link>
        )}
        {hint.kind === 'milchzusatz' && (
          <button type="button" disabled={busy || !chosen.length} onClick={() => void decide('milchzusatz', 'erledigt', 'Milchzusatz beendet')} className={primary}>
            ✓ Milchzusatz beendet ({chosen.length})
          </button>
        )}
        {hint.kind === 'trockenstellen' && (
          <button
            type="button"
            disabled={busy || !chosen.length}
            onClick={() => void run(`${chosen.length} trockengestellt`, async () => void (await animalProvider(moduleKey)?.dryOff?.(animalIds, today, 'Trockengestellt (Stallkalender)')))}
            className={primary}
          >
            🛑 Heute trockenstellen ({chosen.length})
          </button>
        )}
      </div>
    </section>
  )
}

function ItemRow({ item, data, today, checked, onToggle, focused, onFocus }: { item: HintItem; data: StallData; today: string; checked: boolean; onToggle: () => void; focused: boolean; onFocus: (id: string | null) => void }) {
  const l = item.lamb
  const title = l ? lambTitle(l, data.damLabel) : `${item.animal!.lauf_nr ? `${item.animal!.lauf_nr} · ` : ''}${shortEarTag(item.animal!.ear_tag)}${item.animal!.name ? ` ${item.animal!.name}` : ''}`
  const state = dueState(item.due, today)
  const animalId = l?.animalId ?? item.animal?.id ?? null
  return (
    <li className={`flex items-center ${focused ? 'bg-brand-50' : ''}`}>
      <label className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center">
        <input type="checkbox" checked={checked} onChange={onToggle} className="h-5 w-5 accent-brand-700" aria-label={`${title} wählen`} />
      </label>
      <button type="button" onClick={() => onFocus(animalId)} disabled={!animalId} className="min-h-12 min-w-0 flex-1 py-1 pr-3 text-left disabled:cursor-default">
        <span className="block truncate font-medium text-gray-900">{title}</span>
        <span className={`block text-sm ${state === 'ueberfaellig' ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
          {l ? `${l.ageDays} T.${l.litter > 1 ? ` · Wurf ${l.litter}` : ''} · ` : ''}
          {item.expected ? `erw. ${fmtDate(item.expected)} · ` : ''}
          {dueText(item.due, today)}
        </span>
      </button>
    </li>
  )
}

// ---- Tränkeplan ----

const PHASE_TEXT: Record<PhaseKey, { icon: string; title: string }> = {
  neu: { icon: '🆕', title: 'Neu, Entscheid steht an' },
  spaeter: { icon: '⏳', title: 'Entscheid zurückgestellt' },
  eimer: { icon: '🪣', title: 'Auf Eimer' },
  mutter: { icon: '🐑', title: 'Bei der Mutter' },
  zusatz: { icon: '🥛', title: 'Milch mit Zusatz' },
  milch: { icon: '🍼', title: 'Milch' },
}

function FeedingPlan({ plan, data, today, tier, onFocus, sheep }: { plan: ReturnType<typeof buildFeedingPlan>; data: StallData; today: string; tier: string | null; onFocus: (id: string | null) => void; sheep: boolean }) {
  if (plan.length === 0) return <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Keine saugenden {sheep ? 'Lämmer' : 'Kälber'}.</p>
  return (
    <div className="space-y-3">
      {plan.map((p) => (
        <section key={p.key} className="rounded-xl bg-white shadow-sm">
          <h2 className="flex items-center gap-2 px-4 pt-3 text-base font-bold text-gray-900">
            <span aria-hidden>{PHASE_TEXT[p.key].icon}</span> {PHASE_TEXT[p.key].title}
            <span className="ml-auto rounded-full bg-gray-700 px-2.5 py-0.5 text-sm font-bold text-white">{p.lambs.length}</span>
          </h2>
          <ul className="mt-1 divide-y">
            {p.lambs.map(({ lamb: l, next }) => (
              <li key={l.key} className={tier && l.animalId === tier ? 'bg-brand-50' : ''}>
                <button type="button" onClick={() => onFocus(l.animalId)} disabled={!l.animalId} className="flex min-h-12 w-full items-center gap-2 px-4 py-1 text-left disabled:cursor-default">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-900">{lambTitle(l, data.damLabel)}</span>
                    <span className="block text-sm text-gray-600">
                      {l.ageDays} T.{l.litter > 1 ? ` · Wurf ${l.litter}` : ''}
                      {l.weights.length ? ` · ${l.weights[l.weights.length - 1].kg} kg` : ''}
                    </span>
                  </span>
                  {next && (
                    <span className={`shrink-0 text-right text-sm ${next.due < today ? 'font-semibold text-red-700' : 'text-gray-700'}`}>
                      {next.text}
                      <span className="block text-xs">{dueText(next.due, today)}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ---- weitere Foki (erste Fassung: das Dringende aus «Heute») ----

const SORT_LABEL: Record<MilkSort, string> = { menge: 'Menge', tag: 'Laktationstag', nummer: 'Nummer' }

/** Melken: Melkverbote und die Milchmengen der melkenden Tiere (letzte Milchprüfung). */
function Melken({ data, milk, today, tier, onFocus }: { data: StallData; milk: MilkRow[] | undefined; today: string; tier: string | null; onFocus: (id: string | null) => void }) {
  const w = data.today.withdrawals
  const [sort, setSort] = useState<MilkSort>('menge')
  const [onlyBan, setOnlyBan] = useState(false)
  const rows = useMemo(() => (milk ? sortMilkRows(milk, sort).filter((r) => !onlyBan || r.banUntil) : []), [milk, sort, onlyBan])
  const sum = useMemo(() => summarize(milk ?? []), [milk])
  const name = (a: { lauf_nr: string | null; ear_tag: string; name: string | null }) => `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}${a.name ? ` ${a.name}` : ''}`
  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">Melkverbot (Absetzfrist Milch) · {w.length}</h2>
        {w.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Kein Tier mit Absetzfrist. 👍</p>
        ) : (
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {w.map((a) => (
              <li key={a.id} className={tier === a.id ? 'bg-brand-50' : ''}>
                <button type="button" onClick={() => onFocus(a.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left">
                  <span aria-hidden>🚫</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-red-800">{name(a)}</span>
                    <span className="block text-sm text-gray-600">nicht abliefern bis und mit {fmtDate(a.until)} · {dueText(a.until, today)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">Milchmengen (letzte Milchprüfung)</h2>
        {!milk ? (
          <p className="text-center text-gray-500">Lädt…</p>
        ) : milk.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Keine melkenden Tiere mit Milchprüfung.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {[
                ['melkend', String(sum.count)],
                ['Summe kg/Tag', String(sum.sumKg)],
                ['Ø kg/Tier', sum.avgKg != null ? String(sum.avgKg) : '–'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-white px-2 py-1.5 shadow-sm">
                  <div className="text-lg font-bold leading-tight text-gray-900">{value}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(SORT_LABEL) as MilkSort[]).map((k) => (
                <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={`min-h-11 rounded-full border px-3 text-sm ${sort === k ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-300 bg-white text-gray-800'}`}>
                  {SORT_LABEL[k]}
                </button>
              ))}
              {sum.banned > 0 && (
                <button type="button" aria-pressed={onlyBan} onClick={() => setOnlyBan(!onlyBan)} className={`min-h-11 rounded-full border px-3 text-sm ${onlyBan ? 'border-red-700 bg-red-700 font-semibold text-white' : 'border-gray-300 bg-white text-gray-800'}`}>
                  🚫 nur Melkverbot ({sum.banned})
                </button>
              )}
            </div>
            <ul className="divide-y rounded-xl bg-white shadow-sm">
              {rows.map((r) => (
                <li key={r.animal.id} className={tier === r.animal.id ? 'bg-brand-50' : ''}>
                  <button type="button" onClick={() => onFocus(r.animal.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left">
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${r.banUntil ? 'text-red-800' : 'text-gray-900'}`}>
                        {r.banUntil && <span aria-hidden>🚫 </span>}
                        {name(r.animal)}
                      </span>
                      <span className="block text-sm text-gray-600">
                        {r.dim != null ? `Tag ${r.dim} · ` : ''}
                        geprüft {fmtDate(r.testDate)}
                        {r.testAgeDays > 60 ? ' (alt)' : ''}
                        {r.cells != null ? ` · ${r.cells} Zellen` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-lg font-bold text-gray-900">{r.kg} kg</span>
                      {r.delta != null && r.delta !== 0 && <span className={`block text-xs font-semibold ${r.delta < 0 ? 'text-red-700' : 'text-green-700'}`}>{r.delta > 0 ? '▲' : '▼'} {Math.abs(r.delta)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

type VetView = 'besuch' | 'traechtigkeit' | 'behandlung' | 'journal'
const VET_VIEWS: { key: VetView; icon: string; label: string; short: string }[] = [
  { key: 'besuch', icon: '🩺', label: 'Besuch', short: 'Besuch' },
  { key: 'traechtigkeit', icon: '🤰', label: 'Trächtigkeit', short: 'Trächtigkeit' },
  { key: 'behandlung', icon: '💉', label: 'Behandlung', short: 'Behandlung' },
  { key: 'journal', icon: '📒', label: 'Journal', short: 'Journal' },
]

/** Tierarzt: Besuch (was ansteht), Trächtigkeitskontrolle, Medikamentenabgabe (Behandlung) und Behandlungsjournal —
 * die bestehenden Erfassungsseiten, hier eingebettet. */
function Tierarzt({ data, vet, today, moduleKey, view, onView, onFocus, tier }: { data: StallData; vet: VetData | undefined; today: string; moduleKey: string; view: VetView; onView: (v: VetView) => void; onFocus: (id: string | null) => void; tier: string | null }) {
  const db = useDb()
  const r = data.today.reminders
  return (
    <>
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-gray-200 p-1" role="tablist" aria-label="Tierarzt">
        {VET_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => onView(v.key)}
            className={`min-h-11 truncate rounded-lg px-1 text-sm font-semibold ${view === v.key ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-700'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'traechtigkeit' && (
        <div className="-mx-3">
          <PregnancyEntry moduleKey={moduleKey} />
        </div>
      )}
      {view === 'behandlung' && (
        <div className="-mx-3">
          <JournalEntry moduleKey={moduleKey} />
        </div>
      )}
      {view === 'journal' && (
        <div className="-mx-3">
          <TreatmentJournal moduleKey={moduleKey} />
        </div>
      )}

      {view === 'besuch' && (
        <div className="space-y-3">
          <section className="space-y-2">
            <h2 className="flex items-center justify-between text-sm font-semibold text-gray-700">
              <span>Trächtigkeit untersuchen · {vet?.pending.length ?? '…'}</span>
              <button type="button" onClick={() => onView('traechtigkeit')} className="min-h-11 rounded-lg border-2 border-brand-700 px-3 font-semibold text-brand-800">
                🤰 Durchgang starten
              </button>
            </h2>
            {vet && vet.pending.length === 0 ? (
              <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Keine Tiere zum Untersuchen. 👍</p>
            ) : (
              <ul className="divide-y rounded-xl bg-white shadow-sm">
                {(vet?.pending ?? []).map((c) => (
                  <li key={c.animal.id} className={tier === c.animal.id ? 'bg-brand-50' : ''}>
                    <button type="button" onClick={() => onFocus(c.animal.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-gray-900">{`${c.animal.lauf_nr ? `${c.animal.lauf_nr} · ` : ''}${shortEarTag(c.animal.ear_tag)}${c.animal.name ? ` ${c.animal.name}` : ''}`}</span>
                        <span className="block text-sm text-gray-600">
                          belegt {fmtDate(c.serviceDate)} · Tag {c.daysSince} ({Math.floor(c.daysSince / 7)} Wo.){c.unsure ? ' · zuletzt unsicher' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="flex items-center justify-between text-sm font-semibold text-gray-700">
              <span>Heute abgegeben · {vet?.given.length ?? '…'}</span>
              <button type="button" onClick={() => onView('behandlung')} className="min-h-11 rounded-lg border-2 border-brand-700 px-3 font-semibold text-brand-800">
                💉 Behandlung erfassen
              </button>
            </h2>
            {vet && vet.given.length === 0 ? (
              <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Heute noch nichts ins Behandlungsjournal eingetragen.</p>
            ) : (
              <ul className="divide-y rounded-xl bg-white shadow-sm">
                {(vet?.given ?? []).map((g) => (
                  <li key={g.id} className="min-h-12 px-4 py-2">
                    <span className="block font-medium text-gray-900">{g.who}</span>
                    <span className="block text-sm text-gray-600">{g.what}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Pendenzen (Folgebehandlung, Kontrolle) · {r.length}</h2>
            {r.length === 0 ? (
              <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Keine offenen Pendenzen. 👍</p>
            ) : (
              <ul className="divide-y rounded-xl bg-white shadow-sm">
                {r.map((x) => (
                  <li key={x.id} className="flex items-center">
                    <Link {...mod(`tiere/${x.animal_id}#journal`)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-4 active:bg-gray-50">
                      <span className="min-w-0 flex-1">
                        <span className={`block font-medium ${x.due_date < today ? 'text-red-800' : 'text-gray-900'}`}>
                          {x.lauf_nr ? `${x.lauf_nr} · ` : ''}
                          {shortEarTag(x.ear_tag)}: {x.title}
                        </span>
                        <span className="block text-sm text-gray-600">{fmtDate(x.due_date)} · {dueText(x.due_date, today)}</span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => void undoAction(`Pendenz erledigt: ${x.title}`, () => completeReminder(db, x.id)).catch((e) => notifyError(errorText(e)))}
                      className="mx-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg border-2 border-green-700 text-lg font-bold text-green-800 active:bg-green-50"
                      aria-label={`${x.title} erledigt`}
                    >
                      ✓
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.today.withdrawals.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Absetzfrist Milch · {data.today.withdrawals.length}</h2>
              <ul className="divide-y rounded-xl bg-white shadow-sm">
                {data.today.withdrawals.map((a) => (
                  <li key={a.id} className="min-h-12 px-4 py-2">
                    <span className="block font-medium text-red-800">{`${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}`}</span>
                    <span className="block text-sm text-gray-600">bis und mit {fmtDate(a.until)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  )
}

function RulesForm({ species, rules, onChange, onReset }: { species: 'cattle' | 'sheep'; rules: StallRules; onChange: (r: StallRules) => void; onReset: () => void }) {
  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-gray-600">Gilt nur auf diesem Gerät. 0 schaltet den Hinweis aus.</p>
      {RULE_FIELDS[species].map((f) => (
        <label key={f.key} className="flex items-center justify-between gap-3 text-sm text-gray-800">
          <span>{f.label}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={rules[f.key]}
            onChange={(e) => {
              const v = Math.max(0, Math.round(Number(e.target.value)))
              if (Number.isFinite(v)) onChange({ ...rules, [f.key]: v })
            }}
            className="min-h-11 w-20 rounded-lg border-2 border-gray-400 px-2 text-right"
          />
        </label>
      ))}
      <button type="button" onClick={onReset} className="min-h-11 rounded-lg border-2 border-gray-400 px-3 font-semibold text-gray-800">
        Vorgaben wiederherstellen
      </button>
    </div>
  )
}
