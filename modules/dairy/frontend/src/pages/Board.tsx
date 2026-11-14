import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { animalProvider, refreshHerdData, type AnimalRef } from '@fmis/core/animals'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useDb } from '@fmis/core/DbContext'
import FilterBar from '@fmis/core/filters/FilterBar'
import FilterModal from '@fmis/core/filters/FilterModal'
import { applyFilters, countMatches, type FilterDef, type FilterResult } from '@fmis/core/filters/filterModel'
import { useSavedFilters } from '@fmis/core/filters/useSavedFilters'
import FooterBar from '@fmis/core/FooterBar'
import Modal from '@fmis/core/Modal'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction, useOnUndo } from '@fmis/core/undo'
import { dissolveGroup, loadHerdData, memberAt, moveAnimals, removeMembers, saveGroup, type HerdData } from '@fmis/tiere/lib/herds'
import { compositionAt } from '@fmis/tiere/lib/herdModel'
import GroupEditModal from '../components/GroupEditModal'
import { useQuery } from '../hooks/useQuery'
import BoardCardView from '../components/BoardCardView'
import { DragGhost, useBoardDrag } from '../components/boardDrag'
import { DEFAULT_MEAT_SETTINGS, FALLBACK_MEAT_PRICES, loadMeatSettings, meatValue, saveMeatSettings, sumMeat, MEAT_BANDS, MEAT_BAND_BAR, MEAT_BAND_LABEL, type MeatSettings, type MeatValue } from '../lib/meatValue'
import { useProviandePrices } from '../lib/proviandePrices'
import CardFieldsMenu from '../components/CardFieldsMenu'
import QueryInput from '../components/QueryInput'
import { describeCondition, matchesQuery, parseQuery, type QueryContext } from '../lib/boardQuery'
import { buildLanes, loadList, moveKey, orderColumns, saveList } from '../lib/columnLayout'
import { useColumnReorder } from '../hooks/useColumnReorder'
import CardLegend from '../components/CardLegend'
import { loadCardFields, saveCardFields, type CardFieldKey } from '../lib/cardFields'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'
import NumberInput from '@fmis/core/NumberInput'
import { columnKey, boardFields, boardPresets, buildCards, buildColumns, cardsInColumn, SORTS, sortCards, type BoardCard, type BoardColumn, type SortKey } from '../lib/board'
import { clearTargets, draftSize, effectiveGroup, groupByTarget, pruneDraft, setTargets, summarizeDraft, type DraftMoves } from '../lib/boardDraft'
import { SIRE_TRAIT } from '../lib/breedingTraits'
import { useCullingThresholds } from '../lib/cullingSettings'
import { fmtDate, localTodayIso } from '../lib/format'
import { loadHerdContext } from '../lib/herdContext'
import { loadNursingDams } from '../lib/lambs'
import { estimateAll, loadParentLinks } from '../lib/breedingEstimate'
import { DEFAULT_LAMB_MILK, loadDamMilk, loadLambMilkSettings, saveLambMilkSettings, type LambMilkSettings } from '../lib/lambMilk'
import { speciesOf, speciesTerms } from '../lib/species'
import { addToWatchlist, loadWatchlists, removeEntry } from '../lib/watchlists'

async function loadBoard(pg: PGlite, species: 'cattle' | 'sheep', today: string, milk: LambMilkSettings) {
  const trait = SIRE_TRAIT[species].trait
  const [context, lists, nursing, lambMilk, links] = await Promise.all([loadHerdContext(pg, species, today), loadWatchlists(pg), loadNursingDams(pg, today), loadDamMilk(pg, today, milk), loadParentLinks(pg, trait)])
  return { context, nursing, lambMilk, breedingEstimates: estimateAll(context, links, trait), ...lists }
}

const hiddenKey = (moduleKey: string) => `${moduleKey}_board_hidden_columns`
function readHidden(moduleKey: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(hiddenKey(moduleKey)) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
const sortStorage = (moduleKey: string) => `${moduleKey}_board_sort`

/** Dashboard am PC und Tablet: jede Tiergruppe und Merkliste eine Spalte, jedes Tier eine Karte.
 * Filter färben oder blenden aus; Karten lassen sich in eine andere Gruppe ziehen (als Entwurf, der
 * gesamthaft bestätigt wird) oder auf eine Merkliste (kommt sofort drauf, bleibt in der Gruppe). */
export default function Board({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const herdSpecies = species === 'sheep' ? 'schafe' : 'rinder'
  const terms = speciesTerms(moduleKey)
  const today = localTodayIso()
  const canMove = useHasPermission('tiere:herden:write') && !!animalProvider(moduleKey)
  const { thresholds } = useCullingThresholds(moduleKey, species)

  const [lambMilkSettings, setLambMilkSettings] = useState<LambMilkSettings>(() => loadLambMilkSettings(moduleKey))
  const { data } = useQuery((pg) => loadBoard(pg, species, today, lambMilkSettings), [species, today, lambMilkSettings])
  const [herd, setHerd] = useState<HerdData | null>(null)
  const [refs, setRefs] = useState<AnimalRef[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () => loadHerdData().then((d) => live && setHerd(d))
    void load()
      .then(() => refreshHerdData())
      .then((fresh) => fresh && live && load())
    void (animalProvider(moduleKey)?.listAnimals() ?? Promise.resolve([])).then((r) => live && setRefs(r))
    return () => {
      live = false
    }
  }, [moduleKey, data])

  // «Rückgängig» schreibt in die Ablage des Moduls Tiere: Gruppen neu lesen
  useOnUndo(() => void loadHerdData().then(setHerd))

  const groups = useMemo(
    () => (herd?.groups ?? []).filter((g) => g.active && g.species === herdSpecies).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de')),
    [herd, herdSpecies],
  )
  const groupName = useCallback((id: string | null) => (id == null ? 'Ohne Gruppe' : (groups.find((g) => g.id === id)?.name ?? '?')), [groups])

  // heutige Gruppe je Tier (nur Gruppen dieser Tierart, die es noch gibt)
  const current = useMemo(() => {
    const m = new Map<string, string | null>()
    if (!herd || !refs) return m
    const ok = new Set(groups.map((g) => g.id))
    for (const a of refs) {
      const mem = memberAt(herd, a.id, today)
      m.set(a.id, mem && ok.has(mem.group_id) ? mem.group_id : null)
    }
    return m
  }, [herd, refs, groups, today])

  const lists = useMemo(() => (data?.lists ?? []).filter((l) => !l.archived_at), [data])

  const cards = useMemo(
    () =>
      data && refs
        ? buildCards({
            species,
            today,
            thresholds,
            context: data.context,
            refs,
            groupOf: new Map([...current].filter((e): e is [string, string] => e[1] != null)),
            entries: data.entries,
            nursing: data.nursing,
            lambMilk: data.lambMilk,
            breedingEstimates: data.breedingEstimates,
            breedingTrait: SIRE_TRAIT[species].trait,
          })
        : [],
    [data, refs, species, today, thresholds, current],
  )
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  // Filter
  const fields = useMemo(() => boardFields(moduleKey, species, { groups, lists }), [moduleKey, species, groups, lists])
  const presets = useMemo(() => boardPresets(species), [species])
  const saved = useSavedFilters(`${moduleKey}_board_filters`, presets)
  const evalCtx = useMemo(() => ({ today }), [today])
  const [editing, setEditing] = useState<{ filter?: FilterDef } | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>(() => {
    try {
      const v = localStorage.getItem(sortStorage(moduleKey)) as SortKey | null
      return v && SORTS.some((s) => s.key === v) ? v : 'nr'
    } catch {
      return 'nr'
    }
  })
  const counts = useMemo(() => Object.fromEntries(saved.filters.map((f) => [f.id, countMatches(cards, f, fields, evalCtx)])), [saved.filters, cards, fields, evalCtx])
  const results = useMemo(() => {
    const m = new Map<string, FilterResult>()
    for (const c of cards) m.set(c.id, applyFilters(c, saved.filters, saved.modes, fields, evalCtx))
    return m
  }, [cards, saved.filters, saved.modes, fields, evalCtx])
  // Entwurf Gruppenwechsel
  const [draft, setDraft] = useState<DraftMoves>({})
  useEffect(() => {
    if (current.size === 0) return
    setDraft((d) => {
      const p = pruneDraft(d, current, (id) => groups.some((g) => g.id === id))
      return draftSize(p) === draftSize(d) ? d : p
    })
  }, [current, groups])
  const groupOf = useCallback((id: string) => effectiveGroup(draft, id, current), [draft, current])
  const [confirming, setConfirming] = useState(false)

  // Spalten, Auswahl, Aufklappen
  const [columnOrder, setColumnOrder] = useState<string[]>(() => loadList(moduleKey, 'column_order'))
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(loadList(moduleKey, 'collapsed_columns')))
  const baseColumns = useMemo(() => buildColumns(groups, lists), [groups, lists])
  const columns = useMemo(() => orderColumns(baseColumns, columnOrder), [baseColumns, columnOrder])
  function toggleCollapsed(key: string, on?: boolean) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (on ?? !next.has(key)) next.add(key)
      else next.delete(key)
      saveList(moduleKey, 'collapsed_columns', [...next])
      return next
    })
  }
  function setAllCollapsed(on: boolean) {
    const next = on ? new Set(columns.map((c) => c.key)) : new Set<string>()
    setCollapsed(next)
    saveList(moduleKey, 'collapsed_columns', [...next])
  }
  function moveColumn(from: string, to: string, after: boolean) {
    const next = moveKey(columnOrder, baseColumns.map((c) => c.key), from, to, after)
    setColumnOrder(next)
    saveList(moduleKey, 'column_order', next)
  }

  // Fleischwert (nur Schafe): geschätzter Schlachterlös je Tier und Summe je Spalte, mit Proviande-Preisen
  const [showLegend, setShowLegend] = useState(false)
  const [editGroup, setEditGroup] = useState<string | null>(null)
  const [cardFields, setCardFields] = useState<CardFieldKey[]>(() => loadCardFields(moduleKey))
  const [meatOn, setMeatOn] = useState(() => {
    try {
      return localStorage.getItem(`${moduleKey}_meat_on`) === '1'
    } catch {
      return false
    }
  })
  const [meatSettings, setMeatSettings] = useState<MeatSettings>(() => loadMeatSettings(moduleKey))
  const proviande = useProviandePrices(species)
  const meatPrices = useMemo(() => ({ lamb: proviande?.young ?? FALLBACK_MEAT_PRICES.lamb, sheep: proviande?.adult ?? FALLBACK_MEAT_PRICES.sheep }), [proviande])
  const meatDate = meatSettings.slaughterDate || today
  // Suchfeld: Freitext und Bedingungen wie «ZZ > 200» (lib/boardQuery.ts)
  const parsed = useMemo(() => parseQuery(search), [search])
  const meatQueryOn = parsed.conditions.some((c) => c.field.key === 'fleisch')
  const meatById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof meatValue>>()
    if (species === 'sheep' && (meatOn || cardFields.includes('meat') || meatQueryOn)) for (const c of cards) m.set(c.id, meatValue(c.birthDate, meatDate, meatSettings, meatPrices))
    return m
  }, [cards, species, meatOn, cardFields, meatQueryOn, meatDate, meatSettings, meatPrices])
  const queryCtx = useMemo<QueryContext>(
    () => ({
      groupName: (c) => groups.find((g) => g.id === c.groupId)?.name ?? null,
      listNames: (c) => c.listIds.map((id) => lists.find((l) => l.id === id)?.name ?? ''),
      meat: (c) => meatById.get(c.id)?.net ?? null,
    }),
    [groups, lists, meatById],
  )
  const shown = useMemo(() => cards.filter((c) => results.get(c.id)?.visible && matchesQuery(c, parsed, queryCtx)), [cards, results, parsed, queryCtx])
  const meatMax = useMemo(() => Math.max(1, ...[...meatById.values()].map((v) => v?.net ?? 0)), [meatById])
  function toggleMeat() {
    const next = !meatOn
    setMeatOn(next)
    try {
      localStorage.setItem(`${moduleKey}_meat_on`, next ? '1' : '0')
    } catch {
      // nur bis zum Neuladen
    }
  }
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(moduleKey))
  const [showColumns, setShowColumns] = useState(false)
  // Sprung aus dem Einzeltier (?gruppe=herde:<id>&tier=<id>): die Gruppe steht im Blick, das Tier ist hervorgehoben
  const [params] = useSearchParams()
  const jumpGroup = params.get('gruppe')?.replace(/^herde:/, '') ?? null
  const jumpTier = params.get('tier')
  const jumpKey = jumpGroup ? columnKey('group', jumpGroup) : null
  const visibleColumns = columns.filter((c) => !hidden.has(c.key) || c.key === jumpKey)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  function setHiddenCols(next: Set<string>) {
    setHidden(next)
    try {
      localStorage.setItem(hiddenKey(moduleKey), JSON.stringify([...next]))
    } catch {
      // nur bis zum Neuladen
    }
  }
  function changeSort(v: SortKey) {
    setSort(v)
    try {
      localStorage.setItem(sortStorage(moduleKey), v)
    } catch {
      // nur bis zum Neuladen
    }
  }

  // Aktionen
  function moveToDraft(ids: string[], target: string | null) {
    if (!canMove) {
      notifyError('Für Gruppenwechsel fehlt die Berechtigung (Tiergruppen).')
      return
    }
    setDraft((d) => setTargets(d, ids, target, current))
  }

  async function addToList(listId: string, ids: string[]) {
    const list = lists.find((l) => l.id === listId)
    if (!list) return
    try {
      const added = await undoAction(`Merkliste «${list.name}»`, () => addToWatchlist(db, listId, ids, null))
      notifySuccess(added === 0 ? `Schon auf «${list.name}»` : `${added} ${added === 1 ? 'Tier' : 'Tiere'} auf «${list.name}»`)
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  async function removeFromList(listId: string, animalId: string) {
    const list = lists.find((l) => l.id === listId)
    const entry = data?.entries.find((e) => e.list_id === listId && e.animal_id === animalId && !e.done_at)
    if (!list || !entry) return
    try {
      await undoAction(`Von Merkliste «${list.name}» genommen`, () => removeEntry(db, entry.id))
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  const scroller = useRef<HTMLDivElement | null>(null)
  const colDrag = useColumnReorder({ onMove: moveColumn, scroller })
  const { drag, hover, pointerDown, ghost } = useBoardDrag({
    enabled: true,
    scroller,
    idsFor: (id) => (selected.has(id) ? [...selected] : [id]),
    labelFor: (ids) => (ids.length === 1 ? `${cardById.get(ids[0])?.laufNr ?? cardById.get(ids[0])?.shortTag ?? 'Tier'}` : `${ids.length} Tiere`),
    onDrop: (ids, key) => {
      const col = columns.find((c) => c.key === key)
      if (!col) return
      if (col.kind === 'group') moveToDraft(ids, col.id)
      else void addToList(col.id!, ids)
      if (ids.length > 1) setSelected(new Set())
    },
  })

  const columnCards = useCallback((col: BoardColumn) => sortCards(cardsInColumn(col, shown, groupOf), sort), [shown, groupOf, sort])

  const loading = !data || !herd || !refs
  useEffect(() => {
    if (loading || !jumpKey) return
    if (jumpTier) setOpen((o) => (o.has(`${jumpKey}:${jumpTier}`) ? o : new Set([...o, `${jumpKey}:${jumpTier}`])))
    const timers = [150, 600].map((ms) =>
      setTimeout(() => {
        const col = [...document.querySelectorAll<HTMLElement>('[data-drop-col]')].find((e) => e.dataset.dropCol === jumpKey)
        col?.scrollIntoView({ inline: 'start', block: 'nearest' })
        const card = jumpTier ? col?.querySelector<HTMLElement>(`[data-card="${CSS.escape(jumpTier)}"]`) : null
        if (card) {
          card.scrollIntoView({ block: 'center' })
          card.classList.add('ring-4', 'ring-amber-400')
          setTimeout(() => card.classList.remove('ring-4', 'ring-amber-400'), 4000)
        }
      }, ms),
    )
    return () => timers.forEach(clearTimeout)
    // einmal je Sprung: nach dem Laden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, jumpKey, jumpTier])
  const pending = draftSize(draft)
  const chosen = [...selected].filter((id) => cardById.has(id))

  function renderColumn(col: BoardColumn, stacked: boolean) {
    const list = columnCards(col)
    const isCollapsed = collapsed.has(col.key)
    const dropTarget = colDrag.target?.key === col.key ? colDrag.target : null
    const meatSum = meatOn && species === 'sheep' && list.length > 0 ? sumMeat(list.map((c) => meatById.get(c.id) ?? null)) : null
    const icon = col.kind === 'list' ? '🔖' : species === 'sheep' ? '🐑' : '🐄'
    return (
      <section
        key={col.key}
        data-drop-col={col.key}
        data-col-key={col.key}
        data-stacked={stacked ? '1' : undefined}
        aria-label={col.title}
        className={`relative shrink-0 snap-start rounded-xl p-2 ${stacked ? 'w-full' : 'w-72'} ${hover === col.key ? 'bg-brand-50 ring-2 ring-brand-700' : 'bg-gray-100'} ${colDrag.drag?.key === col.key ? 'opacity-50' : ''}`}
      >
        {dropTarget && <span aria-hidden className={`absolute z-10 rounded bg-brand-700 ${stacked ? 'inset-x-0 h-1' : 'inset-y-0 w-1'} ${dropTarget.after ? (stacked ? '-bottom-1.5' : '-right-2') : stacked ? '-top-1.5' : '-left-2'}`} />}
        <header className={`flex items-center gap-1 ${isCollapsed ? '' : 'mb-2'}`}>
          <span
            onPointerDown={colDrag.handleDown(col.key, col.title)}
            style={{ touchAction: 'none' }}
            role="img"
            aria-label={`Spalte «${col.title}» verschieben`}
            title="Ziehen, um die Spalte zu verschieben"
            className="grid h-9 w-7 shrink-0 cursor-grab place-items-center rounded text-lg text-gray-500 active:bg-gray-200"
          >
            ⠿
          </span>
          <button
            type="button"
            onClick={() => toggleCollapsed(col.key)}
            aria-expanded={!isCollapsed}
            aria-label={`Spalte «${col.title}» ${isCollapsed ? 'ausklappen' : 'einklappen'}`}
            title={isCollapsed ? 'Ausklappen' : 'Einklappen (mehrere eingeklappte Spalten stehen gestapelt)'}
            className="grid h-9 w-8 shrink-0 place-items-center rounded text-base text-gray-600 active:bg-gray-200"
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-gray-800">
            {icon} {col.title}
          </h2>
          <span className="text-xs text-gray-600">{list.length}</span>
          {!isCollapsed && (
            <button
              type="button"
              onClick={() => setSelected((sel) => (list.every((c) => sel.has(c.id)) ? new Set([...sel].filter((id) => !list.some((c) => c.id === id))) : new Set([...sel, ...list.map((c) => c.id)])))}
              disabled={list.length === 0}
              aria-label={`Alle in «${col.title}» auswählen`}
              title="Alle auswählen"
              className="grid h-9 w-9 place-items-center rounded text-lg text-gray-600 active:bg-gray-200 disabled:opacity-30"
            >
              ☑
            </button>
          )}
          {col.kind === 'group' && col.id && canMove && (
            <button type="button" onClick={() => setEditGroup(col.id)} aria-label={`Gruppe «${col.title}» umbenennen oder löschen`} title="Umbenennen oder löschen" className="grid h-9 w-9 place-items-center rounded text-lg text-gray-600 active:bg-gray-200">
              ⋮
            </button>
          )}
        </header>
        {isCollapsed ? (
          meatSum && (
            <div className="ml-[3.75rem] text-xs text-emerald-900">
              ≈ {Math.round(meatSum.net).toLocaleString('de-CH')} Fr. · {meatSum.lambs > 0 ? `${meatSum.lambs} L.` : ''}
              {meatSum.lambs > 0 && meatSum.sheep > 0 ? ' · ' : ''}
              {meatSum.sheep > 0 ? `${meatSum.sheep} S.` : ''}
            </div>
          )
        ) : (
          <>
            {meatOn && species === 'sheep' && list.length > 0 && <ColumnMeatSum values={list.map((c) => meatById.get(c.id) ?? null)} />}
            <div className="max-h-[calc(100vh-20rem)] min-h-20 space-y-2 overflow-y-auto pr-0.5">
              {list.map((c) => (
                <ColumnCard
                  key={c.id}
                  card={c}
                  col={col}
                  moduleKey={moduleKey}
                  today={today}
                  result={results.get(c.id)}
                  selected={selected.has(c.id)}
                  expanded={open.has(`${col.key}:${c.id}`)}
                  pendingTo={col.kind === 'group' && c.id in draft ? groupName(draft[c.id]) : null}
                  canDrag={true}
                  onSelect={() => setSelected((sel) => toggle(sel, c.id))}
                  onToggle={() => setOpen((o) => toggle(o, `${col.key}:${c.id}`))}
                  onUndoDraft={() => setDraft((d) => clearTargets(d, [c.id]))}
                  onRemoveFromList={col.kind === 'list' ? () => void removeFromList(col.id!, c.id) : undefined}
                  meat={meatById.get(c.id) ?? null}
                  meatMax={meatMax}
                  fields={cardFields}
                  pointerDown={pointerDown}
                />
              ))}
              {list.length === 0 && <p className="rounded-lg border-2 border-dashed border-gray-300 p-3 text-center text-xs text-gray-500">{hover === col.key ? 'Hier ablegen' : 'keine Tiere'}</p>}
            </div>
          </>
        )}
      </section>
    )
  }

  if (loading) return <p className="p-6 text-center text-gray-500">Lädt…</p>
  if (cards.length === 0) return <p className="p-6 text-center text-gray-600">Keine aktiven {terms.plural}. {terms.importHint}</p>

  return (
    <div className="space-y-3 p-3 pb-40">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold text-gray-800">Dashboard</h1>
        <QueryInput value={search} onChange={setSearch} parsed={parsed} groupNames={groups.map((g) => g.name)} listNames={lists.map((l) => l.name)} />
        <label className="relative" title="Sortierung der Karten in den Spalten">
          <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 16V4m0 0L3 7m3-3 3 3M14 4v12m0 0 3-3m-3 3-3-3" />
          </svg>
          <select value={sort} onChange={(e) => changeSort(e.target.value as SortKey)} aria-label="Sortierung" className="min-h-11 rounded-lg border-2 border-gray-300 bg-white pl-8 pr-2 text-sm">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {species === 'sheep' && (
          <button type="button" onClick={toggleMeat} aria-pressed={meatOn} className={`min-h-11 rounded-lg border-2 px-3 text-sm font-semibold ${meatOn ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white'}`}>
            🥩 Fleischwert
          </button>
        )}
        <button type="button" onClick={() => setShowLegend(true)} aria-label="Legende der Karten" title="Legende der Karten" className="grid h-11 w-11 place-items-center rounded-full border-2 border-gray-300 bg-white text-lg font-bold text-brand-700 active:bg-gray-100">
          ⓘ
        </button>
        <CardFieldsMenu
          species={species}
          selected={cardFields}
          onChange={(next) => {
            setCardFields(next)
            saveCardFields(moduleKey, next)
          }}
        />
        <button type="button" onClick={() => setShowColumns(true)} className="min-h-11 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm">
          Spalten ({visibleColumns.length}/{columns.length})
        </button>
      </div>

      <div className="flex items-start gap-2">
        <span className="mt-3 flex shrink-0 items-center gap-1 text-xs font-semibold text-gray-600" title="Filter: antippen = einfärben, nochmals = nur diese zeigen">
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M3 4h14l-5.5 6.5V16l-3 -1.5v-4z" />
          </svg>
          Filter
        </span>
        <div className="min-w-0 flex-1">
      <FilterBar
        filters={saved.filters}
        modes={saved.modes}
        counts={counts}
        fields={fields}
        onCycle={saved.cycle}
        onEdit={(f) => setEditing({ filter: f })}
        onNew={() => setEditing({})}
        onClear={saved.clearModes}
      />
        </div>
      </div>

      {(parsed.conditions.length > 0 || parsed.errors.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Erkannte Bedingungen der Suche">
          {parsed.conditions.map((c, i) => (
            <span key={`c${i}`} className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-900">
              {describeCondition(c)}
            </span>
          ))}
          {parsed.errors.map((e, i) => (
            <span key={`e${i}`} className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-900" title={e.text}>
              {e.reason}
            </span>
          ))}
          {parsed.free && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-800">Text: {parsed.free}</span>}
        </div>
      )}

      {meatOn && species === 'sheep' && (
        <SettingsEditor
          value={meatSettings}
          onSave={(v) => {
            setMeatSettings(v)
            saveMeatSettings(moduleKey, v)
          }}
          onReset={() => DEFAULT_MEAT_SETTINGS}
          label="Fleischwert"
          className="rounded-lg bg-white p-3 shadow-sm"
          title={
            <>
              Fleischwert am <b>{meatDate.split('-').reverse().join('.')}</b>
              {meatSettings.slaughterDate ? '' : ' (heute)'} · Preise Proviande{proviande ? ` Woche ${proviande.week}` : ' (wird geladen, bis dahin Stand KW 47)'}: Lamm {meatPrices.lamb.toFixed(2)}, Schaf {meatPrices.sheep.toFixed(2)} Fr./kg SG. Gewichte und Abzüge aus den Abrechnungen 2025 (Waagscheine).
            </>
          }
        >
          {({ value, set, editing }) => {
            const num = (key: Exclude<keyof MeatSettings, 'slaughterDate'>, label: string, step = 1) => (
              <label key={key} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                {label}
                {editing ? <NumberInput step={step} value={value[key]} onChange={(e) => set({ ...value, [key]: Number(e.target.value) })} className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm" /> : <ReadValue>{value[key]}</ReadValue>}
              </label>
            )
            return (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
                  Schlachttermin (leer = heute)
                  {editing ? <input type="date" value={value.slaughterDate} onChange={(e) => set({ ...value, slaughterDate: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" /> : <ReadValue>{value.slaughterDate ? value.slaughterDate.split('-').reverse().join('.') : 'heute'}</ReadValue>}
                </label>
                {num('lambMaxDays', 'Lamm bis Alter (Tage)')}
                {num('lambKgYoung', 'Lamm bis 120 Tage, SG kg', 0.5)}
                {num('lambKgMid', 'Lamm bis 210 Tage, SG kg', 0.5)}
                {num('lambKgOld', 'Lamm älter, SG kg', 0.5)}
                {num('sheepKgYoung', 'Schaf unter 1400 Tage, SG kg', 0.5)}
                {num('sheepKgOld', 'Schaf ab 1400 Tage, SG kg', 0.5)}
                {num('lambFactor', 'Lamm: Preis im Verhältnis zu T3', 0.01)}
                {num('sheepFactor', 'Schaf: Preis im Verhältnis zu T3', 0.01)}
                {num('feePerAnimal', 'Abzüge je Tier (Fr.)', 0.1)}
                {num('transportPerAnimal', 'Transport je Tier (Fr.)', 0.5)}
              </div>
            )
          }}
        </SettingsEditor>
      )}

      {cardFields.includes('lambMilk') && species === 'sheep' && (
        <SettingsEditor
          value={lambMilkSettings}
          onSave={(v) => {
            setLambMilkSettings(v)
            saveLambMilkSettings(moduleKey, v)
          }}
          onReset={() => DEFAULT_LAMB_MILK}
          label="Milch der Lämmer"
          className="rounded-lg bg-white p-3 shadow-sm"
          title="Milch der Lämmer: Zuwachs zwischen erster Wägung (Geburt oder Ohrmarke) und Absetzen, Wegnehmen oder Altersgrenze mal Faktor. Eine Näherung."
        >
          {({ value, set, editing }) => {
            const f = (key: keyof LambMilkSettings, label: string, step = 1) => (
              <label key={key} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                {label}
                {editing ? <NumberInput step={step} value={value[key]} onChange={(e) => set({ ...value, [key]: Number(e.target.value) })} className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm" /> : <ReadValue>{value[key]}</ReadValue>}
              </label>
            )
            return (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {f('factor', 'kg Milch je kg Zuwachs', 0.5)}
                {f('maxDays', 'Rechnen bis Alter (Tage)')}
                {f('minDays', 'Mindestens Tage zwischen Wägungen')}
              </div>
            )
          }}
        </SettingsEditor>
      )}

      <p className="text-xs text-gray-600">
        {shown.length} von {cards.length} {terms.plural} sichtbar. Antippen klappt eine Karte auf, am Griff ⠿ ziehen verschiebt. Spalten: Griff ⠿ im Kopf ordnet um, ▾ klappt ein (gestapelt).
      </p>

      {chosen.length > 0 && (
        <SelectionBar
          count={chosen.length}
          groups={groups}
          lists={lists}
          canMove={canMove}
          onDraft={(target) => {
            moveToDraft(chosen, target)
            setSelected(new Set())
          }}
          onList={(listId) => {
            void addToList(listId, chosen)
            setSelected(new Set())
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div ref={scroller} className="flex snap-x items-start gap-3 overflow-x-auto pb-4">
        {buildLanes(visibleColumns, collapsed).map((lane) =>
          lane.kind === 'column' ? (
            renderColumn(lane.col, false)
          ) : (
            <div key={`stack:${lane.cols.map((c) => c.key).join('+')}`} className="w-64 shrink-0 snap-start space-y-2">
              {lane.cols.map((c) => renderColumn(c, true))}
            </div>
          ),
        )}
      </div>

      {colDrag.drag && (
        <div ref={colDrag.ghost} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[3000] rounded-lg border-2 border-brand-700 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xl">
          {colDrag.drag.label}
        </div>
      )}

      <DragGhost drag={drag} ghost={ghost} />

      {pending > 0 && (
        <FooterBar>
          <span className="font-semibold text-amber-900">Entwurf: {pending} {pending === 1 ? 'Tier' : 'Tiere'} verschoben, noch nicht gespeichert</span>
          <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white">
            Prüfen und bestätigen
          </button>
          <button type="button" onClick={() => setDraft({})} className="min-h-11 rounded-lg border border-gray-300 px-3">
            Verwerfen
          </button>
        </FooterBar>
      )}

      {editing && (
        <FilterModal
          fields={fields}
          rows={cards}
          ctx={evalCtx}
          initial={editing.filter}
          onSave={(f) => {
            saved.save(f)
            setEditing(null)
          }}
          onDelete={editing.filter && !editing.filter.preset ? () => {
            saved.remove(editing.filter!.id)
            setEditing(null)
          } : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      {editGroup && herd && (() => {
        const g = herd.groups.find((x) => x.id === editGroup)
        if (!g) return null
        return (
          <GroupEditModal
            name={g.name}
            memberCount={compositionAt(g.id, herd.members, herd.counts, today).total}
            blockedReason={pending > 0 ? 'Zuerst den Entwurf der Gruppenwechsel bestätigen oder verwerfen.' : null}
            onClose={() => setEditGroup(null)}
            onRename={async (next) => {
              try {
                await undoAction(`Gruppe «${g.name}» umbenannt in «${next}»`, () => saveGroup({ ...g, name: next }))
                notifySuccess(`Gruppe heisst jetzt «${next}»`)
                void loadHerdData().then(setHerd)
              } catch (e) {
                notifyError(errorText(e))
                throw e
              }
            }}
            onDelete={async () => {
              try {
                await undoAction(`Gruppe «${g.name}» gelöscht`, () => dissolveGroup(herd, g, today))
                notifySuccess(`Gruppe «${g.name}» gelöscht`)
                void loadHerdData().then(setHerd)
              } catch (e) {
                notifyError(errorText(e))
                throw e
              }
            }}
          />
        )
      })()}

      {showLegend && <CardLegend species={species} onClose={() => setShowLegend(false)} />}

      {showColumns && (
        <Modal title="Spalten" onClose={() => setShowColumns(false)}>
          <div className="mb-2 flex gap-2">
            <button type="button" onClick={() => setAllCollapsed(true)} className="min-h-11 flex-1 rounded-lg border-2 border-gray-300 px-2 text-sm font-semibold">
              Alle einklappen
            </button>
            <button type="button" onClick={() => setAllCollapsed(false)} className="min-h-11 flex-1 rounded-lg border-2 border-gray-300 px-2 text-sm font-semibold">
              Alle ausklappen
            </button>
          </div>
          <p className="mb-2 text-xs text-gray-600">Reihenfolge: am Griff ⠿ im Spaltenkopf ziehen. Eingeklappte Spalten nebeneinander stehen gestapelt in einer Spur.</p>
          <ul className="space-y-1">
            {columns.map((c) => (
              <li key={c.key}>
                <label className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={!hidden.has(c.key)} onChange={() => setHiddenCols(toggle(hidden, c.key))} />
                  <span>
                    {c.kind === 'list' ? '🔖 ' : ''}
                    {c.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {confirming && herd && refs && (
        <ConfirmDraft
          draft={draft}
          current={current}
          herd={herd}
          refs={refs}
          groupName={groupName}
          cardById={cardById}
          onClose={() => setConfirming(false)}
          onDone={(n) => {
            setConfirming(false)
            setDraft({})
            setSelected(new Set())
            notifySuccess(`${n} ${n === 1 ? 'Tier' : 'Tiere'} gezügelt`)
            void loadHerdData().then(setHerd)
          }}
        />
      )}
    </div>
  )
}

/** Summe des geschätzten Fleischwerts einer Spalte (nach Abzügen), mit Anzahl Lämmer und Schafe. */
function ColumnMeatSum({ values }: { values: (MeatValue | null)[] }) {
  const sum = sumMeat(values)
  const fr = (v: number) => Math.round(v).toLocaleString('de-CH')
  const total = MEAT_BANDS.reduce((t, b) => t + Math.max(0, sum.byBand[b].net), 0)
  const used = MEAT_BANDS.filter((b) => sum.byBand[b].n > 0)
  return (
    <div className="mb-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-950" aria-label="Fleischwert der Spalte">
      <div className="text-sm font-bold">≈ {fr(sum.net)} Fr.</div>
      {total > 0 && (
        <div
          role="img"
          aria-label={`Fleischwert nach Bereich: ${used.map((b) => `${MEAT_BAND_LABEL[b]} ${sum.byBand[b].n} Tiere, ${fr(sum.byBand[b].net)} Fr.`).join('; ')}`}
          className="my-1 flex h-3 w-full overflow-hidden rounded-full bg-white ring-1 ring-emerald-200"
        >
          {used.map((b) => (
            <span key={b} className={`${MEAT_BAND_BAR[b]} h-full`} style={{ width: `${(Math.max(0, sum.byBand[b].net) / total) * 100}%` }} title={`${MEAT_BAND_LABEL[b]}: ${sum.byBand[b].n} Tiere, ${fr(sum.byBand[b].net)} Fr.`} />
          ))}
        </div>
      )}
      <ul className="space-y-0.5">
        {used.map((b) => (
          <li key={b} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${MEAT_BAND_BAR[b]}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{MEAT_BAND_LABEL[b]}</span>
            <span className="tabular-nums">{sum.byBand[b].n} · {fr(sum.byBand[b].net)} Fr.</span>
          </li>
        ))}
      </ul>
      <div className="mt-0.5 text-[11px] text-emerald-900">
        {sum.unknown > 0 ? `${sum.unknown} ohne Geburtsdatum · ` : ''}vor Abzügen {fr(sum.gross)} Fr.
      </div>
    </div>
  )
}

function ColumnCard({
  card,
  col,
  moduleKey,
  today,
  result,
  selected,
  expanded,
  pendingTo,
  canDrag,
  onSelect,
  onToggle,
  onUndoDraft,
  onRemoveFromList,
  meat,
  meatMax,
  fields,
  pointerDown,
}: {
  card: BoardCard
  col: BoardColumn
  moduleKey: string
  today: string
  result: FilterResult | undefined
  selected: boolean
  expanded: boolean
  pendingTo: string | null
  canDrag: boolean
  onSelect: () => void
  onToggle: () => void
  onUndoDraft: () => void
  onRemoveFromList?: () => void
  meat?: MeatValue | null
  /** grösster Fleischwert aller Karten: Massstab für den Balken */
  meatMax?: number
  fields?: CardFieldKey[]
  pointerDown: (cardId: string, handle: boolean) => (e: React.PointerEvent) => void
}) {
  void col
  return (
    <BoardCardView
      card={card}
      moduleKey={moduleKey}
      today={today}
      colors={result?.colors ?? []}
      filterNames={result?.names ?? []}
      selected={selected}
      expanded={expanded}
      pendingTo={pendingTo}
      canDrag={canDrag}
      onSelect={onSelect}
      onToggle={onToggle}
      onUndoDraft={pendingTo ? onUndoDraft : undefined}
      onRemoveFromList={onRemoveFromList}
      meat={meat}
      meatMax={meatMax}
      fields={fields}
      onDragCard={pointerDown(card.id, false)}
      onDragHandle={pointerDown(card.id, true)}
    />
  )
}

/** Auswahl mehrerer Karten: ohne Ziehen in eine Gruppe (Entwurf) oder auf eine Merkliste. */
function SelectionBar({
  count,
  groups,
  lists,
  canMove,
  onDraft,
  onList,
  onClear,
}: {
  count: number
  groups: { id: string; name: string }[]
  lists: { id: string; name: string }[]
  canMove: boolean
  onDraft: (target: string | null) => void
  onList: (listId: string) => void
  onClear: () => void
}) {
  const [group, setGroup] = useState('')
  const [list, setList] = useState('')
  const field = 'min-h-11 rounded-lg border border-gray-300 bg-white px-2 text-sm'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 p-2 text-sm" role="region" aria-label="Auswahl">
      <span className="font-semibold text-sky-900">{count} gewählt</span>
      {canMove && (
        <span className="flex items-center gap-1">
          <select value={group} onChange={(e) => setGroup(e.target.value)} className={field} aria-label="In Gruppe verschieben">
            <option value="">Gruppe wählen…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="none">Ohne Gruppe</option>
          </select>
          <button type="button" disabled={!group} onClick={() => onDraft(group === 'none' ? null : group)} className="min-h-11 rounded-lg bg-brand-700 px-3 font-medium text-white disabled:opacity-50">
            In Entwurf
          </button>
        </span>
      )}
      {lists.length > 0 && (
        <span className="flex items-center gap-1">
          <select value={list} onChange={(e) => setList(e.target.value)} className={field} aria-label="Auf Merkliste setzen">
            <option value="">Merkliste wählen…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={!list} onClick={() => onList(list)} className="min-h-11 rounded-lg border border-brand-700 px-3 font-medium text-brand-700 disabled:opacity-50">
            Auf Liste
          </button>
        </span>
      )}
      <button type="button" onClick={onClear} className="ml-auto min-h-11 rounded-lg px-3 text-gray-700 underline">
        Auswahl aufheben
      </button>
    </div>
  )
}

/** Entwurf prüfen, Datum wählen, dann schreiben. Erst hier finden die Gruppenwechsel statt. */
function ConfirmDraft({
  draft,
  current,
  herd,
  refs,
  groupName,
  cardById,
  onClose,
  onDone,
}: {
  draft: DraftMoves
  current: ReadonlyMap<string, string | null>
  herd: HerdData
  refs: AnimalRef[]
  groupName: (id: string | null) => string
  cardById: Map<string, BoardCard>
  onClose: () => void
  onDone: (n: number) => void
}) {
  const [date, setDate] = useState(localTodayIso())
  const [dryOff, setDryOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const lines = useMemo(() => summarizeDraft(draft, current, groupName), [draft, current, groupName])
  const total = draftSize(draft)
  const milking = (id: string | null) => !!herd.groups.find((g) => g.id === id)?.milking
  // aus einer Melkgruppe in eine andere Gruppe: Trockenstellen anbieten
  const dryable = lines.filter((l) => milking(l.from) && !milking(l.to)).reduce((n, l) => n + l.ids.length, 0)
  const label = (id: string) => cardById.get(id)?.laufNr ?? cardById.get(id)?.shortTag ?? id.slice(0, 6)

  async function run() {
    setBusy(true)
    try {
      const refById = new Map(refs.map((r) => [r.id, r]))
      await undoAction(`Gruppenwechsel (${total} ${total === 1 ? 'Tier' : 'Tiere'})`, async () => {
        for (const [to, ids] of groupByTarget(draft)) {
          if (to == null) {
            const memberIds = herd.members.filter((m) => ids.includes(m.animal_id) && (m.to_date == null || m.to_date >= date)).map((m) => m.id)
            await removeMembers(herd, memberIds, date)
            continue
          }
          const toGroup = herd.groups.find((g) => g.id === to)
          if (!toGroup) throw new Error('Zielgruppe nicht mehr vorhanden')
          const animals = ids.map((id) => refById.get(id)).filter((a): a is AnimalRef => !!a)
          // Trockenstellen nur für Tiere, die aus einer Melkgruppe kommen
          const dry = dryOff && !toGroup.milking ? animals.filter((a) => milking(current.get(a.id) ?? null)) : []
          const dryIds = new Set(dry.map((a) => a.id))
          const rest = animals.filter((a) => !dryIds.has(a.id))
          if (dry.length) await moveAnimals(herd, { toGroup, fromGroup: null, date, animals: dry, counts: {}, dryOff: true })
          if (rest.length) await moveAnimals(herd, { toGroup, fromGroup: null, date, animals: rest, counts: {}, dryOff: false })
        }
      })
      onDone(total)
    } catch (e) {
      notifyError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Gruppenwechsel bestätigen" onClose={onClose} onSubmit={() => void run()}>
      <div className="space-y-3 text-sm">
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={`${l.from}>${l.to}`} className="rounded-lg bg-gray-50 p-2">
              <div className="font-semibold text-gray-900">
                {l.ids.length} {l.ids.length === 1 ? 'Tier' : 'Tiere'}: {groupName(l.from)} → {groupName(l.to)}
              </div>
              <div className="text-xs text-gray-600">{l.ids.map(label).join(', ')}</div>
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2">
          <span className="font-medium text-gray-700">Gültig ab</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-2" />
        </label>
        <p className="text-xs text-gray-600">Die bisherige Gruppe endet am Vortag, der Verlauf bleibt erhalten. «Rückgängig» nimmt den ganzen Wechsel zurück.</p>
        {dryable > 0 && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={dryOff} onChange={(e) => setDryOff(e.target.checked)} />
            <span>
              {dryable} {dryable === 1 ? 'Tier' : 'Tiere'} aus einer Melkgruppe: ab diesem Datum trockenstellen
            </span>
          </label>
        )}
        <div className="flex gap-2">
          <button type="button" disabled={busy || !date} onClick={() => void run()} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
            {busy ? 'speichert …' : `Ab ${fmtDate(date)} bestätigen`}
          </button>
          <button type="button" onClick={onClose} className="min-h-12 rounded-lg border border-gray-300 px-4">
            Zurück
          </button>
        </div>
      </div>
    </Modal>
  )
}
