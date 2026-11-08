import AnimalLocationCard from '@fmis/core/AnimalLocationCard'
import PhotoThumbs from '../components/PhotoThumbs'
import { loadPhotos, uploadPendingPhotos, type JournalPhoto } from '../lib/photos'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { notifyError, errorText } from '@fmis/core/toast'
import { inTransaction } from '../db/transaction'
import { useHasPermission } from '@fmis/core/AuthContext'
import { softDeleteRow } from '../db/write'
import JournalForm from '../components/JournalForm'
import { canChangeEntry, categoryIcon, categoryLabel, groupCases, journalSummary, supersededBy } from '../lib/journal'
import { withdrawalUntil } from '../lib/treatments'
import { examSummary, loadClawExams, worstMh } from '../lib/clawHealth'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useQuery } from '../hooks/useQuery'
import { useJumpTo } from '../hooks/useJumpTo'
import { cullingInput, loadHerdContext, type AnimalContext } from '../lib/herdContext'
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
  const [pedigreeData, lactations, tests, journal, sires, certificate, claws] = await Promise.all([
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
    loadClawExams(pg),
  ])
  return {
    claws: claws.filter((e) => e.animal_id === id),
    ctx,
    ...pedigreeData,
    sires,
    certificate,
    lactations: lactations.rows,
    tests: tests.rows.map((t) => ({ date: isoDate(t.test_date)!, milk: num(t.milk_kg), scc: num(t.cell_count) })),
    journal: journal.rows.map((j) => ({
      ...j,
      entry_date: isoDate(j.entry_date)!,
      last_date: isoDate(j.last_date),
      release_milk_date: isoDate(j.release_milk_date),
      release_meat_date: isoDate(j.release_meat_date),
      withdrawal_milk_days: num(j.withdrawal_milk_days),
      withdrawal_meat_days: num(j.withdrawal_meat_days),
      withdrawal_factor: num(j.withdrawal_factor),
    })),
  }
}

/** «‹ Zurück» zur vorigen Seite der App (Tier-Info, Merkliste, Durchgang …); ohne
 * Vorgeschichte (direkt geöffnet) zur Tierliste. */
function BackLink({ allLabel }: { allLabel: string }) {
  const navigate = useNavigate()
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  if (canGoBack)
    return (
      <button type="button" onClick={() => navigate(-1)} className="link-btn text-sm text-brand-700">
        ‹ Zurück
      </button>
    )
  return (
    <Link to=".." relative="path" className="link-btn text-sm text-brand-700">
      {allLabel}
    </Link>
  )
}

/** Sprungleiste zu den Abschnitten, angeheftet unter der Kopfzeile. */
function JumpBar({ items }: { items: [string, string][] }) {
  return (
    <nav aria-label="Abschnitte" className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-10 -mx-4 overflow-x-auto bg-gray-50/95 px-4 py-1 backdrop-blur print:hidden">
      <div className="flex gap-1.5">
        {items.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="flex min-h-11 shrink-0 items-center rounded-full border border-gray-300 bg-white px-3 text-sm text-gray-800 active:bg-gray-100">
            {label}
          </a>
        ))}
      </div>
    </nav>
  )
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32 rounded-lg bg-white p-4 shadow-sm">
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
  if (!entries.length) return <p className="text-sm text-gray-500">Keine Zuchtwerte importiert.</p>
  const evalDate = entries[0][1].eval_date
  return (
    <>
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([trait, v]) => (
            <tr key={trait} className="border-b last:border-0">
              <td className="py-1 text-gray-600">{TRAIT_LABEL[trait] ?? trait}</td>
              <td className="py-1 text-right font-medium">{v.value.toLocaleString('de-CH')}</td>
              <td className="py-1 pl-3 text-right text-xs text-gray-500">{v.reliability != null ? `B ${v.reliability} %` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-gray-500">
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
  const { data: clawPhotos } = useQuery((pg) => loadPhotos(pg, id), [id])
  useJumpTo(!!data)

  if (loading && !data) return <p className="p-4 text-center text-gray-500">Lädt…</p>
  if (!data?.ctx) return <p className="p-4 text-center text-gray-500">Tier nicht gefunden.</p>

  const { ctx, inbreeding, sires, pedigreeByKey, herdIdByKey, lactations, tests, journal, certificate, claws } = data
  const a = ctx.animal
  const f = ctx.fertility
  const p = ctx.performance
  const reasons = a.sex !== 'm' ? cullingReasons(cullingInput(ctx, species), thresholds) : []
  const ageYears = a.birth_date ? ((Date.now() - Date.parse(a.birth_date)) / (365.25 * 86_400_000)).toFixed(1) : null
  const offspringKey = animalKey(a.ear_tag) ?? a.ear_tag
  const sccLimit = thresholds.sccHighTest
  const today = localTodayIso()
  const openUntil = (kind: 'milk' | 'meat') =>
    journal
      .map((j) => withdrawalUntil(j, kind))
      .filter((d): d is string => d != null && d >= today)
      .sort()
      .at(-1) ?? null
  const milkUntil = openUntil('milk')
  const meatUntil = openUntil('meat')

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24">
      <div>
        <BackLink allLabel={`← Alle ${terms.plural}`} />
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

      {/* Erfassen für dieses Tier (Tier vorgewählt) */}
      {a.status === 'aktiv' && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {[
            ['journal', '💉 Behandlung / Beobachtung'],
            ...(a.sex !== 'm' ? [['belegung', `❤️ ${species === 'sheep' ? 'Belegung' : 'Besamung'}`], ['geburt', `${species === 'sheep' ? '🐑' : '🐄'} ${birthWord}`]] : []),
            ['tierinfo', '🔎 Tier-Info · Merkliste'],
          ].map(([to, text]) => (
            <Link key={to} to={`/${moduleKey}/${to}?tier=${a.id}`} className="flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 shadow-sm active:bg-gray-50">
              {text}
            </Link>
          ))}
        </div>
      )}

      <JumpBar
        items={[
          ['journal', 'Journal'],
          ['geburten', `${birthWord}en`],
          ['belegungen', 'Belegungen'],
          ['abstammung', 'Abstammung'],
          ['milchproben', 'Milchproben'],
          ...(claws.length > 0 ? [['klauen', 'Klauen'] as [string, string]] : []),
          ['kennzahlen', 'Kennzahlen'],
          ['zuchtwerte', 'Zuchtwerte'],
          ['laktationen', 'Laktationen'],
        ]}
      />

      {(milkUntil || meatUntil) && (
        <div className="rounded-lg bg-red-600 p-3 text-sm font-semibold text-white">
          {milkUntil && <div>⚠ Milch-Absetzfrist bis {fmtDate(milkUntil)}</div>}
          {meatUntil && <div>⚠ Fleisch-Absetzfrist bis {fmtDate(meatUntil)}</div>}
        </div>
      )}

      <AnimalLocationCard moduleKey={moduleKey} animalId={a.id} active={a.status === 'aktiv'} />

      {reasons.length > 0 && (
        <Section title="Hinweise (Ausmerzliste)" id="hinweise">
          <ReasonChips reasons={reasons} />
        </Section>
      )}

      <Section title="Kennzahlen" id="kennzahlen">
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
          {p?.ltl_cycle_rel != null && (
            <Field label="… stadienunabhängig (bis letzte Abkalbung)" value={`${Math.round(p.ltl_cycle_rel * 100)} %`} />
          )}
          <Field label="Zellzahl Ø 12 Mt." value={p?.scc_geo_12m != null ? fmtCells(p.scc_geo_12m) : '–'} />
          <Field label="Index Leistung / Zellzahl" value={p ? `${round(p.idx_performance, 1)} / ${round(p.idx_scc, 1)}` : '–'} />
          <Field label="Datenbasis" value={p?.data_basis === 'duenn' ? 'dünn' : p?.data_basis ?? '–'} />
        </div>
      </Section>

      <JournalSection animalId={a.id} journal={journal} />

      {claws.length > 0 && (
        <Section title="Klauen" id="klauen">
          <ul className="divide-y text-sm">
            {claws.map((e) => (
              <li key={e.id} className="flex gap-3 py-1.5">
                <span className="w-20 shrink-0 text-gray-500">{fmtDate(e.exam_date)}</span>
                <span className={`min-w-0 flex-1 ${(worstMh(e) ?? 0) >= 3 ? 'font-semibold text-red-700' : 'text-gray-800'}`}>
                  {examSummary(e, species)}
                  {e.examiner ? <span className="text-gray-500"> · {e.examiner}</span> : null}
                  {e.notes ? <span className="block text-xs text-gray-600">{e.notes}</span> : null}
                  <PhotoThumbs moduleKey={moduleKey} photos={(clawPhotos ?? []).filter((p) => p.claw_exam_id === e.id)} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Abstammung" id="abstammung">
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
                  {s.lastUsed && <span className="ml-1 text-xs text-gray-500">zuletzt {fmtDate(s.lastUsed)}</span>}
                </span>
                <InbreedingBadge f={inbreeding.offspring(offspringKey, s.key)} />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-500">
            Verwandtschaft aus dem bekannten Stammbaum; unbekannte Vorfahren gelten als unverwandt. Mehr im{' '}
            <Link to="../../anpaarung" relative="path" className="text-brand-700">
              Anpaarungsplaner
            </Link>
            .
          </p>
        </Section>
      )}

      <Section title="Zuchtwerte" id="zuchtwerte">
        <BreedingValues ctx={ctx} />
      </Section>

      {certificate && hasCertificateDetails(certificate) && (
        <Section title="Leistungsausweis">
          <CertificateDetailsView details={certificate} />
        </Section>
      )}

      {tests.length > 0 && (
        <Section title="Milchproben" id="milchproben">
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
          <p className="mt-1 text-xs text-gray-500">
            Blau kg Milch (links), orange Zellzahl in 1000/ml (rechts, logarithmisch), gestrichelt die Grenze{' '}
            {fmtCells(sccLimit)} Zellen.
          </p>
        </Section>
      )}

      <Section title={`${birthWord}en`} id="geburten">
        {ctx.births.length === 0 ? (
          <p className="text-sm text-gray-500">Keine erfasst.</p>
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
                          onConfirm={() =>
                            // ganz oder gar nicht: nie Nachkommen ohne Geburt (oder umgekehrt)
                            inTransaction(db, async (tx) => {
                              for (const o of b.offspring) await softDeleteRow(tx, 'birth_offspring', o.id)
                              await softDeleteRow(tx, 'births', b.id)
                            })
                          }
                        />
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">
                    Vater{' '}
                    {b.sire_key ? (
                      <Link to={pedigreeLink(moduleKey, herdIdByKey, b.sire_key)} className="link-btn text-brand-700">
                        {b.sire_name ?? pedigreeByKey.get(b.sire_key)?.name ?? b.sire_ear_tag ?? shortEarTag(b.sire_key)}
                      </Link>
                    ) : (
                      (b.sire_name ?? b.sire_ear_tag ?? 'unbekannt')
                    )}{' '}
                    ·{' '}
                    {b.offspring.map((o, i) => {
                      const dead = o.stillborn || o.died_24h || o.died_on
                      const text = `${o.sex === 'w' ? '♀' : o.sex === 'm' ? '♂' : '?'}${dead ? '†' : ''}${o.ear_tag ? ` ${shortEarTag(o.ear_tag)}` : dead ? '' : ' 🏷️ offen'}`
                      const key = o.ear_tag ? animalKey(o.ear_tag) : null
                      return (
                        <span key={o.id}>
                          {i > 0 && ', '}
                          {key ? (
                            <Link to={pedigreeLink(moduleKey, herdIdByKey, key)} className="link-btn text-brand-700">
                              {text}
                            </Link>
                          ) : (
                            text
                          )}
                        </span>
                      )
                    })}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Belegungen" id="belegungen">
        {ctx.matings.length === 0 ? (
          <p className="text-sm text-gray-500">Keine erfasst.</p>
        ) : (
          <ul className="divide-y text-sm">
            {[...ctx.matings].reverse().map((m) => (
              <li key={m.id} className="flex justify-between gap-2 py-1.5">
                <span>
                  {fmtDate(m.service_date)}
                  {m.service_to ? ` – ${fmtDate(m.service_to)}` : ''}
                </span>
                <span className="flex items-center gap-1 text-right text-xs text-gray-600">
                  {m.kind === 'kb' ? 'KB' : m.kind === 'natursprung' ? 'Natursprung' : ''} ·{' '}
                  {m.sire_key ? (
                    <Link to={pedigreeLink(moduleKey, herdIdByKey, m.sire_key)} className="link-btn text-brand-700">
                      {m.sire_name ?? m.sire_ear_tag ?? shortEarTag(m.sire_key)}
                    </Link>
                  ) : (
                    (m.sire_name ?? m.sire_ear_tag ?? '?')
                  )}
                  {m.source === 'manual' && <DeleteButton onConfirm={() => softDeleteRow(db, 'matings', m.id)} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Laktationen" id="laktationen">
        {lactations.length === 0 ? (
          <p className="text-sm text-gray-500">Keine erfasst.</p>
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
        {(lactations.length > 0 || tests.length > 0) && (
          <Link to={`/${moduleKey}/leistung?tier=${a.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 print:hidden">
            🥛 Leistung mit Laktationskurven →
          </Link>
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
  const [busy, setBusy] = useState(false)
  return confirm ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        onConfirm()
          .then(() => setConfirm(false))
          .catch((e) => notifyError(`Nicht gelöscht: ${errorText(e)}`))
          .finally(() => setBusy(false))
      }}
      className="min-h-11 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
    >
      Wirklich löschen?
    </button>
  ) : (
    <button type="button" onClick={() => setConfirm(true)} className="grid h-11 w-11 place-items-center text-lg leading-none text-gray-600" aria-label="löschen">
      ×
    </button>
  )
}

/** Ein Journaleintrag. Korrigierte Einträge bleiben stehen (gedämpft, mit Verweis),
 * die Korrektur ist ein eigener Eintrag. */
function JournalEntryRow({
  j,
  correctedBy,
  corrects,
  canCorrect,
  canDelete,
  onCorrect,
  onDelete,
  photos,
}: {
  j: AnimalJournalEntry
  correctedBy: AnimalJournalEntry | undefined
  corrects: AnimalJournalEntry | undefined
  canCorrect: boolean
  canDelete: boolean
  onCorrect: () => void
  onDelete: () => Promise<void>
  photos?: ReactNode
}) {
  const milk = correctedBy ? null : withdrawalUntil(j, 'milk')
  const meat = correctedBy ? null : withdrawalUntil(j, 'meat')
  return (
    <li className={`py-2 ${correctedBy ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-gray-500">
            {fmtDate(j.entry_date)}
            {j.treatment_time ? ` ${j.treatment_time}` : ''} · {categoryIcon(j.category)} {categoryLabel(j.category)}
            {j.source === 'import' ? ' · cownect' : ''}
          </span>
          {correctedBy && <span className="ml-1 rounded bg-gray-200 px-1 text-xs text-gray-700">korrigiert am {fmtDate(correctedBy.entry_date)}</span>}
          {corrects && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-900">Korrektur zum Eintrag vom {fmtDate(corrects.entry_date)}</span>}
          <div className={`break-words text-gray-800 ${correctedBy ? 'line-through' : ''}`}>{j.text}</div>
          {(() => {
            // Ohne eigene Bemerkung steht die Zusammenfassung schon als Text da.
            const own = j.text !== journalSummary(j)
            const details = [
              own && j.diagnosis,
              own && [j.medication, j.dose].filter(Boolean).join(' '),
              j.applications && j.applications > 1 && `${j.applications}×${j.last_date ? ` bis ${fmtDate(j.last_date)}` : ''}`,
              j.administered_by && `durch ${j.administered_by}`,
              j.supplier && `Abgabe ${j.supplier}`,
            ].filter(Boolean)
            return details.length > 0 && <div className="text-xs text-gray-600">{details.join(' · ')}</div>
          })()}
          {photos}
          {(milk || meat) && (
            <div className="text-xs text-red-700">
              Absetzfrist {milk ? `Milch bis ${fmtDate(milk)}` : ''}
              {milk && meat ? ', ' : ''}
              {meat ? `Fleisch bis ${fmtDate(meat)}` : ''}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canCorrect && !correctedBy && (
            <button type="button" onClick={onCorrect} className="link-btn rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700">
              Korrigieren
            </button>
          )}
          {canDelete && <DeleteButton onConfirm={onDelete} />}
        </div>
      </div>
    </li>
  )
}

type JournalMode = { kind: 'new' } | { kind: 'case'; caseId: string } | { kind: 'correct'; entry: AnimalJournalEntry }

/** Journal des Tiers: ein Fall = alle Einträge mit gleicher case_id (Befund,
 * Folgebehandlungen, Verlauf), älteste zuerst. Das Journal wird nur ergänzt:
 * Korrekturen und Folgeeinträge sind neue Einträge. Löschen nur kurz nach dem
 * Eintrag (ausser mit Recht «Korrektur»). */
function JournalSection({ animalId, journal }: { animalId: string; journal: AnimalJournalEntry[] }) {
  const db = useDb()
  const canCorrectLater = useHasPermission('core:korrektur:write')
  const [mode, setMode] = useState<JournalMode | null>(null)
  const done = () => setMode(null)
  const byId = useMemo(() => new Map(journal.map((j) => [j.id, j])), [journal])
  const superseded = useMemo(() => supersededBy(journal), [journal])
  const cases = useMemo(() => groupCases(journal), [journal])
  const moduleKey = useLocation().pathname.split('/')[1] ?? ''
  const { data: photos } = useQuery((pg) => loadPhotos(pg, animalId), [animalId])
  const photosByEntry = useMemo(() => {
    const m = new Map<string, JournalPhoto[]>()
    for (const p of photos ?? []) if (p.journal_id) m.set(p.journal_id, [...(m.get(p.journal_id) ?? []), p])
    return m
  }, [photos])
  // Fotos, die auf diesem Gerät noch warten, beim Öffnen nachschieben
  useEffect(() => void uploadPendingPhotos(), [])
  const now = Date.now()
  const form = mode && (
    <div className="mb-3 rounded-lg border border-gray-200 p-3">
      <JournalForm
        key={mode.kind === 'correct' ? mode.entry.id : mode.kind === 'case' ? mode.caseId : 'new'}
        animalIds={[animalId]}
        onSaved={done}
        caseId={mode.kind === 'case' ? mode.caseId : undefined}
        corrects={mode.kind === 'correct' ? mode.entry : undefined}
      />
      <button type="button" onClick={done} className="mt-2 w-full text-sm text-gray-500">
        Abbrechen
      </button>
    </div>
  )
  const row = (j: AnimalJournalEntry) => (
    <JournalEntryRow
      key={j.id}
      j={j}
      correctedBy={superseded.get(j.id)}
      corrects={j.corrects_id ? byId.get(j.corrects_id) : undefined}
      canCorrect={j.source === 'manual'}
      canDelete={canChangeEntry(j, canCorrectLater, now)}
      onCorrect={() => setMode({ kind: 'correct', entry: j })}
      onDelete={() => softDeleteRow(db, 'animal_journal', j.id)}
      photos={photosByEntry.has(j.id) ? <PhotoThumbs moduleKey={moduleKey} photos={photosByEntry.get(j.id)!} /> : undefined}
    />
  )
  return (
    <Section title="Journal" id="journal">
      {form ?? (
        <button type="button" onClick={() => setMode({ kind: 'new' })} className="mb-2 w-full rounded-lg border border-dashed border-brand-300 py-2.5 text-sm font-medium text-brand-700">
          ＋ Beobachtung / Behandlung erfassen
        </button>
      )}
      {journal.length === 0 ? (
        <p className="text-sm text-gray-500">Keine Einträge.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {cases.map((c) =>
            c.isCase ? (
              <li key={c.key} className="rounded-lg border border-gray-200 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Fall seit {fmtDate(c.startDate)} · {c.entries.length} {c.entries.length === 1 ? 'Eintrag' : 'Einträge'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode({ kind: 'case', caseId: c.entries[0].case_id! })}
                    className="link-btn shrink-0 rounded border border-brand-300 px-2 py-0.5 text-xs font-medium text-brand-700"
                  >
                    ＋ Folgeeintrag
                  </button>
                </div>
                <ul className="divide-y">{c.entries.map(row)}</ul>
              </li>
            ) : (
              <li key={c.key} className="rounded-lg border border-gray-100 px-2">
                <ul>{c.entries.map(row)}</ul>
              </li>
            ),
          )}
        </ul>
      )}
    </Section>
  )
}
