import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, todayIso } from '../lib/format'
import { AGE_BANDS } from '../lib/slaughterRecords'
import { loadFatteningInputs } from '../lib/fatteningData'
import {
  bySire,
  DEFAULT_FATTENING_SETTINGS,
  deliveryKey,
  allocateLabour,
  evaluateLamb,
  groupRows,
  histogram,
  loadFatteningSettings,
  normalizeSettings,
  OUTSIDE_FLAG_SHARE,
  saveFatteningSettings,
  settingsDiffer,
  SEX_LABELS,
  sexKey,
  summarize,
  type FatteningGroup,
  type FatteningSettings,
  type LambResult,
} from '../lib/fattening'

const fr = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n1 = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1 })
const dash = (v: number | null | undefined, f: (x: number) => string = String) => (v == null ? '–' : f(v))

/** Mastauswertung der Lämmer aus den Schlachtabrechnungen: Tageszunahmen, geschätzter Futterverzehr in der Mast,
 * Futterverwertung und Deckungsbeitrag, je Tier und in Gruppen. Rechnung in lib/fattening.ts. */
export default function Fattening() {
  const { data, loading } = useQuery(loadFatteningInputs)
  const [settings, setSettings] = useState<FatteningSettings>(loadFatteningSettings)
  const rows = useMemo(() => allocateLabour((data ?? []).map((l) => evaluateLamb(l, settings)), settings.labourHoursPerDay), [data, settings])
  const [year, setYear] = useState('')
  const [delivery, setDelivery] = useState('')
  const [sex, setSex] = useState('')

  const years = useMemo(() => [...new Set(rows.map((r) => r.input.slaughter_date.slice(0, 4)))].sort().reverse(), [rows])
  const inYear = rows.filter((r) => !year || r.input.slaughter_date.startsWith(year))
  const dates = [...new Set(inYear.map((r) => r.input.slaughter_date))].sort().reverse()
  const sexes = ['m', 'w', 'k', 'x'].filter((k) => rows.some((r) => sexKey(r.input.sex) === k))
  const shown = inYear.filter((r) => (!delivery || r.input.slaughter_date === delivery) && (!sex || sexKey(r.input.sex) === sex))
  const sum = summarize(shown)
  const chip = (on: boolean) => `min-h-10 rounded-full border px-3 text-sm ${on ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-700'}`

  if (loading && !data) return <div className="p-4 text-center text-gray-500">Lädt…</div>

  const groups: { title: string; groups: FatteningGroup[] }[] = []
  if (shown.length) {
    groups.push({
      title: 'Nach Lieferung',
      groups: groupRows(shown, (r) => ({ key: deliveryKey(r), label: `${fmtDate(r.input.slaughter_date)}${r.input.buyer ? ` ${r.input.buyer}` : ''}` })).reverse(),
    })
    groups.push({ title: 'Nach Geschlecht', groups: groupRows(shown, (r) => ({ key: sexKey(r.input.sex), label: SEX_LABELS[sexKey(r.input.sex)] }), ['m', 'w', 'k', 'x']) })
    const tax = groupRows(shown, (r) => (r.input.classification ? { key: r.input.classification, label: r.input.classification } : { key: '', label: 'ohne Taxation' }))
    groups.push({ title: 'Nach Taxation', groups: [...tax.filter((g) => g.key), ...tax.filter((g) => !g.key)] })
    groups.push({
      title: 'Nach Alter am Schlachttag',
      groups: groupRows(
        shown,
        (r) => {
          if (r.ageDays == null) return { key: 'unbekannt', label: 'Alter unbekannt' }
          const b = AGE_BANDS.find((x) => r.ageDays! <= x.max)!
          return { key: b.key, label: b.label }
        },
        [...AGE_BANDS.map((b) => b.key), 'unbekannt'],
      ),
    })
    if (shown.some((r) => r.input.group_name)) {
      const g = groupRows(shown, (r) => (r.input.group_name ? { key: r.input.group_name, label: r.input.group_name } : { key: '', label: 'nicht im Mastplaner' }))
      groups.push({ title: 'Nach Mastplaner-Gruppe', groups: [...g.filter((x) => x.key), ...g.filter((x) => !x.key)] })
    }
    const sires = bySire(shown)
    if (sires.length) groups.push({ title: 'Nach Vater (ab 2 Lämmern)', groups: sires })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Mastauswertung</h1>
        <Link to="/livestock/schlachtungen" className="inline-flex min-h-10 items-center text-sm text-brand-700">
          Schlachtungen →
        </Link>
      </div>
      <p className="text-xs text-gray-600">
        Lämmer aus den Schlachtabrechnungen: Tageszunahmen, geschätzter Futterverzehr in der Mast, Futterverwertung und Deckungsbeitrag. Geburt, Absetzen und Wägungen kommen aus Mastplaner und Milchschafen (über die Ohrmarke). Wie gerechnet wird, steht unten unter «Methode und Annahmen».
      </p>

      {settingsDiffer(settings) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            <b>Eigene Annahmen aktiv</b> (nur in diesem Browser): die Zahlen weichen von den Vorgaben ab.
          </span>
          <button
            type="button"
            onClick={() => document.getElementById('methode')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="min-h-10 rounded-lg border border-amber-400 bg-white px-3 font-medium"
          >
            Zu den Annahmen
          </button>
        </div>
      )}

      {data && rows.length === 0 && (
        <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">
          Noch keine Lämmer aus Schlachtabrechnungen. Abrechnungen einlesen unter{' '}
          <Link to="/livestock/schlachtungen" className="font-semibold text-brand-700">
            Schlachtungen
          </Link>
          .
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Jahr">
            <button type="button" className={chip(!year)} aria-pressed={!year} onClick={() => {
                setYear('')
                setDelivery('')
              }}>
              alle Jahre
            </button>
            {years.map((y) => (
              <button key={y} type="button" className={chip(year === y)} aria-pressed={year === y} onClick={() => {
                  setYear(y)
                  setDelivery('')
                }}>
                {y}
              </button>
            ))}
          </div>
          {dates.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Lieferung">
              <button type="button" className={chip(!delivery)} aria-pressed={!delivery} onClick={() => setDelivery('')}>
                alle Lieferungen
              </button>
              {dates.map((d) => (
                <button key={d} type="button" className={chip(delivery === d)} aria-pressed={delivery === d} onClick={() => setDelivery(d)}>
                  {fmtDate(d)}
                </button>
              ))}
            </div>
          )}
          {sexes.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Geschlecht">
              <button type="button" className={chip(!sex)} aria-pressed={!sex} onClick={() => setSex('')}>
                alle
              </button>
              {sexes.map((k) => (
                <button key={k} type="button" className={chip(sex === k)} aria-pressed={sex === k} onClick={() => setSex(k)}>
                  {SEX_LABELS[k]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label="Lämmer" value={String(sum.n)} sub={sum.nNoBirth ? `ohne Geburtsdatum: ${sum.nNoBirth}` : undefined} />
            <Tile label="Ø Alter" value={dash(sum.meanAge, (v) => `${v} Tage`)} />
            <Tile label="Ø Schlachtgewicht" value={dash(sum.meanSg, (v) => `${n1(v)} kg`)} sub={sum.meanLw != null ? `Ø LG ${n1(sum.meanLw)} kg` : undefined} />
            <Tile label="Ø Netto-Tageszunahme" value={dash(sum.meanNtz, (v) => `${v} g`)} sub="SG je Lebenstag (ohne Annahmen)" />
            <Tile label="Ø Lebenstageszunahme" value={dash(sum.meanLtz, (v) => `${v} g`)} sub="LG je Lebenstag" />
            <Tile label="Ø Masttageszunahme" value={dash(sum.meanMtz, (v) => `${v} g`)} sub={`n = ${sum.nMtz} (Gewicht bei Mastbeginn gemessen)`} />
            <Tile label="Ø Masttage" value={dash(sum.meanDays, (v) => `${v} Tage`)} />
            <Tile label="Ø TS-Verzehr je Tier" value={dash(sum.meanDm, (v) => `${n1(v)} kg`)} sub={sum.sumDm != null ? `Summe ${n1(sum.sumDm)} kg TS (geschätzt)` : undefined} />
            <Tile label="Futterverwertung" value={dash(sum.fcr, (v) => `${n1(v)} kg`)} sub="kg TS je kg Zuwachs in der Mast" />
            <Tile label="Ø DB je Tier" value={dash(sum.meanMargin, (v) => `${fr(v)} Fr.`)} sub={sum.nMargin < sum.n ? `n = ${sum.nMargin}` : undefined} />
            <Tile label="DB je Masttag" value={dash(sum.marginPerDay, (v) => `${fr(v)} Fr.`)} />
            <Tile label="Summe DB" value={dash(sum.sumMargin, (v) => `${fr(v)} Fr.`)} />
            {settings.labourHoursPerDay > 0 && (
              <Tile
                label="Arbeitsverdienst"
                value={dash(sum.marginPerHour, (v) => `${fr(v)} Fr./h`)}
                sub={sum.sumLabourHours != null ? `DB je Arbeitsstunde, ${n1(sum.sumLabourHours)} h` : 'nur Tiere aus dem Mastplaner'}
              />
            )}
          </section>

          <LtzHistogram rows={shown} />

          {groups.map((g) => (
            <GroupTable key={g.title} title={g.title} groups={g.groups} labour={settings.labourHoursPerDay > 0} />
          ))}

          <AnimalTable rows={shown} />
        </>
      )}

      <Method
        settings={settings}
        onSave={(s) => {
          const next = normalizeSettings(s)
          setSettings(next)
          saveFatteningSettings(next)
        }}
      />
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-lg font-bold tabular-nums text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-600">{sub}</div>}
    </div>
  )
}

function LtzHistogram({ rows }: { rows: LambResult[] }) {
  const classes = histogram(rows.map((r) => r.ltz))
  if (!classes.length) return null
  const max = Math.max(...classes.map((c) => c.n), 1)
  return (
    <section className="rounded-lg bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Verteilung der Lebenstageszunahme (g/Tag)</h2>
      <ul className="space-y-1 text-sm" aria-label="Anzahl Lämmer je Klasse der Lebenstageszunahme">
        {classes.map((c) => (
          <li key={c.from} className="flex items-center gap-2" aria-label={`${c.from} bis unter ${c.to} g: ${c.n} Lämmer`}>
            <span className="w-20 shrink-0 text-right tabular-nums text-gray-700">
              {c.from}–{c.to}
            </span>
            <span className="h-4 flex-1" aria-hidden="true">
              <span className="block h-4 rounded bg-brand-600" style={{ width: `${(c.n / max) * 100}%`, minWidth: c.n ? '0.25rem' : 0 }} />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-gray-900" aria-hidden="true">
              {c.n}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GroupTable({ title, groups, labour }: { title: string; groups: FatteningGroup[]; labour?: boolean }) {
  return (
    <section className="rounded-lg bg-white p-3 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-2" />
              <th className="whitespace-nowrap pr-2 text-right">n</th>
              <th className="whitespace-nowrap pr-2 text-right">Ø Alter</th>
              <th className="whitespace-nowrap pr-2 text-right">Ø SG</th>
              <th className="whitespace-nowrap pr-2 text-right">Ø NTZ</th>
              <th className="whitespace-nowrap pr-2 text-right">Ø LTZ</th>
              <th className="whitespace-nowrap pr-2 text-right">Ø TS/Tier</th>
              <th className="whitespace-nowrap pr-2 text-right">Ø DB</th>
              {labour && <th className="whitespace-nowrap pr-2 text-right">Fr./h</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {groups.map((g) => (
              <tr key={g.key}>
                <td className="py-1 pr-2 text-gray-700">{g.label}</td>
                <td className="whitespace-nowrap pr-2 text-right tabular-nums text-gray-600">{g.summary.n}</td>
                <td className="whitespace-nowrap pr-2 text-right tabular-nums">{dash(g.summary.meanAge, (v) => `${v} T.`)}</td>
                <td className="whitespace-nowrap pr-2 text-right tabular-nums">{dash(g.summary.meanSg, (v) => `${n1(v)} kg`)}</td>
                <td className="whitespace-nowrap pr-2 text-right tabular-nums">{dash(g.summary.meanNtz, (v) => `${v} g`)}</td>
                <td className="whitespace-nowrap pr-2 text-right tabular-nums">{dash(g.summary.meanLtz, (v) => `${v} g`)}</td>
                <td className="whitespace-nowrap pr-2 text-right tabular-nums">{dash(g.summary.meanDm, (v) => `${n1(v)} kg`)}</td>
                <td className="whitespace-nowrap pr-2 text-right font-semibold tabular-nums">{dash(g.summary.meanMargin, fr)}</td>
                {labour && <td className="whitespace-nowrap pr-2 text-right tabular-nums">{dash(g.summary.marginPerHour, fr)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

interface Column {
  key: string
  label: string
  title?: string
  /** Wert zum Sortieren und für die CSV */
  value: (r: LambResult) => string | number | null
  render?: (r: LambResult) => ReactNode
  right?: boolean
}

const START_LABEL: Record<string, string> = { Mastplaner: 'Einstallung', Absetzen: 'abgesetzt', weggenommen: 'weggenommen', angenommen: 'angenommen' }

const COLUMNS: Column[] = [
  {
    key: 'tag',
    label: 'Ohrmarke',
    value: (r) => r.input.animal_key ?? r.input.ear_tag,
    render: (r) => {
      const t = r.input.ear_tag || r.input.animal_key ? shortEarTag(r.input.animal_key ?? r.input.ear_tag) : '–'
      return r.input.livestock_id ? (
        <Link to={`/livestock/tiere/${r.input.livestock_id}`} className="inline-flex min-h-10 items-center font-medium text-brand-700">
          {t}
        </Link>
      ) : (
        t
      )
    },
  },
  { key: 'sex', label: 'Geschl.', value: (r) => sexKey(r.input.sex), render: (r) => (r.input.sex === 'w' ? '♀ w' : r.input.sex === 'm' ? '♂ m' : r.input.sex === 'k' ? 'K' : '–') },
  { key: 'age', label: 'Alter', title: 'Alter am Schlachttag (Tage)', value: (r) => r.ageDays, right: true },
  { key: 'sg', label: 'SG', title: 'Schlachtgewicht kg', value: (r) => r.input.carcass_kg, right: true },
  { key: 'tax', label: 'Tax.', value: (r) => r.input.classification },
  {
    key: 'lg',
    label: 'LG',
    title: 'Lebendgewicht am Schlachttag kg: g = gewogen (höchstens 7 Tage davor), s = geschätzt aus SG und Ausbeute',
    value: (r) => r.lwKg,
    right: true,
    render: (r) =>
      r.lwKg == null ? (
        '–'
      ) : (
        <span title={r.lwWeighed ? `gewogen${r.dressingMeasuredPct != null ? `, Ausbeute ${r.dressingMeasuredPct} %` : ''}` : 'geschätzt aus SG und Ausbeute'}>
          {n1(r.lwKg)} <span className="text-xs text-gray-500">{r.lwWeighed ? `g${r.dressingMeasuredPct != null ? ` ${r.dressingMeasuredPct} %` : ''}` : 's'}</span>
        </span>
      ),
  },
  { key: 'ntz', label: 'NTZ', title: 'Netto-Tageszunahme g/Tag (SG je Lebenstag)', value: (r) => r.ntz, right: true },
  { key: 'ltz', label: 'LTZ', title: 'Lebenstageszunahme g/Tag', value: (r) => r.ltz, right: true },
  {
    key: 'start',
    label: 'Mastbeginn',
    value: (r) => r.startDate,
    render: (r) =>
      r.startDate ? (
        <span className="whitespace-nowrap">
          {fmtDate(r.startDate)} <span className="text-xs text-gray-500">{START_LABEL[r.startSource!]}</span>
        </span>
      ) : (
        '–'
      ),
  },
  { key: 'days', label: 'Masttage', value: (r) => r.fatteningDays, right: true },
  { key: 'mtz', label: 'MTZ', title: 'Masttageszunahme g/Tag (nur mit gemessenem Gewicht bei Mastbeginn)', value: (r) => r.mtz, right: true },
  {
    key: 'dm',
    label: 'TS kg',
    title: 'TS-Verzehr in der Mast, geschätzt',
    value: (r) => r.dmKg,
    right: true,
    render: (r) => dash(r.dmKg, n1),
  },
  { key: 'fcr', label: 'FVW', title: 'Futterverwertung: kg TS je kg Zuwachs in der Mast', value: (r) => r.fcr, right: true },
  {
    key: 'ed',
    label: 'NEV/TS',
    title: 'Nötiger Energiegehalt der Ration: MJ NEV je kg TS (Energiebedarf / TS-Verzehr)',
    value: (r) => r.energyDensity,
    right: true,
    render: (r) =>
      r.energyDensity == null ? (
        '–'
      ) : (
        <span title={r.outsideShare != null && r.outsideShare >= OUTSIDE_FLAG_SHARE ? `${Math.round(r.outsideShare * 100)} % der Masttage ausserhalb der Tabellen, fortgeschrieben` : undefined}>
          {r.energyDensity.toFixed(1)}
          {r.outsideShare != null && r.outsideShare >= OUTSIDE_FLAG_SHARE ? '*' : ''}
        </span>
      ),
  },
  { key: 'rev', label: 'Erlös', value: (r) => r.revenue, right: true, render: (r) => dash(r.revenue, fr) },
  {
    key: 'cost',
    label: 'Kosten',
    value: (r) => r.totalCost,
    right: true,
    render: (r) => (
      <span title={r.feedCostSource ? `Futter ${r.feedCostSource}: ${dash(r.feedCost, fr)} Fr.` : undefined}>
        {dash(r.totalCost, fr)}
        {r.feedCostSource === 'erfasst' && <span className="text-xs text-gray-500"> e</span>}
      </span>
    ),
  },
  { key: 'db', label: 'DB', value: (r) => r.margin, right: true, render: (r) => <b>{dash(r.margin, fr)}</b> },
  { key: 'dbday', label: 'DB/Tag', value: (r) => r.marginPerDay, right: true, render: (r) => dash(r.marginPerDay, fr) },
]

/** Zusätzliche Spalten nur in der CSV. */
const CSV_EXTRA: Column[] = [
  { key: 'date', label: 'Schlachtdatum', value: (r) => r.input.slaughter_date },
  { key: 'birth', label: 'Geburt', value: (r) => r.input.birth_date },
  { key: 'bw', label: 'Geburtsgewicht kg', value: (r) => r.birthWeightKg },
  { key: 'bwm', label: 'Geburtsgewicht', value: (r) => (r.birthWeightMeasured ? 'erfasst' : 'angenommen') },
  { key: 'lgsrc', label: 'LG', value: (r) => (r.lwKg == null ? null : r.lwWeighed ? 'gewogen' : 'geschätzt') },
  { key: 'dress', label: 'Ausbeute gemessen %', value: (r) => r.dressingMeasuredPct },
  { key: 'startsrc', label: 'Mastbeginn Herkunft', value: (r) => r.startSource },
  { key: 'sw', label: 'Gewicht Mastbeginn kg', value: (r) => r.startWeightKg },
  { key: 'swm', label: 'Gewicht Mastbeginn', value: (r) => (r.startWeightKg == null ? null : r.startWeightMeasured ? 'gemessen' : 'aus Kurve') },
  { key: 'gain', label: 'Zuwachs Mast kg', value: (r) => r.gainKg },
  { key: 'nev', label: 'NEV MJ', value: (r) => r.nevMj },
  { key: 'mjkg', label: 'MJ NEV je kg Zuwachs', value: (r) => r.mjPerKgGain },
  { key: 'ed', label: 'MJ NEV je kg TS', value: (r) => r.energyDensity },
  { key: 'out', label: 'Anteil ausserhalb Tabelle %', value: (r) => (r.outsideShare == null ? null : Math.round(r.outsideShare * 100)) },
  { key: 'sv', label: 'Wert Mastbeginn Fr.', value: (r) => r.startValue },
  { key: 'feed', label: 'Futterkosten Fr.', value: (r) => r.feedCost },
  { key: 'feedsrc', label: 'Futterkosten', value: (r) => r.feedCostSource },
  { key: 'med', label: 'Medikamente Fr.', value: (r) => r.medicationCost },
  { key: 'fees', label: 'Abzüge Fr.', value: (r) => r.fees },
  { key: 'other', label: 'übrige Kosten Fr.', value: (r) => r.otherCost },
  { key: 'dbkg', label: 'DB je kg Zuwachs Fr.', value: (r) => r.marginPerKgGain },
  { key: 'feedkg', label: 'Futterkosten je kg Zuwachs Fr.', value: (r) => r.feedCostPerKgGain },
  { key: 'labour', label: 'Arbeit h', value: (r) => r.labourHours },
  { key: 'dbh', label: 'DB je Arbeitsstunde Fr.', value: (r) => (r.margin != null && r.labourHours != null && r.labourHours > 0 ? Math.round((r.margin / r.labourHours) * 100) / 100 : null) },
  { key: 'group', label: 'Mastplaner-Gruppe', value: (r) => r.input.group_name },
  { key: 'sire', label: 'Vater', value: (r) => r.input.sire },
  { key: 'dam', label: 'Mutter', value: (r) => (r.input.dam ? shortEarTag(r.input.dam) : null) },
  { key: 'buyer', label: 'Abnehmer', value: (r) => r.input.buyer },
  { key: 'settlement', label: 'Abrechnung', value: (r) => r.input.settlement_no },
]

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(rows: LambResult[]) {
  const cols = [...COLUMNS, ...CSV_EXTRA]
  const header = cols.map((c) => csvCell(c.title ? `${c.label} (${c.title})` : c.label)).join(';')
  const lines = rows.map((r) => cols.map((c) => csvCell(c.value(r))).join(';'))
  const blob = new Blob(['﻿' + [header, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mastauswertung-${todayIso()}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function AnimalTable({ rows }: { rows: LambResult[] }) {
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: 'tag', asc: true })
  const col = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0]
  const sorted = [...rows].sort((a, b) => {
    const x = col.value(a)
    const y = col.value(b)
    // leere Werte immer ans Ende
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return sort.asc ? c : -c
  })
  return (
    <section className="rounded-lg bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-10 text-sm font-semibold text-brand-700">
          {open ? '▾' : '▸'} Einzelne Lämmer ({rows.length})
        </button>
        <button type="button" onClick={() => downloadCsv(sorted)} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700">
          CSV
        </button>
      </div>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key
                  return (
                    <th key={c.key} className={`pr-2 ${c.right ? 'text-right' : ''}`} aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        title={c.title}
                        onClick={() => setSort({ key: c.key, asc: active ? !sort.asc : true })}
                        className={`min-h-10 whitespace-nowrap ${active ? 'font-semibold text-gray-900' : ''}`}
                      >
                        {c.label}
                        {active ? (sort.asc ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((r) => (
                <tr key={r.input.id}>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap py-1 pr-2 tabular-nums ${c.right ? 'text-right' : ''}`}>
                      {c.render ? c.render(r) : dash(c.value(r) as number | null, (v) => (typeof v === 'number' ? n1(v) : String(v)))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-gray-600">
            <dt className="font-semibold">Alter</dt>
            <dd>Alter am Schlachttag in Tagen</dd>
            <dt className="font-semibold">SG</dt>
            <dd>Schlachtgewicht in kg</dd>
            <dt className="font-semibold">Tax.</dt>
            <dd>Taxation nach CH-TAX (Fleischigkeit und Fettklasse)</dd>
            <dt className="font-semibold">LG</dt>
            <dd>Lebendgewicht am Schlachttag in kg; g = gewogen (höchstens 7 Tage davor, mit gemessener Ausbeute in %), s = geschätzt aus SG und Ausbeute</dd>
            <dt className="font-semibold">NTZ</dt>
            <dd>Netto-Tageszunahme in g/Tag: Schlachtgewicht je Lebenstag</dd>
            <dt className="font-semibold">LTZ</dt>
            <dd>Lebenstageszunahme in g/Tag: Lebendgewicht minus Geburtsgewicht, je Lebenstag</dd>
            <dt className="font-semibold">MTZ</dt>
            <dd>Masttageszunahme in g/Tag, nur mit gemessenem Gewicht bei Mastbeginn</dd>
            <dt className="font-semibold">TS kg</dt>
            <dd>Trockensubstanz-Verzehr in der Mast, geschätzt</dd>
            <dt className="font-semibold">FVW</dt>
            <dd>Futterverwertung: kg TS je kg Zuwachs in der Mast</dd>
            <dt className="font-semibold">NEV/TS</dt>
            <dd>
              nötiger Energiegehalt der Ration in MJ NEV (Nettoenergie Fleischbildung) je kg TS; * = Energiebedarf an mindestens{' '}
              {Math.round(OUTSIDE_FLAG_SHARE * 100)} % der Masttage ausserhalb der Tabellen fortgeschrieben
            </dd>
            <dt className="font-semibold">Kosten</dt>
            <dd>Mastkosten in Fr.; e = Futterkosten aus dem Mastplaner erfasst, sonst aus TS-Verzehr geschätzt</dd>
            <dt className="font-semibold">DB, DB/Tag</dt>
            <dd>Deckungsbeitrag je Tier und je Masttag in Fr. (Erlös minus Kosten)</dd>
          </dl>
        </div>
      )}
    </section>
  )
}

function Method({ settings, onSave }: { settings: FatteningSettings; onSave: (s: FatteningSettings) => void }) {
  return (
    <section id="methode" className="scroll-mt-16 space-y-3 rounded-lg bg-white p-3 text-sm text-gray-700 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-700">Methode und Annahmen</h2>
      <ul className="list-disc space-y-1 pl-5 text-xs">
        <li>
          <b>Lebendgewicht (LG) am Schlachttag:</b> gewogen, wenn eine Wägung höchstens 7 Tage vor dem Schlachttag liegt (dann auch die gemessene Ausbeute = SG / LG); sonst geschätzt LG = Schlachtgewicht / Schlachtausbeute.
        </li>
        <li>
          <b>Netto-Tageszunahme (NTZ)</b> = Schlachtgewicht / Alter in Tagen. Braucht keine Annahme zur Ausbeute und ist deshalb die robusteste Zahl.
        </li>
        <li>
          <b>Lebenstageszunahme (LTZ)</b> = (LG am Schlachttag − Geburtsgewicht) / Alter. Geburtsgewicht aus der Geburt (Milchschafe), sonst die Einstellung.
        </li>
        <li>
          <b>Masttageszunahme (MTZ)</b> = (LG am Schlachttag − Gewicht bei Mastbeginn) / Masttage, nur wenn das Gewicht bei Mastbeginn gemessen ist (Einstallgewicht im Mastplaner oder Wägung ± 7 Tage).
        </li>
        <li>
          <b>Mastbeginn:</b> Einstallung im Mastplaner, sonst Absetzen (Milchschafe), sonst Geburt + Absetzalter (angenommen).
        </li>
        <li>
          <b>Gewichtskurve:</b> stückweise linear durch Geburt, alle Wägungen und den Schlachttag; unplausible Punkte fallen weg.
        </li>
        <li>
          <b>Futterverzehr</b> je Masttag aufsummiert: TS-Verzehr = 4 % des LG (kg TS/Tag); Energiebedarf NEV nach Geschlecht (Kastrat und unbekannt: männlich), Wachstumspotenzial, LG und Zunahme des Kurvenabschnitts, aus den Tabellen interpoliert. Ausserhalb der Tabellen wird linear fortgeschrieben (Zunahme 0–500 g, LG 10–50 kg); liegen mindestens {Math.round(OUTSIDE_FLAG_SHARE * 100)} % der Masttage ausserhalb, steht beim Tier ein * hinter dem Energiegehalt (NEV/TS).
        </li>
        <li>
          <b>Futterverwertung</b> = kg TS je kg Zuwachs in der Mast; dazu der nötige Energiegehalt der Ration (Σ NEV / Σ TS, MJ NEV/kg TS); in der CSV auch MJ NEV je kg Zuwachs.
        </li>
        <li>
          <b>Deckungsbeitrag (DB)</b> = Erlös (Betrag der Abrechnung, sonst SG × Preis) − Wert bei Mastbeginn (Kaufpreis im Mastplaner, sonst Gewicht × Fr./kg LG) − Futterkosten (im Mastplaner erfasste Gruppenkosten, sonst TS × Fr./kg TS) − Medikamente (Mastplaner) − Abzüge − übrige Kosten. Fehlt eine Angabe, bleibt der DB leer.
        </li>
        <li>
          <b>Arbeitsverdienst</b> = Σ DB / Σ Arbeitsstunden (Fr./h), wenn unten die Arbeitszeit je Tag eingetragen ist. Die Stunden eines Tages teilen sich die Tiere aus dem Mastplaner, die an diesem Tag in der Mast stehen; die Arbeit ist im DB nicht abgezogen. Tiere ohne Schlachtung fehlen in der Auswertung, ihre Stunden liegen bei den ausgewerteten Tieren.
        </li>
      </ul>
      <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
        Der TS-Verzehr ist ein Normwert, kein gemessener Wert. Die Tabellen gelten für Stallhaltung; auf der Weide ist der Erhaltungsbedarf laut Grünem Buch um 25 % höher – das ist hier nicht eingerechnet.
      </p>
      <p className="text-xs text-gray-600">
        Quelle: Agroscope, «Fütterungsempfehlungen für Wiederkäuer (Grünes Buch)», Kapitel 11 «Fütterungsempfehlungen für das Schaf» (Daccord, Kessler, Arrigo, Frioud, 2017), Tabellen 11.7–11.10.
      </p>
      <SettingsEditor value={settings} onSave={onSave} onReset={() => ({ ...DEFAULT_FATTENING_SETTINGS })} label="Annahmen" className="border-t pt-3" title={<b>Einstellungen (nur in diesem Browser)</b>}>
        {({ value, set, editing }) => {
          const numField = (key: Exclude<keyof FatteningSettings, 'growthPotential'>, label: string, step = 0.01) => (
            <label key={key} className="flex items-center justify-between gap-2 text-xs text-gray-600">
              {label}
              {editing ? (
                <NumberInput
                  inputMode="decimal"
                  step={step}
                  value={value[key]}
                  onChange={(e) => set({ ...value, [key]: Number(e.target.value) })}
                  className="min-h-10 w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                />
              ) : (
                <ReadValue>{value[key]}</ReadValue>
              )}
            </label>
          )
          return (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {numField('dressingPct', 'Schlachtausbeute % (wenn nicht gewogen)', 0.1)}
              {numField('birthWeightKg', 'Geburtsgewicht kg (wenn nicht erfasst)', 0.1)}
              {numField('weanAgeDays', 'Absetzalter Tage, wenn unbekannt', 1)}
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
                Wachstumspotenzial
                {editing ? (
                  <select value={value.growthPotential} onChange={(e) => set({ ...value, growthPotential: e.target.value === 'gering' ? 'gering' : 'hoch' })} className="min-h-10 rounded border border-gray-300 px-2 text-sm">
                    <option value="hoch">hoch</option>
                    <option value="gering">gering</option>
                  </select>
                ) : (
                  <ReadValue>{value.growthPotential}</ReadValue>
                )}
              </label>
              {numField('startValuePerKg', 'Wert bei Mastbeginn Fr./kg LG (0 = nicht eingerechnet)')}
              {numField('feedCostPerKgDm', 'Futterkosten Fr./kg TS (wenn nicht erfasst)')}
              {numField('feePerAnimal', 'Abzüge je Tier Fr. (Waagschein, Abgaben)')}
              {numField('otherCostPerAnimal', 'übrige Kosten je Tier Fr.')}
              {numField('labourHoursPerDay', 'Arbeitszeit Mast h/Tag, alle Tiere zusammen (0 = nicht eingerechnet)')}
            </div>
          )
        }}
      </SettingsEditor>
    </section>
  )
}
