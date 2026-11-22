import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStallMode } from '@fmis/core/stallMode'
import { Link, useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { animalProvider, refreshHerdData, type AnimalRef } from '@fmis/core/animals'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useDb } from '@fmis/core/DbContext'
import type { FilterResult } from '@fmis/core/filters/filterModel'
import QueryPresets from '@fmis/core/query/QueryPresets'
import { usePresets } from '@fmis/core/query/presets'
import { matchesQuery as engineMatches, parseQuery as engineParse } from '@fmis/core/query/engine'
import FooterBar from '@fmis/core/FooterBar'
import Modal from '@fmis/core/Modal'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction, useOnUndo } from '@fmis/core/undo'
import { dissolveGroup, loadHerdData, memberAt, moveAnimals, removeMembers, saveGroup, type HerdData } from '@fmis/tiere/lib/herds'
import { compositionAt } from '@fmis/tiere/lib/herdModel'
import GroupEditModal from '../components/GroupEditModal'
import { useQuery } from '../hooks/useQuery'
import BoardCardView, { type CardLambValue } from '../components/BoardCardView'
import { DragGhost, useBoardDrag } from '../components/boardDrag'
import { DEFAULT_MEAT_SETTINGS, FALLBACK_MEAT_PRICES, loadMeatSettings, meatLimits as buildMeatLimits, meatValue, saveMeatSettings, sumMeat, MEAT_BANDS, MEAT_BAND_BAR, MEAT_BAND_LABEL, MEAT_BAR_MAX, type MeatLimit, type MeatSettings, type MeatValue } from '../lib/meatValue'
import { useProviandePrices } from '../lib/proviandePrices'
import CardFieldsMenu from '../components/CardFieldsMenu'
import BoardViewsMenu from '../components/BoardViewsMenu'
import StickyHScroll from '../components/StickyHScroll'
import QueryInput, { QueryChips } from '@fmis/core/query/QueryInput'
import SortMenu from '@fmis/core/query/SortMenu'
import { QUERY_SORT_KEY, useListQuery } from '@fmis/core/query/useListQuery'
import { BOARD_EXAMPLES, boardPresets, boardTexts, QUERY_FIELDS, type QueryContext } from '../lib/boardQuery'
import { buildLanes, loadList, moveKey, orderColumns, saveList } from '../lib/columnLayout'
import { useColumnReorder } from '../hooks/useColumnReorder'
import CardLegend from '../components/CardLegend'
import { loadCardFields, saveCardFields, type CardFieldKey } from '../lib/cardFields'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'
import NumberInput from '@fmis/core/NumberInput'
import { columnKey, buildCards, buildColumns, cardsInColumn, SORTS, sortCards, type BoardCard, type BoardColumn, type SortKey } from '../lib/board'
import { clearTargets, draftSize, effectiveGroup, groupByTarget, pruneDraft, setTargets, summarizeDraft, type DraftMoves } from '../lib/boardDraft'
import { SIRE_TRAIT } from '../lib/breedingTraits'
import { useCullingThresholds } from '../lib/cullingSettings'
import { fmtDate, localTodayIso } from '../lib/format'
import { loadHerdContext } from '../lib/herdContext'
import { loadLambSelection } from '../lib/lambSelectionData'
import { lambValue as computeLambValue, lambValueTip, loadLambValueSettings } from '../lib/lambValue'
import { bucketByDam, loadLambs, nursingByDam } from '../lib/lambs'
import { estimateAll, loadParentLinks } from '../lib/breedingEstimate'
import { DEFAULT_LAMB_MILK, loadLambMilkSettings, milkByDam, saveLambMilkSettings, type LambMilkSettings } from '../lib/lambMilk'
import { speciesOf, speciesTerms } from '../lib/species'
import { loadMilkFeedData, milkFeed, milkFeedInputFor, milkFeedWindow, useMilkFeedSettings, type MilkFeed, type MilkFeedWindow, type MilkSample } from '../lib/milkFeed'
import { loadColumnTotals, periodLabel, saveColumnTotals, type ColumnTotalsSettings } from '../lib/columnTotals'
import ColumnTotalsMenu from '../components/ColumnTotalsMenu'
import SearchPick from '@fmis/core/SearchPick'
import { loadRules } from '../lib/stallRules'
import { MilkFeedSettingsPanel } from '../components/MilkFeedChip'
import { cardVerdict, moneyBalance, type VerdictResult } from '../lib/cardVerdict'
import { addToWatchlist, createWatchlist, deleteWatchlist, loadWatchlists, removeEntry, saveWatchlist } from '../lib/watchlists'

async function loadBoard(pg: PGlite, species: 'cattle' | 'sheep', today: string, milk: LambMilkSettings) {
  const trait = SIRE_TRAIT[species].trait
  const [context, lists, lambs, links] = await Promise.all([loadHerdContext(pg, species, today), loadWatchlists(pg), loadLambs(pg, today), loadParentLinks(pg, trait)])
  return { context, nursing: nursingByDam(lambs), bucket: bucketByDam(lambs), lambMilk: milkByDam(lambs, milk), breedingEstimates: estimateAll(context, links, trait), ...lists }
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

/** Dashboard am PC und Tablet: jede Tiergruppe und Merkliste eine Spalte, jedes Tier eine Karte.
 * Filter färben oder blenden aus; Karten lassen sich in eine andere Gruppe ziehen (als Entwurf, der
 * gesamthaft bestätigt wird) oder auf eine Merkliste (kommt sofort drauf, bleibt in der Gruppe). */
export default function Board({ moduleKey }: { moduleKey: string }) {
  // Laden einer gespeicherten Ansicht (components/BoardViewsMenu): Seite mit den neuen Einstellungen neu aufbauen
  const [generation, setGeneration] = useState(0)
  return <BoardPage key={generation} moduleKey={moduleKey} reload={() => setGeneration((g) => g + 1)} />
}

function BoardPage({ moduleKey, reload }: { moduleKey: string; reload: () => void }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const herdSpecies = species === 'sheep' ? 'schafe' : 'rinder'
  const terms = speciesTerms(moduleKey)
  const today = localTodayIso()
  const canMove = useHasPermission('tiere:herden:write') && !!animalProvider(moduleKey)
  const { thresholds } = useCullingThresholds(moduleKey, species)

  // Stallmodus: eine Spalte je Bildschirmbreite, grössere Karten (components/BoardCardView.tsx)
  const stall = useStallMode()
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
            bucket: data.bucket,
            lambMilk: data.lambMilk,
            breedingEstimates: data.breedingEstimates,
            breedingTrait: SIRE_TRAIT[species].trait,
          })
        : [],
    [data, refs, species, today, thresholds, current],
  )
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

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
  // Handy: Werkzeuge (Sortieren, Spalten, Einstellungen) aufgeklappt
  const [toolsOpen, setToolsOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<string | null>(null)
  const [editList, setEditList] = useState<string | null>(null)
  const [cardFields, setCardFields] = useState<CardFieldKey[]>(() => loadCardFields(moduleKey))
  const [meatSettings, setMeatSettings] = useState<MeatSettings>(() => loadMeatSettings(moduleKey))
  const proviande = useProviandePrices(species)
  const meatPrices = useMemo(() => ({ lamb: proviande?.young ?? FALLBACK_MEAT_PRICES.lamb, sheep: proviande?.adult ?? FALLBACK_MEAT_PRICES.sheep }), [proviande])
  const meatDate = meatSettings.slaughterDate || today
  // Fleischwert aller Karten (Schafe): für die Karten, die Spaltensummen und die Formel «Fleischwert > 150»
  const meatAll = useMemo(() => {
    const m = new Map<string, ReturnType<typeof meatValue>>()
    if (species === 'sheep') for (const c of cards) m.set(c.id, meatValue(c.birthDate, meatDate, meatSettings, meatPrices, c.lastBirth))
    return m
  }, [cards, species, meatDate, meatSettings, meatPrices])
  // Milch gegen Futter bis zur nächsten Geburt: Kartenfeld und Formelsuche («Bilanz < 0», «Tagesmilch < 0.8»)
  const milkFeedSettings = useMilkFeedSettings(moduleKey, species)
  const milkFeedOn = cardFields.includes('milkFeed')
  const milkData = useQuery((pg) => loadMilkFeedData(pg, today, lambMilkSettings), [today, lambMilkSettings]).data
  const weanDay = loadRules(moduleKey, species).absetzenDay
  const milkFeedById = useMemo(() => {
    const m = new Map<string, MilkFeed>()
    if (!milkData) return m
    for (const c of cards)
      m.set(
        c.id,
        milkFeed(milkFeedInputFor(milkData, { id: c.id, lastBirth: c.lastBirth, expectedBirth: c.expectedBirth, pregnancy: c.pregnancy, dry: c.dry }, species, today, weanDay), milkFeedSettings),
      )
    return m
  }, [milkData, cards, species, today, milkFeedSettings, weanDay])
  // Summen je Spalte (Σ Summen): Milch und Futter jedes Tiers für den gewählten Zeitraum
  const [totals, setTotals] = useState<ColumnTotalsSettings>(() => loadColumnTotals(moduleKey))
  const windowById = useMemo(() => {
    const m = new Map<string, MilkFeedWindow>()
    if (!milkData || (!totals.milk && !totals.feed)) return m
    for (const c of cards)
      m.set(
        c.id,
        milkFeedWindow(milkFeedInputFor(milkData, { id: c.id, lastBirth: c.lastBirth, expectedBirth: c.expectedBirth, pregnancy: c.pregnancy, dry: c.dry }, species, today, weanDay), milkFeedSettings, totals.days, c.ageMonths != null && c.ageMonths < 6),
      )
    return m
  }, [milkData, cards, species, today, weanDay, milkFeedSettings, totals])
  const meatById = useMemo(() => (cardFields.includes('meat') ? meatAll : new Map<string, ReturnType<typeof meatValue>>()), [meatAll, cardFields])
  // Fleischwert in Gebrauch (Karte oder Spaltensumme): dann stehen seine Einstellungen unter «⚙️ Einstellungen»
  const meatUsed = species === 'sheep' && (cardFields.includes('meat') || totals.meat)

  // Suchfeld: Freitext und Formeln wie «ZZ > 200» (lib/boardQuery.ts), Sortierung nach dem Filter vorschlagen (core/query)
  const queryCtx = useMemo<QueryContext>(
    () => ({
      today,
      groupName: (c) => groups.find((g) => g.id === c.groupId)?.name ?? null,
      listNames: (c) => c.listIds.map((id) => lists.find((l) => l.id === id)?.name ?? ''),
      meat: (c) => meatAll.get(c.id)?.net ?? null,
      milkFeed: (c) => milkFeedById.get(c.id) ?? null,
    }),
    [groups, lists, meatAll, milkFeedById, today],
  )
  const q = useListQuery({ storage: `${moduleKey}_board`, fields: QUERY_FIELDS, ctx: queryCtx, texts: boardTexts, defaultSort: 'nr', validSorts: SORTS.map((x) => x.key) })
  const sort = q.sortKey
  // Sortierter Wert steht auf der Karte, auch wenn das Feld nicht gewählt ist
  const shownFields = useMemo<CardFieldKey[]>(() => {
    const byFilter = sort === QUERY_SORT_KEY && q.auto && ['tagebel', 'belegungen'].includes(q.auto.field.key)
    const auto: CardFieldKey | null = sort === 'lambValue' ? 'lambValue' : sort === 'service' || byFilter ? 'service' : null
    return auto && !cardFields.includes(auto) ? [...cardFields, auto] : cardFields
  }, [sort, cardFields, q.auto])
  // Zucht-Mehrwert der Jungtiere aus der Abstammung (lib/lambValue.ts): Daten der Lämmerauswahl, nur wenn das Feld gewählt oder danach sortiert ist
  const lambValueOn = cardFields.includes('lambValue') || sort === 'lambValue'
  const lambData = useQuery((pg) => (lambValueOn ? loadLambSelection(pg, species, today) : Promise.resolve(null)), [lambValueOn, species, today]).data
  const lambValueById = useMemo(() => {
    const m = new Map<string, CardLambValue>()
    if (!lambData?.herdLactationKg) return m
    const s = loadLambValueSettings(moduleKey, species)
    for (const c of lambData.candidates) {
      if (!c.animal_id) continue
      const p = c.dam_key ? lambData.dams.get(c.dam_key)?.performance : undefined
      const v = computeLambValue({ damRel: p?.performance_rel ?? null, damLactations: p?.n_lactations ?? 0, sireValue: c.sire_key ? (lambData.sireValues.get(c.sire_key) ?? null) : null }, s, lambData.herdLactationKg, milkFeedSettings.milkPrice)
      if (v) m.set(c.animal_id, { francs: v.francs, pct: v.pct, tip: lambValueTip(v, s, lambData.herdLactationKg, milkFeedSettings.milkPrice) })
    }
    return m
  }, [lambData, moduleKey, species, milkFeedSettings.milkPrice])
  const builtinPresets = useMemo(() => boardPresets(species === 'sheep'), [species])
  const presetState = usePresets(`${moduleKey}_board`, builtinPresets)
  // Formeln der Vorschläge einmal zerlegen: Treffer je Vorschlag (Zähler) und Einfärben
  const presetMatchers = useMemo(() => presetState.presets.map((p) => ({ p, parsed: engineParse(QUERY_FIELDS, p.formula) })), [presetState.presets])
  const counts = useMemo(() => Object.fromEntries(presetMatchers.map(({ p, parsed }) => [p.id, cards.filter((c) => engineMatches(c, parsed, queryCtx, boardTexts)).length])), [presetMatchers, cards, queryCtx])
  const results = useMemo(() => {
    const m = new Map<string, FilterResult>()
    for (const c of cards) {
      const hit = presetMatchers.filter(({ p, parsed }) => presetState.colored.has(p.id) && engineMatches(c, parsed, queryCtx, boardTexts))
      m.set(c.id, { visible: true, colors: hit.map(({ p }) => p.color), names: hit.map(({ p }) => p.name) } as FilterResult)
    }
    return m
  }, [cards, presetMatchers, presetState.colored, queryCtx])
  const shown = useMemo(() => cards.filter((c) => q.match(c)), [cards, q])
  // feste Skala (bis MEAT_BAR_MAX Fr.) mit den Grenzen schwere Aue und schweres Lamm T3/H3/C3
  const meatLimitList = useMemo(() => buildMeatLimits(meatSettings, { ...meatPrices, lambH: proviande?.youngH ?? null, lambC: proviande?.youngC ?? null }), [meatSettings, meatPrices, proviande])
  // Einstellungen der Kartenwerte: ein Knopf blendet alle ein oder aus (gemerkt je Gerät), standardmässig aus
  const lambMilkSettingsUsed = species === 'sheep' && (cardFields.includes('lambMilk') || cardFields.includes('dailyMilk') || cardFields.includes('milkFeed'))
  const anySettings = meatUsed || cardFields.includes('milkFeed') || lambMilkSettingsUsed
  const settingsKey = `${moduleKey}_board_settings_open`
  const [showSettings, setShowSettings] = useState(() => {
    try {
      return localStorage.getItem(settingsKey) === '1'
    } catch {
      return false
    }
  })
  function toggleSettings() {
    setShowSettings((v) => {
      try {
        localStorage.setItem(settingsKey, v ? '0' : '1')
      } catch {
        // nur bis zum Neuladen
      }
      return !v
    })
  }

  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(moduleKey))
  const [showColumns, setShowColumns] = useState(false)
  // Sprung aus dem Einzeltier (?gruppe=herde:<id>&tier=<id>): die Gruppe steht im Blick, das Tier ist hervorgehoben
  const [params] = useSearchParams()
  const jumpGroup = params.get('gruppe')?.replace(/^herde:/, '') ?? null
  const jumpTier = params.get('tier')
  const jumpKey = jumpGroup ? columnKey('group', jumpGroup) : null
  // Nur Gruppen, nur Merklisten oder beides (je Gerät gemerkt)
  const [kinds, setKindsState] = useState<'beides' | 'gruppen' | 'merklisten'>(() => {
    try {
      const v = localStorage.getItem(`${moduleKey}_board_kinds`)
      return v === 'gruppen' || v === 'merklisten' ? v : 'beides'
    } catch {
      return 'beides'
    }
  })
  function setKinds(k: 'beides' | 'gruppen' | 'merklisten') {
    setKindsState(k)
    try {
      localStorage.setItem(`${moduleKey}_board_kinds`, k)
    } catch {
      // nur bis zum Neuladen
    }
  }
  const kindShown = (kind: string) => kinds === 'beides' || (kinds === 'gruppen' ? kind === 'group' : kind === 'list')
  const visibleColumns = columns.filter((c) => (kindShown(c.kind) && !hidden.has(c.key)) || c.key === jumpKey)
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

  // Ampel-Kante und Geldbilanz je Karte (lib/cardVerdict.ts): Punkte wie im Vorschlag «Schlachten»
  const verdictById = useMemo(() => {
    const m = new Map<string, { verdict: VerdictResult; money: ReturnType<typeof moneyBalance> }>()
    for (const c of cards) {
      const balance = milkFeedById.get(c.id)?.balance ?? null
      m.set(c.id, {
        verdict: cardVerdict({ reasons: c.reasons, pregnancy: c.pregnancy, balance, frPerPoint: milkFeedSettings.frPerPoint, ageMonths: c.ageMonths, parity: c.parity, today }),
        money: moneyBalance(species === 'sheep' ? (meatAll.get(c.id)?.net ?? null) : null, balance),
      })
    }
    return m
  }, [cards, milkFeedById, milkFeedSettings.frPerPoint, today, meatAll, species])
  // Suche aktiv: nur Spalten mit Treffern (die angesprungene Spalte bleibt)
  const searching = q.text.trim() !== ''
  const shownColumns = useMemo(
    () => (searching ? visibleColumns.filter((c) => c.key === jumpKey || cardsInColumn(c, shown, groupOf).length > 0) : visibleColumns),
    [searching, visibleColumns, jumpKey, shown, groupOf],
  )
  const emptyHidden = visibleColumns.length - shownColumns.length
  const columnCards = useCallback((col: BoardColumn) => (q.queryCompare && sort === QUERY_SORT_KEY ? [...cardsInColumn(col, shown, groupOf)].sort(q.queryCompare) : sortCards(cardsInColumn(col, shown, groupOf), sort as SortKey, (c) => lambValueById.get(c.id)?.francs ?? null)), [shown, groupOf, sort, q.queryCompare, lambValueById])

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
  // Knopf «Alle aufklappen»: alle Karten der sichtbaren, nicht eingeklappten Spalten
  const allCardKeys = shownColumns.filter((c) => !collapsed.has(c.key)).flatMap((c) => columnCards(c).map((x) => `${c.key}:${x.id}`))
  const allCardsOpen = allCardKeys.length > 0 && allCardKeys.every((k) => open.has(k))
  const chosen = [...selected].filter((id) => cardById.has(id))

  function renderColumn(col: BoardColumn, stacked: boolean) {
    const list = columnCards(col)
    const isCollapsed = collapsed.has(col.key)
    const dropTarget = colDrag.target?.key === col.key ? colDrag.target : null
    const meatSum = totals.meat && species === 'sheep' && list.length > 0 ? sumMeat(list.map((c) => meatAll.get(c.id) ?? null)) : null
    const icon = col.kind === 'list' ? '🔖' : species === 'sheep' ? '🐑' : '🐄'
    return (
      <section
        key={col.key}
        data-drop-col={col.key}
        data-col-key={col.key}
        data-stacked={stacked ? '1' : undefined}
        aria-label={col.title}
        className={`relative shrink-0 snap-start rounded-xl p-2 ${stacked ? 'w-full' : stall ? 'w-[calc(100vw-1.5rem)] lg:w-[26rem]' : 'w-[calc(100vw-1.5rem)] sm:w-72'} ${hover === col.key ? 'bg-brand-50 ring-2 ring-brand-700' : 'bg-gray-100'} ${colDrag.drag?.key === col.key ? 'opacity-50' : ''}`}
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
          {/* lange Namen: bis zwei Zeilen, ganzer Name im Tooltip */}
          <h2 className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-bold leading-tight text-gray-800" title={col.title}>
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
          {col.kind === 'list' && col.id && (
            <button type="button" onClick={() => setEditList(col.id)} aria-label={`Merkliste «${col.title}»: umbenennen, archivieren, löschen`} title="Umbenennen, archivieren, löschen" className="grid h-9 w-9 place-items-center rounded text-lg text-gray-600 active:bg-gray-200">
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
            {list.length > 0 && <ColumnTotals list={list} totals={totals} sheep={species === 'sheep'} meatAll={meatAll} windowById={windowById} />}
            <div className="max-h-[calc(100dvh-8rem)] min-h-20 space-y-1.5 overflow-y-auto pr-0.5 sm:max-h-none sm:space-y-2 sm:overflow-visible">
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
                  groupChoices={col.kind === 'group' && canMove ? [...groups.filter((g) => g.id !== col.id).map((g) => ({ id: g.id as string | null, name: g.name })), ...(col.id ? [{ id: null, name: 'Ohne Gruppe' }] : [])] : undefined}
                  onMoveToGroup={col.kind === 'group' && canMove ? (id) => moveToDraft([c.id], id) : undefined}
                  meat={meatById.get(c.id) ?? null}
                  milkFeed={milkFeedOn || cardFields.includes('dailyMilk') ? (milkFeedById.get(c.id) ?? null) : null}
                  lastMilk={milkData?.samples.get(c.id) ?? null}
                  lambValue={lambValueById.get(c.id) ?? null}
                  meatLimits={meatLimitList}
                  fields={shownFields}
                  verdict={verdictById.get(c.id)?.verdict ?? null}
                  money={verdictById.get(c.id)?.money ?? null}
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

  // Handy: Kopfzeile beim Hinunterscrollen ausblenden und beim Öffnen gleich zu den Karten (Werkzeuge darüber)
  useEffect(() => {
    document.body.dataset.autohideHeader = 'on'
    return () => {
      delete document.body.dataset.autohideHeader
    }
  }, [])
  const scrolledToCards = useRef(false)
  useEffect(() => {
    if (loading || scrolledToCards.current || window.innerWidth >= 640 || jumpKey) return
    scrolledToCards.current = true
    requestAnimationFrame(() => scroller.current?.scrollIntoView({ block: 'start' }))
  }, [loading, jumpKey])

  if (loading) return <p className="p-6 text-center text-gray-500">Lädt…</p>
  if (cards.length === 0) return <p className="p-6 text-center text-gray-600">Keine aktiven {terms.plural}. {terms.importHint}</p>

  return (
    <div className="space-y-2 p-1.5 pb-40 sm:space-y-3 sm:p-3">
      {/* links: Suchen, Sortieren, Gruppen/Merklisten; rechts oben nur die Einstellungen */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="sr-only">Karten</h1>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <QueryInput
            className={`min-w-0 flex-1 sm:flex-none ${toolsOpen ? "basis-full sm:basis-auto" : ""} [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1`}
            inputClassName="w-full sm:w-96 sm:max-w-[70vw]"
            fields={QUERY_FIELDS}
            value={q.text}
            onChange={q.setText}
            choices={{ gruppe: groups.map((g) => g.name), liste: lists.map((l) => l.name) }}
            examples={BOARD_EXAMPLES}
            placeholder="Suchen: Nummer, Name oder ZZ > 200"
            intro="Im Suchfeld findest du Tiere nach Nummer, Ohrmarke oder Name."
            extraHelp={
              <section>
                <h3 className="mb-1 font-semibold text-gray-900">Gut zu wissen</h3>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Zellzahl: «ZZ &gt; 200» heisst 200 Tausend Zellen pro ml, «200000» geht auch. Alter: Einheit J, Mt oder T, ohne Einheit Jahre.</li>
                  <li>Die Eingabe wirkt zusammen mit den Filtern darüber (Knöpfe «nur zeigen»). «Zuchtwert» nimmt den eigenen Wert, sonst die Schätzung. «Fleischwert» ist eine Schätzung nach den Einstellungen des Fleischwerts.</li>
                </ul>
              </section>
            }
          />
          {/* am Handy: Sortieren, Spaltenwahl und Einstellungen hinter «Ansicht», damit die Karten Platz haben */}
          <button type="button" onClick={() => setToolsOpen((o) => !o)} aria-expanded={toolsOpen} className={`min-h-11 shrink-0 rounded-lg border-2 px-3 text-sm font-semibold sm:hidden ${toolsOpen ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-800'}`}>
            ☰ Ansicht
          </button>
          <span className={`${toolsOpen ? 'contents' : 'hidden'} sm:contents`}>
          <SortMenu options={SORTS} value={sort} onChange={q.setSort} autoLabel={q.suggestion?.label ?? null} autoOn={q.autoOn} onAutoChange={q.setAutoOn} flash={q.flash} />
          <div role="radiogroup" aria-label="Spalten zeigen" className="flex overflow-hidden rounded-lg border-2 border-gray-300 bg-white text-sm">
            {(
              [
                ['gruppen', 'Gruppen'],
                ['beides', 'Beides'],
                ['merklisten', 'Merklisten'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={kinds === k} onClick={() => setKinds(k)} className={`min-h-11 px-3 ${kinds === k ? 'bg-brand-700 font-semibold text-white' : 'text-gray-800 active:bg-gray-100'}`}>
                {label}
              </button>
            ))}
        </div>
          </span>
        </div>
        <div className={`ml-auto flex-wrap items-center justify-end gap-2 ${toolsOpen ? 'flex' : 'hidden'} sm:flex`}>
          <BoardViewsMenu moduleKey={moduleKey} onApplied={reload} />
          <button type="button" onClick={() => setShowLegend(true)} aria-label="Legende der Karten" title="Legende der Karten" className="grid h-11 w-11 place-items-center rounded-full border-2 border-gray-300 bg-white text-lg font-bold text-brand-700 active:bg-gray-100">
            ⓘ
          </button>
          {anySettings && (
            <button
              type="button"
              onClick={() => toggleSettings()}
              aria-pressed={showSettings}
              title="Einstellungen der Kartenwerte (Fleischwert, Milch gegen Futter, Milch der Lämmer) ein- oder ausblenden"
              className={`min-h-11 rounded-lg border-2 px-3 text-sm font-semibold ${showSettings ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white'}`}
            >
              ⚙️ Einstellungen
            </button>
          )}
          <ColumnTotalsMenu
            value={totals}
            sheep={species === 'sheep'}
            onChange={(v) => {
              setTotals(v)
              saveColumnTotals(moduleKey, v)
            }}
          />
          <CardFieldsMenu
            species={species}
            selected={cardFields}
            onChange={(next) => {
              setCardFields(next)
              saveCardFields(moduleKey, next)
            }}
          />
          <button
            type="button"
            onClick={() => setOpen(allCardsOpen ? new Set() : new Set(allCardKeys))}
            aria-pressed={allCardsOpen}
            title="Alle Karten auf- oder zuklappen (Geldbilanz, Trächtigkeit, Leistung, Ausmerzgründe)"
            className="min-h-11 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm"
          >
            {allCardsOpen ? '▴ Alle zuklappen' : '▾ Alle aufklappen'}
          </button>
          <button type="button" onClick={() => setShowColumns(true)} className="min-h-11 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm">
            Spalten ({visibleColumns.length}/{columns.length})
          </button>
        </div>
      </div>

      <QueryPresets
        presets={presetState.presets}
        text={q.text}
        onText={q.setText}
        colored={presetState.colored}
        onColored={presetState.setColored}
        counts={counts}
        fields={QUERY_FIELDS}
        onEdit={presetState.edit}
        onAdd={(p) => presetState.add(p)}
        onRemove={presetState.remove}
        onReset={presetState.reset}
      />

      <QueryChips parsed={q.parsed} />

      {showSettings && meatUsed && (
        <div className={toolsOpen ? '' : 'hidden sm:block'}>
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
              <span className="mt-1 block text-xs text-gray-700">
                Grenzen im Balken (Skala bis {MEAT_BAR_MAX} Fr.):{' '}
                {meatLimitList.map((l, i) => (
                  <span key={l.key}>
                    {i > 0 && ' · '}
                    <b>{l.label}</b> {Math.round(l.net)} Fr.
                  </span>
                ))}
                {' '}(Aue = schwere Aue {36} kg SG; T3, H3, C3 = schweres Lamm {21} kg SG)
              </span>
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
                {num('sheepKgFresh', 'Schaf frisch abgelammt, SG kg', 0.5)}
                {num('sheepKgLate', 'Schaf spät in der Laktation, SG kg', 0.5)}
                {num('sheepLateDays', 'Schaf schwer ab Laktationstag', 10)}
                {num('lambFactor', 'Lamm: Preis im Verhältnis zu T3', 0.01)}
                {num('sheepFactor', 'Schaf: Preis im Verhältnis zu T3', 0.01)}
                {num('feePerAnimal', 'Abzüge je Tier (Fr.)', 0.1)}
                {num('transportPerAnimal', 'Transport je Tier (Fr.)', 0.5)}
              </div>
            )
          }}
        </SettingsEditor>
        </div>
      )}

      {showSettings && milkFeedOn && (
        <div className={toolsOpen ? '' : 'hidden sm:block'}>
          <MilkFeedSettingsPanel moduleKey={moduleKey} species={species} value={milkFeedSettings} />
        </div>
      )}

      {showSettings && lambMilkSettingsUsed && (
        <div className={toolsOpen ? '' : 'hidden sm:block'}>
        <SettingsEditor
          value={lambMilkSettings}
          onSave={(v) => {
            setLambMilkSettings(v)
            saveLambMilkSettings(moduleKey, v)
          }}
          onReset={() => DEFAULT_LAMB_MILK}
          label="Milch der Lämmer"
          className="rounded-lg bg-white p-3 shadow-sm"
          title="Milch der Lämmer: Zuwachs zwischen erster Wägung (Geburt oder Ohrmarke) und Absetzen, Wegnehmen oder Altersgrenze mal Faktor. Ohne Wägung gelten die Vorgaben je Anzahl saugender Lämmer (zusammen, kg/Tag). Lämmer am Eimer zählen nicht. Eine Näherung."
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
                {f('perDay1', 'Ohne Wägung: 1 Lamm trinkt kg/Tag', 0.1)}
                {f('perDay2', 'Ohne Wägung: 2 Lämmer zusammen kg/Tag', 0.1)}
                {f('perDay3', 'Ohne Wägung: 3+ Lämmer zusammen kg/Tag', 0.1)}
              </div>
            )
          }}
        </SettingsEditor>
        </div>
      )}

      <p className="text-xs text-gray-600 sm:hidden">
        {shown.length} von {cards.length} {terms.plural}
      </p>
      <p className="hidden text-xs text-gray-600 sm:block">
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
          onNewGroup={async (name) => {
            const ids = chosen
            try {
              const id = crypto.randomUUID()
              await undoAction(`Neue Gruppe «${name}»`, () => saveGroup({ id, name, species: herdSpecies, milking: false, active: true, sort_order: (groups.length + 1) * 10, notes: null, updated_at: '', deleted_at: null }))
              setHerd(await loadHerdData())
              moveToDraft(ids, id)
              setSelected(new Set())
              notifySuccess(`Gruppe «${name}» angelegt; ${ids.length} ${ids.length === 1 ? 'Tier' : 'Tiere'} im Entwurf`)
            } catch (e) {
              notifyError(errorText(e))
            }
          }}
          onNewList={async (name) => {
            const ids = chosen
            try {
              const added = await undoAction(`Neue Merkliste «${name}»`, async () => {
                const listId = await createWatchlist(db, name)
                return addToWatchlist(db, listId, ids, null)
              })
              setSelected(new Set())
              notifySuccess(`Merkliste «${name}» mit ${added} ${added === 1 ? 'Tier' : 'Tieren'} angelegt`)
            } catch (e) {
              notifyError(errorText(e))
            }
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

      {searching && emptyHidden > 0 && (
        <p className="mb-2 text-sm text-gray-700" role="status">
          {emptyHidden} {emptyHidden === 1 ? 'Spalte' : 'Spalten'} ohne Treffer ausgeblendet ·{' '}
          <button type="button" onClick={() => q.setText('')} className="min-h-9 font-medium text-brand-700 underline">
            Suche leeren
          </button>
        </p>
      )}

      <div ref={scroller} className={`flex snap-x snap-mandatory items-start gap-2 overflow-x-auto pb-4 ${stall ? '' : 'sm:snap-none'} sm:gap-3`}>
        {buildLanes(shownColumns, collapsed).map((lane) =>
          lane.kind === 'column' ? (
            renderColumn(lane.col, false)
          ) : (
            <div key={`stack:${lane.cols.map((c) => c.key).join('+')}`} className={`w-[calc(100vw-1.5rem)] shrink-0 snap-start space-y-2 ${stall ? 'lg:w-[26rem]' : 'sm:w-64'}`}>
              {lane.cols.map((c) => renderColumn(c, true))}
            </div>
          ),
        )}
      </div>
      <StickyHScroll target={scroller} />

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

      {editList && (() => {
        const l = lists.find((x) => x.id === editList)
        if (!l) return null
        const offen = (data?.entries ?? []).filter((e) => e.list_id === l.id && !e.done_at).length
        return (
          <GroupEditModal
            noun="Merkliste"
            name={l.name}
            memberCount={offen}
            blockedReason={null}
            deleteInfo={
              <p>
                {offen === 0 ? 'Die Merkliste ist leer.' : `${offen} ${offen === 1 ? 'Tier steht' : 'Tiere stehen'} darauf.`} Die Tiere selbst bleiben, wo sie sind; nur die Liste verschwindet.
                Wer sie später noch braucht, archiviert sie lieber.
              </p>
            }
            extra={
              <>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await undoAction(`Merkliste «${l.name}» archiviert`, () => saveWatchlist(db, { ...l, archived_at: new Date().toISOString() }))
                      notifySuccess(`«${l.name}» archiviert (Seite Merklisten)`)
                      setEditList(null)
                    } catch (e) {
                      notifyError(errorText(e))
                    }
                  }}
                  className="min-h-12 w-full rounded-lg border-2 border-gray-400 px-3 font-semibold text-gray-800"
                >
                  🗄 Archivieren
                </button>
                <Link to={`/${moduleKey}/merklisten`} className="grid min-h-12 w-full place-items-center rounded-lg border-2 border-gray-300 px-3 font-semibold text-brand-800">
                  Merklisten öffnen (Gründe, erledigt)
                </Link>
              </>
            }
            onClose={() => setEditList(null)}
            onRename={async (next) => {
              try {
                await undoAction(`Merkliste «${l.name}» umbenannt in «${next}»`, () => saveWatchlist(db, { ...l, name: next }))
                notifySuccess(`Merkliste heisst jetzt «${next}»`)
              } catch (e) {
                notifyError(errorText(e))
                throw e
              }
            }}
            onDelete={async () => {
              try {
                await undoAction(`Merkliste «${l.name}» gelöscht`, () => deleteWatchlist(db, l))
                notifySuccess(`Merkliste «${l.name}» gelöscht`)
              } catch (e) {
                notifyError(errorText(e))
                throw e
              }
            }}
          />
        )
      })()}

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

/** Summen oben in einer Spalte (Σ Summen: Kennzahlen und Zeitraum wählen): Schlachtwert mit Kategorien zum Aufklappen,
 * Milch und Futter im gewählten Zeitraum. Eine Schätzung. */
function ColumnTotals({
  list,
  totals,
  sheep,
  meatAll,
  windowById,
}: {
  list: BoardCard[]
  totals: ColumnTotalsSettings
  sheep: boolean
  meatAll: ReadonlyMap<string, MeatValue | null>
  windowById: ReadonlyMap<string, MilkFeedWindow>
}) {
  const [meatOpen, setMeatOpen] = useState(false)
  const fr = (v: number) => Math.round(v).toLocaleString('de-CH')
  const kg = (v: number) => (v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('de-CH'))
  const rows: { icon: string; label: string; value: string; note?: string }[] = []
  const w = list.map((c) => windowById.get(c.id)).filter((x): x is MilkFeedWindow => !!x)
  const period = periodLabel(totals.days)
  if (totals.milk && w.length) {
    const unknown = w.filter((x) => x.milkUnknown).length
    rows.push({ icon: '🥛', label: `Milch ${period}`, value: `${kg(w.reduce((t, x) => t + x.milkKg, 0))} kg ≈ ${fr(w.reduce((t, x) => t + x.milkValue, 0))} Fr.`, note: unknown ? `${unknown} ohne aktuelle Wägung` : undefined })
  }
  if (totals.feed && w.length) {
    rows.push({ icon: '🌾', label: `Futter ${period}`, value: `${kg(w.reduce((t, x) => t + x.feedKg, 0))} kg ≈ ${fr(w.reduce((t, x) => t + x.feedCost, 0))} Fr.` })
  }
  const meat = sheep && totals.meat ? sumMeat(list.map((c) => meatAll.get(c.id) ?? null)) : null
  if (rows.length === 0 && !meat) return null
  const bandTotal = meat ? MEAT_BANDS.reduce((t, b) => t + Math.max(0, meat.byBand[b].net), 0) : 0
  const used = meat ? MEAT_BANDS.filter((b) => meat.byBand[b].n > 0) : []
  return (
    <div className="mb-1.5 rounded-lg bg-white px-2 py-1.5 text-xs sm:mb-2" aria-label="Summen der Spalte" title="Summen über alle Tiere dieser Spalte (Σ Summen: Kennzahlen und Zeitraum wählen). Eine Schätzung.">
      {meat && (
        <div className="mb-0.5">
          <button type="button" onClick={() => setMeatOpen((v) => !v)} aria-expanded={meatOpen} className="flex w-full items-center gap-2 text-left">
            <span className="text-gray-600">
              <span aria-hidden>🥩</span> Schlachtwert
            </span>
            {bandTotal > 0 && (
              <span role="img" aria-label={`nach Kategorie: ${used.map((b) => `${MEAT_BAND_LABEL[b]} ${meat.byBand[b].n}`).join(', ')}`} className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                {used.map((b) => (
                  <span key={b} className={`${MEAT_BAND_BAR[b]} h-full`} style={{ width: `${(Math.max(0, meat.byBand[b].net) / bandTotal) * 100}%` }} />
                ))}
              </span>
            )}
            <span className="ml-auto shrink-0 font-semibold tabular-nums text-gray-900">≈ {fr(meat.net)} Fr.</span>
            <span className="shrink-0 text-gray-500" aria-hidden>{meatOpen ? '▴' : '▾'}</span>
          </button>
          {meatOpen && (
            <div className="mt-1 rounded bg-emerald-50 px-1.5 py-1 text-emerald-950">
              <ul className="space-y-0.5">
                {used.map((b) => (
                  <li key={b} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${MEAT_BAND_BAR[b]}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{MEAT_BAND_LABEL[b]}</span>
                    <span className="tabular-nums">{meat.byBand[b].n} · {fr(meat.byBand[b].net)} Fr.</span>
                  </li>
                ))}
              </ul>
              <div className="mt-0.5 text-[0.73rem] text-emerald-900">
                {meat.unknown > 0 ? `${meat.unknown} ohne Geburtsdatum · ` : ''}vor Abzügen {fr(meat.gross)} Fr.
              </div>
            </div>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <dl className="space-y-0.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-2">
              <dt className="text-gray-600">
                <span aria-hidden>{r.icon}</span> {r.label}
              </dt>
              <dd className="text-right font-semibold tabular-nums text-gray-900">
                {r.value}
                {r.note && <span className="block text-[0.73rem] font-normal text-amber-800">{r.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
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
  groupChoices,
  onMoveToGroup,
  meat,
  milkFeed,
  lastMilk,
  lambValue,
  meatLimits,
  fields,
  verdict,
  money,
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
  groupChoices?: { id: string | null; name: string }[]
  onMoveToGroup?: (groupId: string | null) => void
  meat?: MeatValue | null
  milkFeed?: MilkFeed | null
  lastMilk?: MilkSample | null
  lambValue?: CardLambValue | null
  /** Grenzen im Balken (feste Skala) */
  meatLimits?: MeatLimit[]
  fields?: CardFieldKey[]
  verdict?: VerdictResult | null
  money?: ReturnType<typeof moneyBalance>
  pointerDown: (cardId: string, handle: boolean) => (e: React.PointerEvent) => void
}) {
  void col
  const milkFeedSettings = useMilkFeedSettings(moduleKey, speciesOf(moduleKey))
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
      groupChoices={groupChoices}
      onMoveToGroup={onMoveToGroup}
      meat={meat}
      milkFeed={milkFeed}
      lastMilk={lastMilk ?? null}
      lambValue={lambValue ?? null}
      milkFeedSettings={milkFeedSettings}
      meatLimits={meatLimits}
      fields={fields}
      verdict={verdict ?? null}
      money={money ?? null}
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
  onNewGroup,
  onNewList,
  onClear,
}: {
  count: number
  groups: { id: string; name: string }[]
  lists: { id: string; name: string }[]
  canMove: boolean
  onDraft: (target: string | null) => void
  onList: (listId: string) => void
  onNewGroup: (name: string) => void
  onNewList: (name: string) => void
  onClear: () => void
}) {
  const [group, setGroup] = useState('')
  const [list, setList] = useState('')
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border-2 border-brand-700 bg-white p-2 text-sm shadow-lg" role="region" aria-label="Auswahl">
      <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-700 px-3 font-semibold text-white" aria-live="polite">
        <span aria-hidden>✓</span> {count} {count === 1 ? 'Tier' : 'Tiere'} gewählt
      </span>
      {canMove && (
        <span className="flex items-center gap-1">
          <SearchPick
            className="w-52"
            label="In Gruppe verschieben"
            placeholder="Gruppe wählen…"
            items={[...groups.map((g) => ({ id: g.id, label: g.name })), { id: 'none', label: 'Ohne Gruppe' }]}
            value={group}
            onChange={setGroup}
            onCreate={onNewGroup}
            createLabel="als neue Gruppe anlegen"
          />
          <button type="button" disabled={!group} onClick={() => onDraft(group === 'none' ? null : group)} className="min-h-11 rounded-lg bg-brand-700 px-3 font-medium text-white disabled:opacity-50">
            In Entwurf
          </button>
        </span>
      )}
      <span className="flex items-center gap-1">
        <SearchPick
          className="w-52"
          label="Auf Merkliste setzen"
          placeholder="Merkliste wählen…"
          items={lists.map((l) => ({ id: l.id, label: l.name }))}
          value={list}
          onChange={setList}
          onCreate={onNewList}
          createLabel="als neue Merkliste anlegen"
        />
        <button type="button" disabled={!list} onClick={() => onList(list)} className="min-h-11 rounded-lg border border-brand-700 px-3 font-medium text-brand-700 disabled:opacity-50">
          Auf Liste
        </button>
      </span>
      <button type="button" onClick={onClear} className="ml-auto min-h-11 rounded-lg border border-gray-300 px-3 text-gray-800 active:bg-gray-100">
        ✕ Auswahl aufheben
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
