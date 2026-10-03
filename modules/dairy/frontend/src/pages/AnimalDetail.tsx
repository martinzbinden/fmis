import AnimalLocationCard from '@fmis/core/AnimalLocationCard'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { softDeleteRow } from '../db/write'
import JournalForm from '../components/JournalForm'
import { categoryIcon, categoryLabel, journalSummary, withdrawalEnd } from '../lib/journal'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useQuery } from '../hooks/useQuery'
import { loadHerdContext, latestValues, type AnimalContext } from '../lib/herdContext'
import { cullingReasons, fmtCells, type CullingReason } from '../lib/culling'
import { useCullingThresholds } from '../lib/cullingSettings'
import { animalKey, animalLabel, shortEarTag } from '@fmis/core/earTag'
import { TRAIT_LABEL, TRAIT_ORDER } from '../lib/breedingTraits'
import { fmtInbreeding, inbreedingClass } from '../lib/inbreeding'
import PedigreeTree, { loadPedigreeData, pedigreeLink } from '../components/PedigreeTree'
import CertificateDetailsView from '../components/CertificateDetails'
import { hasCertificateDetails, loadCertificateDetails } from '../lib/certificateData'
import { loadSireOptions, sireLabel } from '../lib/sires'
import { fmtDate, isoDate, localTodayIso, num, todayIso } from '../lib/format'
import { speciesOf, speciesTerms } from '../lib/species'
import type { AnimalJournalEntry, LactationSummary } from '../types'

async function loadDetail(pg: PGlite, id: string, species: 'cattle' | 'sheep') {
  const today = todayIso()
  const herd = await loadHerdContext(pg, species, today)
  const ctx = herd.get(id) ?? null
  const [pedigreeData, lactations, tests, journal, sires, certificate] = await Promise.all([
    loadPedigreeData(pg, herd, species),
    pg.query<LactationSummary>('select * from v_lactation_summary where animal_id = $1 order by lactation_number desc', [id]),
    pg.query<{ test_date: unknown; milk_kg: unknown; cell_count: unknown }>(
      'select test_date, milk_kg, cell_count from milk_tests where animal_id = $1 and deleted_at is null order by test_date',
      [id],
    ),
    pg.query<AnimalJournalEntry>(
      'select * from animal_journal where animal_id = $1 and deleted_at is null order by entry_date desc, updated_at desc',
      [id],
    ),
    loadSireOptions(pg),
    ctx ? loadCertificateDetails(pg, animalKey(ctx.animal.ear_tag) ?? ctx.animal.ear_tag) : Promise.resolve(null),
  ])
  return {
    ctx,
    ...pedigreeData,
    sires,
    certificate,
    lactations: lactations.rows,
    tests: tests.rows.map((t) => ({ date: isoDate(t.test_date)!, milk: num(t.milk_kg), scc: num(t.cell_count) })),
    journal: journal.rows.map((j) => ({ ...j, entry_date: isoDate(j.entry_date)! })),
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="hyphens-auto break-words text-xs text-gray-500" lang="de">{label}</div>
      <div className="break-words text-sm font-medium text-gray-800">{value ?? '–'}</div>
    </div>
  )
}

const AREA_STYLE: Record<CullingReason['area'], string> = {
  fruchtbarkeit: 'bg-rose-100 text-rose-800',
  euter: 'bg-amber-100 text-amber-800',
  leistung: 'bg-sky-100 text-sky-800',
  zucht: 'bg-violet-100 text-violet-800',
  alter: 'bg-gray-100 text-gray-700',
  nachkommen: 'bg-orange-100 text-orange-800',
  gesundheit: 'bg-red-100 text-red-800',
}

export function ReasonChips({ reasons }: { reasons: CullingReason[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((r, i) => (
        <span key={i} className={`rounded px-1.5 py-0.5 text-xs ${AREA_STYLE[r.area]}`}>
          {r.text}
        </span>
      ))}
    </div>
  )
}

const INBREEDING_STYLE = {
  none: 'bg-green-100 text-green-800',
  low: 'bg-lime-100 text-lime-800',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-red-600 text-white',
} as const

export function InbreedingBadge({ f }: { f: number }) {
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${INBREEDING_STYLE[inbreedingClass(f)]}`}>{fmtInbreeding(f)}</span>
}

function InbreedingNote({ f, completeness }: { f: number; completeness: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
      <span>Inzucht</span>
      <InbreedingBadge f={f} />
      <span className="text-xs text-gray-500">
        Stammbaum: {completeness.toLocaleString('de-CH', { maximumFractionDigits: 1 })} vollständige Generationen
        {completeness < 3 ? ' — bei so wenig bekannten Vorfahren ist der Wert eher zu tief' : ''}
      </span>
    </div>
  )
}

function round(v: number | null | undefined, digits = 0): string {
  return v == null ? '–' : v.toLocaleString('de-CH', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function BreedingValues({ ctx }: { ctx: AnimalContext }) {
  const rank = (trait: string) => {
    const i = TRAIT_ORDER.indexOf(trait)
    return i === -1 ? TRAIT_ORDER.length : i
  }
  const entries = Object.entries(ctx.breedingValues).sort(([a], [b]) => rank(a) - rank(b))
  if (!entries.length) return <p className="text-sm text-gray-400">Keine Zuchtwerte importiert.</p>
  const evalDate = entries[0][1].eval_date
  return (
    <>
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([trait, v]) => (
            <tr key={trait} className="border-b last:border-0">
              <td className="py-1 text-gray-600">{TRAIT_LABEL[trait] ?? trait}</td>
              <td className="py-1 text-right font-medium">{v.value.toLocaleString('de-CH')}</td>
              <td className="py-1 pl-3 text-right text-xs text-gray-400">{v.reliability != null ? `B ${v.reliability} %` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-gray-400">
        Zuchtwertschätzung vom {fmtDate(evalDate)}
        {entries[0][1].base ? `, Basis ${entries[0][1].base}` : ''}
      </p>
    </>
  )
}

export default function AnimalDetail({ moduleKey }: { moduleKey: string }) {
  const { id = '' } = useParams()
  const species = speciesOf(moduleKey)
  const terms = speciesTerms(moduleKey)
  const birthWord = species === 'sheep' ? 'Ablammung' : 'Abkalbung'
  const intervalWord = species === 'sheep' ? 'Zwischenlammzeit' : 'Zwischenkalbezeit'
  const db = useDb()
  const { thresholds } = useCullingThresholds(moduleKey, species)
  const { data, loading } = useQuery((pg) => loadDetail(pg, id, species), [id, species])

  if (loading && !data) return <p className="p-4 text-center text-gray-400">Lädt…</p>
  if (!data?.ctx) return <p className="p-4 text-center text-gray-500">Tier nicht gefunden.</p>

  const { ctx, inbreeding, sires, pedigreeByKey, herdIdByKey, lactations, tests, journal, certificate } = data
  const a = ctx.animal
  const f = ctx.fertility
  const p = ctx.performance
  const reasons = a.sex !== 'm' ? cullingReasons({
    species,
    fertility: f,
    performance: p,
    currentLactationScc: ctx.currentLactationScc,
    breedingValues: latestValues(ctx.breedingValues),
    lactationNumber: ctx.lactationNumber,
    recentOffspring: ctx.births.slice(-2).flatMap((b) => b.offspring),
    healthEvents12m: ctx.healthEvents12m,
    trend: ctx.trend,
  }, thresholds) : []
  const ageYears = a.birth_date ? ((Date.now() - Date.parse(a.birth_date)) / (365.25 * 86_400_000)).toFixed(1) : null
  const offspringKey = animalKey(a.ear_tag) ?? a.ear_tag
  const sccLimit = thresholds.sccHighTest
  const today = localTodayIso()
  const openUntil = (field: 'withdrawal_milk_days' | 'withdrawal_meat_days') =>
    journal
      .map((j) => withdrawalEnd(j.entry_date, num(j[field])))
      .filter((d): d is string => d != null && d >= today)
      .sort()
      .at(-1) ?? null
  const milkUntil = openUntil('withdrawal_milk_days')
  const meatUntil = openUntil('withdrawal_meat_days')

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24">
      <div>
        <Link to=".." relative="path" className="text-sm text-brand-700">
          ← Alle {terms.plural}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-800">
          {a.lauf_nr && <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-lg">{a.lauf_nr}</span>}
          {animalLabel(a)}
        </h1>
        <p className="text-sm text-gray-500">
          {a.ear_tag}
          {a.breed_code ? ` · ${a.breed_code}` : ''} · geb. {fmtDate(a.birth_date)}
          {ageYears ? ` (${ageYears} J.)` : ''} · {a.status}
        </p>
      </div>

      {(milkUntil || meatUntil) && (
        <div className="rounded-lg bg-red-600 p-3 text-sm font-semibold text-white">
          {milkUntil && <div>⚠ Milch-Absetzfrist bis {fmtDate(milkUntil)}</div>}
          {meatUntil && <div>⚠ Fleisch-Absetzfrist bis {fmtDate(meatUntil)}</div>}
        </div>
      )}

      <AnimalLocationCard moduleKey={moduleKey} animalId={a.id} active={a.status === 'aktiv'} />

      {reasons.length > 0 && (
        <Section title="Hinweise (Ausmerzliste)">
          <ReasonChips reasons={reasons} />
        </Section>
      )}

      <Section title="Kennzahlen">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Laktation" value={ctx.lactationNumber ?? '–'} />
          <Field label={`Letzte ${birthWord}`} value={f.last_birth ? `${fmtDate(f.last_birth)} (${f.days_since_birth} T.)` : '–'} />
          <Field label="Belegungen seither" value={f.last_birth ? f.services_since_birth : '–'} />
          <Field label={`Erwartete ${birthWord}`} value={fmtDate(f.expected_birth)} />
          <Field label={`Ø ${intervalWord}`} value={f.mean_interval != null ? `${Math.round(f.mean_interval)} T.` : '–'} />
          <Field label="Ø Rastzeit" value={f.mean_first_service != null ? `${Math.round(f.mean_first_service)} T.` : '–'} />
          <Field label="Belegungen je Trächtigkeit" value={round(f.services_per_conception, 1)} />
          <Field label="Lebenstagleistung" value={p?.ltl_milk != null ? `${round(p.ltl_milk, 2)} kg/Tag` : '–'} />
          <Field
            label="Leistung ggü. Gleichaltrigen"
            value={p?.performance_rel != null ? `${Math.round(p.performance_rel * 100)} %${p.performance_basis === 'Standardlaktation' ? ' (Std.-Lakt.)' : ''}` : '–'}
          />
          <Field label="Zellzahl Ø 12 Mt." value={p?.scc_geo_12m != null ? fmtCells(p.scc_geo_12m) : '–'} />
          <Field label="Index Leistung / Zellzahl" value={p ? `${round(p.idx_performance, 1)} / ${round(p.idx_scc, 1)}` : '–'} />
          <Field label="Datenbasis" value={p?.data_basis === 'duenn' ? 'dünn' : p?.data_basis ?? '–'} />
        </div>
      </Section>

      <JournalSection animalId={a.id} journal={journal} />

      <Section title="Abstammung">
        <PedigreeTree rootKey={offspringKey} pedigreeByKey={pedigreeByKey} linkFor={(k) => pedigreeLink(moduleKey, herdIdByKey, k)} />
        <InbreedingNote f={inbreeding.inbreeding(offspringKey)} completeness={inbreeding.completeness(offspringKey)} />
      </Section>

      {a.sex !== 'm' && sires.length > 0 && (
        <Section title="Anpaarung: erwartete Inzucht der Nachkommen">
          <ul className="divide-y text-sm">
            {sires.slice(0, 8).map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 break-words">
                  {sireLabel(s)}
                  {s.lastUsed && <span className="ml-1 text-xs text-gray-400">zuletzt {fmtDate(s.lastUsed)}</span>}
                </span>
                <InbreedingBadge f={inbreeding.offspring(offspringKey, s.key)} />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-400">
            Verwandtschaft aus dem bekannten Stammbaum; unbekannte Vorfahren gelten als unverwandt. Mehr im{' '}
            <Link to="../../anpaarung" relative="path" className="text-brand-700">
              Anpaarungsplaner
            </Link>
            .
          </p>
        </Section>
      )}

      <Section title="Zuchtwerte">
        <BreedingValues ctx={ctx} />
      </Section>

      {certificate && hasCertificateDetails(certificate) && (
        <Section title="Leistungsausweis">
          <CertificateDetailsView details={certificate} />
        </Section>
      )}

      {tests.length > 0 && (
        <Section title="Milchproben">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tests} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tickFormatter={(d: string) => `${d.slice(5, 7)}.${d.slice(2, 4)}`} fontSize={10} />
                <YAxis yAxisId="milk" fontSize={10} />
                <YAxis yAxisId="scc" orientation="right" scale="log" domain={['auto', 'auto']} allowDataOverflow fontSize={10} />
                <Tooltip labelFormatter={(d) => fmtDate(String(d))} />
                <ReferenceLine yAxisId="scc" y={sccLimit} stroke="#d97706" strokeDasharray="4 4" />
                <Line yAxisId="milk" type="monotone" dataKey="milk" name="kg Milch" stroke="#2563eb" dot={false} />
                <Line yAxisId="scc" type="monotone" dataKey="scc" name="Zellzahl (1000)" stroke="#d97706" dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Blau kg Milch (links), orange Zellzahl in 1000/ml (rechts, logarithmisch), gestrichelt die Grenze{' '}
            {fmtCells(sccLimit)} Zellen.
          </p>
        </Section>
      )}

      <Section title={`${birthWord}en`}>
        {ctx.births.length === 0 ? (
          <p className="text-sm text-gray-400">Keine erfasst.</p>
        ) : (
          <ul className="divide-y text-sm">
            {[...ctx.births].reverse().map((b) => {
              const cycle = f.cycles.find((c) => c.next_birth_date === b.birth_date)
              return (
                <li key={b.id} className="py-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {fmtDate(b.birth_date)}
                      {b.parity ? ` · ${b.parity}. ${birthWord}` : ''}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      {cycle?.interval_days != null ? `${intervalWord} ${cycle.interval_days} T.` : ''}
                      {b.source === 'manual' && (
                        <DeleteButton
                          onConfirm={async () => {
                            for (const o of b.offspring) await softDeleteRow(db, 'birth_offspring', o.id)
                            await softDeleteRow(db, 'births', b.id)
                          }}
                        />
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">
                    Vater {b.sire_name ?? pedigreeByKey.get(b.sire_key ?? '')?.name ?? b.sire_ear_tag ?? 'unbekannt'} ·{' '}
                    {b.offspring
                      .map((o) => `${o.sex === 'w' ? '♀' : o.sex === 'm' ? '♂' : '?'}${o.stillborn || o.died_24h ? '†' : ''}${o.ear_tag ? ` ${shortEarTag(o.ear_tag)}` : ''}`)
                      .join(', ')}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Belegungen">
        {ctx.matings.length === 0 ? (
          <p className="text-sm text-gray-400">Keine erfasst.</p>
        ) : (
          <ul className="divide-y text-sm">
            {[...ctx.matings].reverse().map((m) => (
              <li key={m.id} className="flex justify-between gap-2 py-1.5">
                <span>
                  {fmtDate(m.service_date)}
                  {m.service_to ? ` – ${fmtDate(m.service_to)}` : ''}
                </span>
                <span className="flex items-center gap-1 text-right text-xs text-gray-600">
                  {m.kind === 'kb' ? 'KB' : m.kind === 'natursprung' ? 'Natursprung' : ''} · {m.sire_name ?? m.sire_ear_tag ?? '?'}
                  {m.source === 'manual' && <DeleteButton onConfirm={() => softDeleteRow(db, 'matings', m.id)} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Laktationen">
        {lactations.length === 0 ? (
          <p className="text-sm text-gray-400">Keine erfasst.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1">Nr.</th>
                <th className="py-1">{birthWord}</th>
                <th className="py-1 text-right">Tage</th>
                <th className="py-1 text-right">kg Milch</th>
                <th className="py-1 text-right">Fett %</th>
                <th className="py-1 text-right">Eiw. %</th>
              </tr>
            </thead>
            <tbody>
              {lactations.map((l) => (
                <tr key={l.lactation_id} className="border-t">
                  <td className="py-1">
                    {l.lactation_number}
                    {l.closure_type >= 8 ? ' (läuft)' : ''}
                  </td>
                  <td className="py-1">{fmtDate(isoDate(l.calving_date))}</td>
                  <td className="py-1 text-right">{l.days_in_milk ?? '–'}</td>
                  <td className="py-1 text-right">{round(num(l.milk_kg))}</td>
                  <td className="py-1 text-right">{round(num(l.fat_pct), 2)}</td>
                  <td className="py-1 text-right">{round(num(l.protein_pct), 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

    </div>
  )
}

/** Löschen mit Rückfrage — nur für in FMIS erfasste Einträge; importierte
 * kämen mit dem nächsten Herdebuch-Export ohnehin wieder. Bei einer Geburt
 * bleiben die angelegten Jungtiere im Bestand. */
function DeleteButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false)
  return confirm ? (
    <button type="button" onClick={() => void onConfirm().then(() => setConfirm(false))} className="rounded bg-red-600 px-2 py-0.5 text-xs text-white">
      Wirklich löschen?
    </button>
  ) : (
    <button type="button" onClick={() => setConfirm(true)} className="px-1 text-base leading-none text-gray-400" aria-label="löschen">
      ×
    </button>
  )
}

function JournalSection({ animalId, journal }: { animalId: string; journal: AnimalJournalEntry[] }) {
  const db = useDb()
  const [open, setOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  return (
    <Section title="Journal">
      {open ? (
        <div className="mb-3 rounded-lg border border-gray-200 p-3">
          <JournalForm animalIds={[animalId]} onSaved={() => setOpen(false)} />
          <button type="button" onClick={() => setOpen(false)} className="mt-2 w-full text-sm text-gray-500">
            Abbrechen
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mb-2 w-full rounded-lg border border-dashed border-brand-300 py-2.5 text-sm font-medium text-brand-700">
          ＋ Beobachtung / Behandlung erfassen
        </button>
      )}
      {journal.length === 0 ? (
        <p className="text-sm text-gray-400">Keine Einträge.</p>
      ) : (
        <ul className="divide-y text-sm">
          {journal.map((j) => {
            const milk = withdrawalEnd(j.entry_date, num(j.withdrawal_milk_days))
            const meat = withdrawalEnd(j.entry_date, num(j.withdrawal_meat_days))
            return (
              <li key={j.id} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs text-gray-500">
                      {fmtDate(j.entry_date)} · {categoryIcon(j.category)} {categoryLabel(j.category)}
                    </span>
                    <div className="break-words text-gray-800">{j.text}</div>
                    {(() => {
                      // Ohne eigene Bemerkung steht die Zusammenfassung schon als Text da.
                      const own = j.text !== journalSummary(j)
                      const details = [
                        own && j.diagnosis,
                        own && [j.medication, j.dose].filter(Boolean).join(' '),
                        j.administered_by && `durch ${j.administered_by}`,
                      ].filter(Boolean)
                      return details.length > 0 && <div className="text-xs text-gray-600">{details.join(' · ')}</div>
                    })()}
                    {(milk || meat) && (
                      <div className="text-xs text-red-700">
                        Absetzfrist {milk ? `Milch bis ${fmtDate(milk)}` : ''}
                        {milk && meat ? ', ' : ''}
                        {meat ? `Fleisch bis ${fmtDate(meat)}` : ''}
                      </div>
                    )}
                  </div>
                  {j.source === 'manual' &&
                    (confirmId === j.id ? (
                      <button
                        type="button"
                        onClick={() => void softDeleteRow(db, 'animal_journal', j.id).then(() => setConfirmId(null))}
                        className="shrink-0 rounded bg-red-600 px-2 py-1 text-xs text-white"
                      >
                        Wirklich löschen?
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(j.id)} className="shrink-0 px-1 text-gray-400" aria-label="löschen">
                        ×
                      </button>
                    ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
