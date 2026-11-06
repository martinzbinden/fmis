import { useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import NumberInput from '@fmis/core/NumberInput'
import { useOnUndo } from '@fmis/core/undo'
import { errorText, notifyError } from '@fmis/core/toast'
import { fmtNum } from '@fmis/core/yearSummary'
import { upsertRow } from '../db/write'
import { useQuery } from '../hooks/useQuery'
import {
  compareWithStatement,
  dpCropName,
  DP_LINE_LABEL,
  DP_RATES,
  DP_STORED_EMPTY,
  estimateFarm,
  referenceFor,
  resolveSettings,
  type DpParcel,
  type DpParcelEstimate,
  type DpStatementLine,
  type DpStored,
} from '../lib/directPayments'
import { cropLabel } from '../lib/rotationRules'

const YEARS = Object.keys(DP_RATES).map(Number).sort((a, b) => b - a)
const HANG_LABEL = ['18–35 %', 'über 35–50 %', 'über 50 %']

type Row = DpParcel & { farm_id: string }
interface SettingsRow {
  id: string
  farm_id: string
  jahr: number
  bio: boolean | null
  gmf: boolean | null
  rgve: number | null
  hang_18: number | null
  hang_35: number | null
  hang_50: number | null
  q2: string | null
}

async function loadData(pg: PGlite, year: number) {
  const { rows } = await pg.query<Row>(
    `select d.id, d.lineage_id, d.farm_id, d.flurname, d.kultur_code, d.kultur_name_de,
            d.area_a::float8 as area_a, d.baeume::float8 as baeume, mu.zone
     from field_declarations d
     left join management_units mu on mu.farm_id = d.farm_id and mu.external_id = d.management_unit_external_id
       and mu.jahr = d.jahr and mu.deleted_at is null
     where d.deleted_at is null and d.jahr = $1 and d.sequence_in_year = 1 and d.source = 'import'`,
    [year],
  )
  const { rows: farms } = await pg.query<{ id: string; name: string }>('select id, name from farms where deleted_at is null order by name')
  const { rows: settings } = await pg.query<SettingsRow>(
    `select id, farm_id, jahr, bio, gmf, rgve::float8 as rgve, hang_18::float8 as hang_18, hang_35::float8 as hang_35, hang_50::float8 as hang_50, q2
     from dp_settings where deleted_at is null and jahr <= $1 order by jahr desc, updated_at desc`,
    [year],
  )
  const { rows: statement } = await pg.query<DpStatementLine & { farm_id: string; jahr: number }>(
    `select farm_id, jahr, section, label, zone, quantity::float8 as quantity, rate::float8 as rate, factor::float8 as factor, amount::float8 as amount
     from dp_statement_lines where deleted_at is null and jahr <= $1`,
    [year],
  )
  return { rows, farms, settings, statement }
}

function storedOf(row: SettingsRow | undefined): DpStored {
  if (!row) return DP_STORED_EMPTY
  let q2: Record<string, number> = {}
  try {
    q2 = JSON.parse(row.q2 ?? '{}') as Record<string, number>
  } catch {
    /* unlesbar: dann aus der Abrechnung */
  }
  return { bio: row.bio, gmf: row.gmf, rgve: row.rgve, hang: [row.hang_18, row.hang_35, row.hang_50], q2 }
}

const fr = (v: number) => `${fmtNum(v, 0)} Fr.`
const rp = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function DirectPayments() {
  // Betriebszahlen: nicht für die Rolle Mitarbeit
  const allowed = useHasPermission('fields:dz:read')
  const canWrite = useHasPermission('fields:dz:write')
  const [year, setYear] = useState(YEARS[0])
  const { data } = useQuery((pg) => loadData(pg, year), [year])
  const [farmId, setFarmId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  // Eingaben sofort anzeigen, gespeichert wird beim Verlassen des Felds
  const [draft, setDraft] = useState<{ key: string; stored: DpStored } | null>(null)
  const newIds = useRef(new Map<string, string>())
  useOnUndo(() => setDraft(null))

  const farmsWithData = useMemo(() => (data?.farms ?? []).filter((f) => data?.rows.some((r) => r.farm_id === f.id)), [data])
  const farm = farmsWithData.find((f) => f.id === farmId) ?? farmsWithData[0]
  const key = `${farm?.id}|${year}`
  // gilt, bis es für ein Jahr neue Angaben gibt: die jüngsten bis zu diesem Jahr
  const row = data?.settings.find((s) => s.farm_id === farm?.id)
  const stored = draft?.key === key ? draft.stored : storedOf(row)
  const parcelRows = useMemo(() => (farm && data ? data.rows.filter((r) => r.farm_id === farm.id) : []), [farm, data])
  const ref = useMemo(() => (farm && data ? referenceFor(data.statement, farm.id, year) : undefined), [farm, data, year])
  const settings = useMemo(() => resolveSettings(stored, parcelRows, ref), [stored, parcelRows, ref])
  const derived = useMemo(() => resolveSettings(DP_STORED_EMPTY, parcelRows, ref), [parcelRows, ref])
  const estimate = useMemo(() => (farm ? estimateFarm(DP_RATES[year], parcelRows, settings, ref) : null), [farm, year, parcelRows, settings, ref])

  if (!allowed) return <p className="p-6 text-center text-gray-500">Diese Seite ist der Betriebsleitung und dem Büro vorbehalten.</p>
  if (!data) return <p className="p-6 text-center text-gray-500">Lädt…</p>

  const yearSwitch = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Jahr">
      {YEARS.map((y) => (
        <button
          key={y}
          type="button"
          aria-pressed={y === year}
          onClick={() => {
            setYear(y)
            setOpen(null)
          }}
          className={`min-h-11 rounded-full px-4 text-sm font-medium ${y === year ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 shadow-sm'}`}
        >
          {y}
        </button>
      ))}
    </div>
  )
  if (!farm || !estimate) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        {yearSwitch}
        <p className="p-6 text-center text-gray-500">Keine Parzellen für {year} — zuerst unter «Karte» Raumdaten importieren.</p>
      </div>
    )
  }

  const save = (next: DpStored) => {
    if (!canWrite) return
    const exact = row?.jahr === year ? row.id : undefined
    if (!exact && !newIds.current.has(key)) newIds.current.set(key, crypto.randomUUID())
    upsertRow('dp_settings', {
      id: exact ?? newIds.current.get(key)!,
      farm_id: farm.id,
      jahr: year,
      bio: next.bio,
      gmf: next.gmf,
      rgve: next.rgve,
      hang_18: next.hang[0],
      hang_35: next.hang[1],
      hang_50: next.hang[2],
      q2: JSON.stringify(next.q2),
      deleted_at: null,
    } as never).catch((err: unknown) => notifyError(errorText(err, 'Speichern fehlgeschlagen')))
  }
  const update = (p: Partial<DpStored>, persist = false) => {
    const next = { ...stored, ...p }
    setDraft({ key, stored: next })
    if (persist) save(next)
  }
  const setQ2 = (lineage: string, text: string) => {
    const q2 = { ...stored.q2 }
    if (text === '') delete q2[lineage]
    else q2[lineage] = Number(text) || 0
    update({ q2 })
  }
  const persist = () => save(stored)

  const q = search.trim().toLowerCase()
  const parcels = estimate.parcels
    .filter((p) => !q || `${p.parcel.flurname ?? ''} ${p.parcel.kultur_name_de ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.parcel.flurname ?? '\uffff').localeCompare(b.parcel.flurname ?? '\uffff', 'de') || b.total - a.total)
  const offene = estimate.parcels.filter((p) => p.offen)
  const belowStock = settings.rgve != null && estimate.factor < 1
  const compare = compareWithStatement(estimate, ref?.lines ?? [])
  const statementTotal = compare.reduce((sum, c) => sum + (c.statement ?? 0), 0)

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Direktzahlungen {year}</h1>
        <p className="text-sm text-gray-600">Schätzung nach DZV Anhang 7. Massgebend ist die Abrechnung des Kantons.</p>
      </div>

      {yearSwitch}

      {farmsWithData.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Betrieb">
          {farmsWithData.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={f.id === farm.id}
              onClick={() => {
                setFarmId(f.id)
                setOpen(null)
              }}
              className={`min-h-11 rounded-full px-4 text-sm font-medium ${f.id === farm.id ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 shadow-sm'}`}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-gray-800">{farm.name}</h2>
          <span className="text-sm text-gray-500">{fmtNum(estimate.lnHa, 1)} ha</span>
        </div>
        <div className="mt-1 text-3xl font-bold tabular-nums text-gray-900">≈ {fr(estimate.total)}</div>
        <p className="text-xs text-gray-500">{ref ? `Rechner pro Jahr; Abrechnung ${ref.jahr}: ${fr(statementTotal)}` : 'pro Jahr, nur die unten aufgeführten Beiträge'}</p>
        <table className="mt-3 w-full text-sm">
          {ref && (
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="py-1 pr-2 text-left font-medium">Beitrag, Fr.</th>
                <th className="whitespace-nowrap py-1 pr-2 text-right font-medium">Rechner</th>
                <th className="whitespace-nowrap py-1 text-right font-medium">Abr. {ref.jahr}</th>
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-gray-100">
            {compare.map((c) => (
              <tr key={c.key}>
                <td className="py-1.5 pr-2 text-gray-700">{c.label}</td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-gray-900">{c.calc == null ? '–' : fmtNum(c.calc, 0)}</td>
                {ref && <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-gray-600">{c.statement == null ? '–' : fmtNum(c.statement, 0)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="py-1.5 pr-2 text-gray-800">Total</td>
              <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-gray-900">{fmtNum(estimate.total, 0)}</td>
              {ref && <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-gray-800">{fmtNum(statementTotal, 0)}</td>}
            </tr>
          </tfoot>
        </table>
        {ref ? (
          <p className="mt-2 text-xs text-gray-500">
            «–» beim Rechner: nur aus der Abrechnung, nicht im Total des Rechners. Vernetzung, Landschaftsqualität und GVE folgen der Abrechnung {ref.jahr}
            {ref.jahr < year ? `, Flächen sind von ${year}` : ''}.
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-800">Noch keine Abrechnung erfasst: Vernetzung, Landschaftsqualität und Tierwohl fehlen. Einfügen unter Daten importieren.</p>
        )}
      </section>

      {offene.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            Nicht eingerechnet: {fmtNum(estimate.offenHa, 2)} ha ohne klare Zuordnung
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {offene.map((p) => (
              <li key={p.parcel.id}>
                {p.parcel.flurname || `Code ${p.parcel.kultur_code}`}, {fmtNum(p.ha * 100, 2)} a: {p.offen}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-lg bg-white shadow-sm" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-gray-700">Angaben zum Betrieb</summary>
        <div className="space-y-3 border-t px-3 py-3 text-sm">
          <div className="flex flex-wrap gap-x-5">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={settings.bio} disabled={!canWrite} onChange={(e) => update({ bio: e.target.checked }, true)} />
              Bio-Betrieb
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={settings.gmf} disabled={!canWrite} onChange={(e) => update({ gmf: e.target.checked }, true)} />
              Teilnahme GMF
            </label>
          </div>
          <label className="block">
            <span className="font-medium text-gray-700">RGVE im Betrieb</span>
            <NumberInput
              value={stored.rgve ?? ''}
              onChange={(e) => update({ rgve: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={persist}
              placeholder="nicht angegeben"
              className="mt-1 block min-h-11 w-40 rounded-lg border-2 border-gray-300 px-2"
            />
            <span className={`mt-1 block text-xs ${belowStock ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
              Mindesttierbesatz {fmtNum(estimate.rgveMin, 1)} RGVE.{' '}
              {settings.rgve == null
                ? 'Ohne Angabe gilt er als erreicht.'
                : belowStock
                  ? `Nicht erreicht: Dauergrünland nur zu ${fmtNum(estimate.factor * 100, 0)} %.`
                  : 'Erreicht.'}
            </span>
          </label>
          <fieldset>
            <legend className="font-medium text-gray-700">Hanglagen in ha</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {HANG_LABEL.map((label, i) => (
                <label key={label} className="block text-xs text-gray-600">
                  {label}
                  <NumberInput
                    value={stored.hang[i] ?? ''}
                    onChange={(e) => {
                      const hang = [...stored.hang] as DpStored['hang']
                      hang[i] = e.target.value === '' ? null : Number(e.target.value) || 0
                      update({ hang })
                    }}
                    onBlur={persist}
                    placeholder={fmtNum(derived.hang[i], 2)}
                    className="mt-1 block min-h-11 w-full rounded-lg border-2 border-gray-300 px-2 text-sm"
                  />
                </label>
              ))}
            </div>
            <p className={`mt-1 text-xs ${estimate.hangZuKlein ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
              {estimate.hangZuKlein ? 'Unter 50 a Hanglagen gibt es keinen Beitrag. ' : ''}
              Weiden, Reben und Hecken zählen nicht. {ref ? `Leer: aus der Abrechnung ${ref.jahr}.` : ''}
            </p>
          </fieldset>
          <p className="text-xs text-gray-500">Gilt ab {year} für alle Geräte, bis du für ein späteres Jahr etwas änderst.</p>
        </div>
      </details>

      <section className="rounded-lg bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <h2 className="mr-auto text-sm font-semibold text-gray-700">Je Parzelle</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Flurname suchen"
            aria-label="Flurname suchen"
            className="min-h-11 w-44 rounded-lg border-2 border-gray-300 px-2 text-sm"
          />
        </div>
        {parcels.length === 0 ? (
          <p className="border-t px-3 py-4 text-center text-sm text-gray-500">Keine Parzelle gefunden.</p>
        ) : (
          <ul className="divide-y border-t">
            {parcels.map((p) => (
              <ParcelRow
                key={p.parcel.id}
                p={p}
                expanded={open === p.parcel.id}
                onToggle={() => setOpen(open === p.parcel.id ? null : p.parcel.id)}
                q2Input={stored.q2[p.parcel.lineage_id]}
                q2Derived={derived.q2[p.parcel.lineage_id] ?? 0}
                canWrite={canWrite}
                onQ2={(v) => setQ2(p.parcel.lineage_id, v)}
                onQ2Done={persist}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 text-xs text-gray-600 shadow-sm">
        <p>
          <span className="font-semibold text-gray-700">Grundlagen:</span> Die Tierzahlen stehen nicht vollständig in FMIS, darum kommen die GVE aus der
          Abrechnung; Weide, RAUS und BTS rechnet der Rechner mit den Ansätzen der Verordnung. Vorausgesetzt sind ÖLN und die übrigen Eintretensbedingungen.
        </p>
        <p>
          Vollständig rechnet der{' '}
          <a className="font-medium text-brand-700 underline" href="https://agripedia.ch/focus-ap-pa/de/beitragsrechner/" target="_blank" rel="noreferrer">
            Beitragsrechner von AGRIDEA
          </a>
          . Ansätze:{' '}
          <a className="font-medium text-brand-700 underline" href="https://www.fedlex.admin.ch/eli/cc/2013/765/de" target="_blank" rel="noreferrer">
            Direktzahlungsverordnung, Anhang 7
          </a>
          .
        </p>
      </section>
    </div>
  )
}

function ParcelRow({
  p,
  expanded,
  onToggle,
  q2Input,
  q2Derived,
  canWrite,
  onQ2,
  onQ2Done,
}: {
  p: DpParcelEstimate
  expanded: boolean
  onToggle: () => void
  q2Input: number | undefined
  q2Derived: number
  canWrite: boolean
  onQ2: (v: string) => void
  onQ2Done: () => void
}) {
  const name = cropLabel(dpCropName(p.parcel.kultur_code, p.parcel.kultur_name_de), p.parcel.kultur_code)
  const trees = p.parcel.baeume ?? 0
  const size = trees > 0 ? `${fmtNum(trees, 0)} ${trees === 1 ? 'Baum' : 'Bäume'}` : `${fmtNum(p.ha * 100, 2)} a`
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left active:bg-gray-50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">
            {p.parcel.flurname || name}
            {p.q2 > 0 && <span className="ml-1.5 rounded bg-green-100 px-1 text-[10px] font-semibold text-green-800">Q II</span>}
          </span>
          <span className="block truncate text-xs text-gray-600">
            {p.parcel.flurname ? `${name}, ` : ''}
            {size}
            {p.zoneLabel ? `, ${p.zoneLabel}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {p.offen ? <span className="text-amber-700">offen</span> : p.total > 0 ? <span className="font-semibold text-gray-900">{fr(p.total)}</span> : <span className="text-gray-400">–</span>}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          {(p.offen || p.ohne) && <p>{p.offen ?? p.ohne}</p>}
          {p.lines.map((l) => (
            <div key={l.key} className="flex justify-between gap-2">
              <span>
                {DP_LINE_LABEL[l.key]} <span className="text-gray-500">({rp(l.rate)} Fr./{p.isTree ? 'Baum' : 'ha'})</span>
              </span>
              <span className="tabular-nums">{rp(l.amount)}</span>
            </div>
          ))}
          {p.lines.length > 0 && (
            <div className="flex justify-between gap-2 border-t border-gray-200 pt-1 font-semibold">
              <span>Total pro Jahr</span>
              <span className="tabular-nums">{rp(p.total)}</span>
            </div>
          )}
          {!p.isTree && !p.offen && !p.ohne && (
            <p className="text-gray-500">{p.hangPossible ? 'Hangbeitrag je nach Neigung: nur im Betriebstotal.' : 'Kein Hangbeitrag für diese Nutzung.'}</p>
          )}
          {p.q2Possible && (
            <label className="flex min-h-11 items-center gap-2 font-medium">
              Davon Qualitätsstufe II
              <NumberInput
                value={q2Input ?? ''}
                disabled={!canWrite}
                onChange={(e) => onQ2(e.target.value)}
                onBlur={onQ2Done}
                placeholder={fmtNum(q2Derived, p.isTree ? 1 : 2)}
                className="min-h-11 w-24 rounded-lg border-2 border-gray-300 bg-white px-2 text-sm font-normal"
              />
              {p.isTree ? 'Bäume' : 'a'}
            </label>
          )}
        </div>
      )}
    </li>
  )
}
