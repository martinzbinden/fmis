import { useParams, Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useQuery } from '../hooks/useQuery'
import { fmtKg, fmtChf, fmtDate, fmtAge, num, todayIso } from '../lib/format'
import { computeForecast } from '../lib/forecast'
import type { Animal, Weighing, Medication, SlaughterResult, AnimalGroup } from '../types'

interface Detail {
  animal: Animal
  weighings: Weighing[]
  medications: Medication[]
  slaughter: SlaughterResult | null
  group: AnimalGroup | null
}

function loadDetail(id: string) {
  return async (pg: PGlite): Promise<Detail | null> => {
    const { rows: animalRows } = await pg.query<Animal>(
      'select * from animals where id = $1 and deleted_at is null',
      [id],
    )
    if (animalRows.length === 0) return null

    const { rows: weighings } = await pg.query<Weighing>(
      'select * from weighings where animal_id = $1 and deleted_at is null order by date asc, updated_at asc',
      [id],
    )
    const { rows: medications } = await pg.query<Medication>(
      'select * from medications where animal_id = $1 and deleted_at is null order by date desc',
      [id],
    )
    const { rows: slaughterRows } = await pg.query<SlaughterResult>(
      'select * from slaughter_results where animal_id = $1 and deleted_at is null',
      [id],
    )
    const { rows: groupRows } = await pg.query<AnimalGroup>(
      `select g.* from animal_groups g
       join group_memberships gm on gm.group_id = g.id
       where gm.animal_id = $1 and gm.deleted_at is null and gm.end_date is null and g.deleted_at is null
       order by gm.start_date desc limit 1`,
      [id],
    )

    return {
      animal: animalRows[0],
      weighings,
      medications,
      slaughter: slaughterRows[0] ?? null,
      group: groupRows[0] ?? null,
    }
  }
}

export default function AnimalDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, loading } = useQuery(loadDetail(id!), [id])

  if (loading && !data) return <div className="p-4 text-center text-gray-400">Lädt…</div>
  if (!data) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Tier nicht gefunden.</p>
        <Link to="/tiere" className="mt-2 inline-block text-brand-700 underline">
          Zurück zur Liste
        </Link>
      </div>
    )
  }

  const { animal, weighings, medications, slaughter, group } = data
  const today = todayIso()

  const chartData = weighings.map((w) => ({ date: w.date, weight: num(w.weight_kg) }))
  const last = weighings.at(-1)
  const prev = weighings.length >= 2 ? weighings.at(-2) : undefined
  const withdrawalUntil = medications.length
    ? medications
        .map((m) => {
          const d = new Date(m.date)
          d.setDate(d.getDate() + m.withdrawal_days)
          return d.toISOString().slice(0, 10)
        })
        .sort()
        .at(-1)!
    : null

  const forecast = computeForecast({
    lastWeighDate: last?.date ?? null,
    lastWeight: last ? num(last.weight_kg) : null,
    prevWeighDate: prev?.date ?? null,
    prevWeight: prev ? num(prev.weight_kg) : null,
    targetMinKg: num(group?.target_weight_min_kg) ?? 45,
    targetMaxKg: num(group?.target_weight_max_kg) ?? 50,
    withdrawalUntil,
    today,
  })

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <div>
        <Link to="/tiere" className="text-sm text-brand-700">
          ← Alle Tiere
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-800">{animal.ear_tag}</h1>
      </div>

      {forecast.withdrawalOpen && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          ⚠️ Absetzfrist offen bis <strong>{fmtDate(withdrawalUntil)}</strong> — nicht schlachtreif.
        </div>
      )}

      <section className="grid grid-cols-2 gap-3">
        <InfoTile label="Status" value={animal.status} />
        <InfoTile label="Geschlecht" value={{ m: 'männlich', w: 'weiblich', k: 'kastriert' }[animal.sex]} />
        <InfoTile label="Alter" value={fmtAge(animal.birth_date)} />
        <InfoTile label="Geburtsdatum" value={fmtDate(animal.birth_date)} />
        <InfoTile label="Gruppe" value={group?.name ?? '–'} />
        <InfoTile label="Aktuelles Gewicht" value={last ? fmtKg(num(last.weight_kg)) : '–'} />
      </section>

      {!slaughter && (
        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-gray-600">Prognose</h2>
          <p className="text-gray-800">{forecast.reason}</p>
          {forecast.forecastDate && (
            <p className="text-sm text-gray-500">
              Voraussichtliches Zielgewicht am {fmtDate(forecast.forecastDate)}
            </p>
          )}
          {forecast.adgKgPerDay != null && (
            <p className="text-sm text-gray-500">
              Tageszunahme: {Math.round(forecast.adgKgPerDay * 1000)} g/Tag
            </p>
          )}
        </section>
      )}

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Gewichtsverlauf</h2>
        {chartData.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Wägungen erfasst.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => fmtDate(d)} />
                <YAxis tick={{ fontSize: 11 }} domain={['dataMin - 3', 'dataMax + 3']} />
                <Tooltip
                  labelFormatter={(d) => fmtDate(String(d))}
                  formatter={(v) => [`${v} kg`, 'Gewicht']}
                />
                {group && (
                  <ReferenceLine y={num(group.target_weight_min_kg) ?? 45} stroke="#16a34a" strokeDasharray="4 4" />
                )}
                <Line type="monotone" dataKey="weight" stroke="#15803d" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Medikamente</h2>
        {medications.length === 0 ? (
          <p className="text-sm text-gray-400">Keine Einträge.</p>
        ) : (
          <ul className="divide-y">
            {medications.map((m) => {
              const until = new Date(m.date)
              until.setDate(until.getDate() + m.withdrawal_days)
              const untilIso = until.toISOString().slice(0, 10)
              const open = untilIso >= today
              return (
                <li key={m.id} className="py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-800">{m.medication_name}</span>
                    <span className="text-gray-500">{fmtDate(m.date)}</span>
                  </div>
                  <div className="text-gray-500">
                    {m.reason ?? ''} {m.dose ? `· ${m.dose}` : ''}
                  </div>
                  <div className={open ? 'text-red-600' : 'text-gray-400'}>
                    Absetzfrist bis {fmtDate(untilIso)} {open ? '(offen)' : '(abgelaufen)'}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Schlachtresultat</h2>
        {!slaughter ? (
          <p className="text-sm text-gray-400">Noch nicht geschlachtet.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Row label="Datum" value={fmtDate(slaughter.slaughter_date)} />
            <Row label="Schlachtbetrieb" value={slaughter.slaughterhouse ?? '–'} />
            <Row label="Schlachtgewicht" value={fmtKg(num(slaughter.carcass_weight_kg))} />
            <Row label="Klassifizierung" value={slaughter.classification ?? '–'} />
            <Row label="Fettklasse" value={slaughter.fat_class ?? '–'} />
            <Row label="Preis/kg" value={fmtChf(num(slaughter.price_per_kg))} />
            <Row label="Erlös" value={fmtChf(num(slaughter.total_revenue))} />
          </dl>
        )}
      </section>
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium text-gray-800">{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-800">{value}</dd>
    </>
  )
}
