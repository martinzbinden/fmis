import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { fmtChf, fmtDate, num, todayIso } from '../lib/format'
import { shortEarTag } from '@fmis/core/earTag'
import {
  LA_DEDUCTION_FROM_LG,
  LA_MAX_LG,
  directValue,
  estimateCarcassKg,
  formatGrade,
  marketValue,
  parseGrade,
  type DirectMarketingSettings,
  type MarketPrices,
} from '../lib/marketing'
import { loadMarketing, type MarketingData } from '../lib/marketingData'

interface ActiveAnimal {
  id: string
  ear_tag: string
  birth_date: string | null
  weight_kg: string | null
  weigh_date: string | null
  target_min: string | null
  target_max: string | null
}

interface PageData {
  marketing: MarketingData
  animals: ActiveAnimal[]
}

async function loadPage(pg: PGlite): Promise<PageData> {
  const marketing = await loadMarketing(pg)
  const { rows: animals } = await pg.query<ActiveAnimal>(`
    select a.id, a.ear_tag, a.birth_date, w.weight_kg, w.date as weigh_date,
           g.target_weight_min_kg as target_min, g.target_weight_max_kg as target_max
    from animals a
    left join lateral (
      select weight_kg, date from weighings
      where animal_id = a.id and deleted_at is null
      order by date desc limit 1
    ) w on true
    left join lateral (
      select gm.group_id from group_memberships gm
      where gm.animal_id = a.id and gm.deleted_at is null and gm.end_date is null
      order by gm.start_date desc limit 1
    ) cur on true
    left join animal_groups g on g.id = cur.group_id and g.deleted_at is null
    where a.deleted_at is null and a.status = 'aktiv'
    order by a.ear_tag
  `)
  return { marketing, animals }
}

// Ab 421 Tagen ist ein Tier kein Lamm mehr (Proviande: Schafe SM).
const LAMB_MAX_DAYS = 420

function ageDays(birth: string | null, at: string): number | null {
  if (!birth) return null
  return Math.floor((new Date(at).getTime() - new Date(birth).getTime()) / 86_400_000)
}

export default function Vermarktung() {
  const { data, loading } = useQuery(loadPage)
  // Der Betrieb schätzt seine Tiere im Mittel auf T3+.
  const [gradeText, setGradeText] = useState('T3+')
  const [editPrices, setEditPrices] = useState(false)
  const [editDirect, setEditDirect] = useState(false)
  const grade = parseGrade(gradeText)

  const rows = useMemo(() => {
    if (!data) return []
    const today = todayIso()
    return data.animals.map((a) => {
      const live = num(a.weight_kg)
      const age = ageDays(a.birth_date, today)
      const adult = age != null && age > LAMB_MAX_DAYS
      if (live == null) return { a, live, age, adult, carcass: null, market: null, direct: null }
      const carcass = estimateCarcassKg(live, grade)
      return {
        a,
        live,
        age,
        adult,
        carcass,
        market: marketValue(carcass, grade, data.marketing.prices, adult),
        direct: directValue(carcass, data.marketing.direct),
      }
    })
  }, [data, grade])

  if (loading && !data) return <div className="p-4 text-center text-gray-400">Lädt…</div>
  if (!data) return null
  const { prices, direct } = data.marketing

  // Was das Mastziel der Gruppen am Markt kostet (Abzug ab 43 kg LG).
  const examples = [36, 40, 43, 45, 50, 55].map((live) => {
    const carcass = estimateCarcassKg(live, grade)
    return { live, carcass, market: marketValue(carcass, grade, prices), direct: directValue(carcass, direct) }
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Vermarktung</h1>
        <Link to="/livestock/wirtschaftlichkeit" className="text-sm text-brand-700">
          Wirtschaftlichkeit →
        </Link>
      </div>
      <p className="text-sm text-gray-600">
        Was ein Tier heute über den Markt (Proviande-Preis nach CH-TAX) bringt, und was nach der Metzgerrechnung
        bleibt, wenn ihr es selbst vermarktet. Arbeit für Verkauf und Auslieferung ist darin nicht gerechnet.
      </p>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Am Markt — Lebendgewicht bis zum Abzug</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Klasse
            <input
              value={gradeText}
              onChange={(e) => setGradeText(e.target.value)}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
              aria-label="Angenommene Klasse"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-1">Lebendgewicht</th>
                <th className="py-1 text-right">Schlachtgewicht</th>
                <th className="py-1 text-right">Abzug/kg</th>
                <th className="py-1 text-right">Markt</th>
                <th className="py-1 text-right">Direkt netto</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((e) => (
                <tr key={e.live} className="border-t">
                  <td className="py-1">{e.live} kg</td>
                  <td className="py-1 text-right">{e.carcass.toFixed(1)} kg</td>
                  <td className={`py-1 text-right ${e.market.weightDeduction > 0 ? 'text-red-600' : ''}`}>
                    {e.market.weightDeduction > 0 ? `−${e.market.weightDeduction.toFixed(2)}` : '–'}
                  </td>
                  <td className="py-1 text-right">{fmtChf(e.market.revenue)}</td>
                  <td className="py-1 text-right">{fmtChf(e.direct.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Proviande zieht ab {LA_DEDUCTION_FROM_LG} kg Lebendgewicht (20.5 kg SG) pro kg ab, zwischen 25 und 28 kg SG
          4.00 Fr./kg; ab {LA_MAX_LG} kg LG (28 kg SG) gilt der Schafpreis. Schwere Lämmer lohnen sich darum eher in
          der Direktvermarktung.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Aus den Viehabrechnungen 2025/26 (Zwahlen, Wenger): Lämmer mit 17–19.5 kg SG und Fettklasse 2–3 brachten
          14.30–15.00 Fr./kg; leichte (10–14 kg SG) und magere Lämmer (Fettklasse 1, «nass», A/X) nur 7–12.70. Das
          beste Fenster liegt also knapp unter dem Abzug, bei rund 38–43 kg Lebendgewicht mit genügend Fett. Der
          Händler verrechnet zusätzlich den Transport (60–70 Fr. je Fuhre).
        </p>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          Aktive Tiere — geschätzt mit {formatGrade(grade)} und letzter Wägung
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-1">Ohrmarke</th>
                <th className="py-1 text-right">LG</th>
                <th className="py-1 text-right">SG geschätzt</th>
                <th className="py-1 text-right">Markt</th>
                <th className="py-1 text-right">Direkt netto</th>
                <th className="py-1">Hinweis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, live, adult, carcass, market, direct: d }) => {
                const better = market && d ? (d.net > market.revenue ? 'direkt' : 'markt') : null
                const hint = adult
                  ? 'Schaf (über 420 Tage)'
                  : live == null
                    ? 'keine Wägung'
                    : live > LA_MAX_LG
                      ? 'Schafpreis'
                      : live > LA_DEDUCTION_FROM_LG
                        ? `Abzug ${market?.weightDeduction.toFixed(2)}/kg`
                        : `noch ${(LA_DEDUCTION_FROM_LG - live).toFixed(1)} kg bis Abzug`
                return (
                  <tr key={a.id} className="border-t">
                    <td className="py-1">
                      <Link to={`/livestock/tiere/${a.id}`} className="font-medium text-brand-700">
                        {shortEarTag(a.ear_tag)}
                      </Link>
                    </td>
                    <td className="py-1 text-right">{live != null ? `${live.toFixed(1)}` : '–'}</td>
                    <td className="py-1 text-right">{carcass != null ? carcass.toFixed(1) : '–'}</td>
                    <td className={`py-1 text-right ${better === 'markt' ? 'font-semibold text-green-700' : ''}`}>
                      {market ? fmtChf(market.revenue) : '–'}
                    </td>
                    <td className={`py-1 text-right ${better === 'direkt' ? 'font-semibold text-green-700' : ''}`}>
                      {d ? fmtChf(d.net) : '–'}
                    </td>
                    <td className="py-1 text-xs text-gray-500">{hint}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="p-3 text-center text-gray-400">Keine aktiven Tiere.</p>}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Proviande-Wochenpreis</h2>
          {!editPrices && (
            <button type="button" className="text-xs text-brand-700" onClick={() => setEditPrices(true)}>
              Neue Preise erfassen
            </button>
          )}
        </div>
        {editPrices ? (
          <PricesForm initial={prices} onDone={() => setEditPrices(false)} />
        ) : (
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <Row label="Lämmer LA, T3" value={`${prices.la_t3.toFixed(2)} Fr./kg SG`} />
            <Row label="Schafe SM, T3" value={`${prices.sm_t3.toFixed(2)} Fr./kg SG`} />
            <Row label="Bio-Zuschlag" value={`${prices.bio_premium.toFixed(2)} Fr./kg SG`} />
            <Row label="Gebühren je Tier" value={fmtChf(prices.fee_per_animal)} />
            <Row label="Gültig ab" value={prices.valid_from ? fmtDate(prices.valid_from) : '–'} />
            <Row label="Quelle" value={prices.source ?? '–'} />
          </dl>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Direktvermarktung — Metzger und Verkauf</h2>
          {!editDirect && (
            <button type="button" className="text-xs text-brand-700" onClick={() => setEditDirect(true)}>
              Ändern
            </button>
          )}
        </div>
        {editDirect ? (
          <DirectForm initial={direct} onDone={() => setEditDirect(false)} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <Row label="Metzger" value={direct.butcher ?? '–'} />
              <Row label="Je Tier" value={fmtChf(direct.fee_per_animal)} />
              <Row label="Schlachten + Zerlegen" value={`${direct.fee_per_kg_carcass.toFixed(2)} je kg SG`} />
              <Row label="Fleisch vom Schlachtgewicht" value={`${direct.meat_yield_pct} %`} />
              <Row label="Fett und Knochen entsorgen" value={`${direct.disposal_per_kg.toFixed(2)} je kg`} />
              <Row label="Paket" value={`${direct.pack_grams} g, ${direct.fee_per_pack.toFixed(2)} je Paket`} />
              <Row
                label="Wurst und Hack"
                value={`${direct.sausage_share_pct} %, ${direct.sausage_fee_per_kg.toFixed(2)} je kg`}
              />
              <Row label="MwSt" value={`${direct.vat_pct} %`} />
              <Row label="Verkauf, Mischpreis" value={`${direct.meat_price_per_kg.toFixed(2)} je kg Fleisch`} />
            </dl>
            <p className="mt-2 text-xs text-gray-500">
              Aus den Schlachtabrechnungen 2024–2026: Lämmer 53–59 % Fleisch vom Schlachtgewicht, Metzgerkosten rund
              12 Fr. je kg Fleisch. Mit dem Tier zum Marktpreis kostet ein kg Lammfleisch so rund 34.50 Fr. — bei
              einem Mischpreis von 32–35 Fr. bleibt wenig für Arbeit und Verkauf.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

function PricesForm({ initial, onDone }: { initial: MarketPrices; onDone: () => void }) {
  const [form, setForm] = useState({
    valid_from: todayIso(),
    la_t3: String(initial.la_t3),
    sm_t3: String(initial.sm_t3),
    bio_premium: String(initial.bio_premium),
    fee_per_animal: String(initial.fee_per_animal),
    source: 'Proviande',
  })
  const [saving, setSaving] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await upsertRow('market_prices', {
        id: crypto.randomUUID(),
        valid_from: form.valid_from,
        la_t3: Number(form.la_t3),
        sm_t3: Number(form.sm_t3),
        bio_premium: Number(form.bio_premium) || 0,
        fee_per_animal: Number(form.fee_per_animal) || 0,
        source: form.source || null,
        notes: null,
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }
  return (
    <form onSubmit={save} className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Lämmer LA, T3 (Fr./kg SG)" value={form.la_t3} onChange={(v) => setForm({ ...form, la_t3: v })} />
        <NumField label="Schafe SM, T3 (Fr./kg SG)" value={form.sm_t3} onChange={(v) => setForm({ ...form, sm_t3: v })} />
        <NumField label="Bio-Zuschlag (Fr./kg SG)" value={form.bio_premium} onChange={(v) => setForm({ ...form, bio_premium: v })} />
        <NumField label="Gebühren je Tier (Fr.)" value={form.fee_per_animal} onChange={(v) => setForm({ ...form, fee_per_animal: v })} />
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">Gültig ab</span>
          <input
            type="date"
            value={form.valid_from}
            onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
            className="w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-gray-600">Quelle</span>
        <input
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
      </label>
      <FormButtons saving={saving} onCancel={onDone} />
    </form>
  )
}

const DIRECT_FIELDS: [keyof DirectMarketingSettings, string][] = [
  ['fee_per_animal', 'Je Tier (Fleischschau, Abfall, Abgabe)'],
  ['fee_per_kg_carcass', 'Schlachten + Zerlegen je kg SG'],
  ['meat_yield_pct', 'Fleisch in % vom SG'],
  ['disposal_per_kg', 'Fett/Knochen entsorgen je kg'],
  ['pack_grams', 'Paketgrösse (g)'],
  ['fee_per_pack', 'Vakuum + Etikette je Paket'],
  ['sausage_share_pct', 'Anteil Wurst/Hack in %'],
  ['sausage_fee_per_kg', 'Wurst/Hack herstellen je kg'],
  ['vat_pct', 'MwSt in %'],
  ['meat_price_per_kg', 'Mischpreis Verkauf je kg Fleisch'],
]

function DirectForm({
  initial,
  onDone,
}: {
  initial: DirectMarketingSettings & { butcher: string | null }
  onDone: () => void
}) {
  const [butcher, setButcher] = useState(initial.butcher?.replace(' (eingebaut)', '') ?? '')
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(DIRECT_FIELDS.map(([k]) => [k, String(initial[k])])),
  )
  const [saving, setSaving] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await upsertRow('direct_marketing_settings', {
        id: crypto.randomUUID(),
        valid_from: todayIso(),
        butcher: butcher || null,
        ...Object.fromEntries(DIRECT_FIELDS.map(([k]) => [k, Number(values[k]) || 0])),
        notes: null,
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }
  return (
    <form onSubmit={save} className="space-y-2 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs text-gray-600">Metzger</span>
        <input
          value={butcher}
          onChange={(e) => setButcher(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {DIRECT_FIELDS.map(([k, label]) => (
          <NumField key={k} label={label} value={values[k]} onChange={(v) => setValues({ ...values, [k]: v })} />
        ))}
      </div>
      <FormButtons saving={saving} onCancel={onDone} />
    </form>
  )
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-600">{label}</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1"
      />
    </label>
  )
}

function FormButtons({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="submit" disabled={saving} className="rounded bg-brand-700 px-3 py-1 text-white disabled:opacity-50">
        {saving ? 'Speichert…' : 'Speichern'}
      </button>
      <button type="button" onClick={onCancel} className="rounded border border-gray-300 px-3 py-1 text-gray-700">
        Abbrechen
      </button>
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
