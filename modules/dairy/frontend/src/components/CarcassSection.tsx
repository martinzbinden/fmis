import { useMemo, useState } from 'react'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import Modal from '@fmis/core/Modal'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { fmtDate, localTodayIso } from '../lib/format'
import { loadCattleData, loadEstimates, useCattlePrices, type EstimateRow } from '../lib/carcassData'
import { CATEGORY_LABEL, cattleValue, chtaxLabel, FAT_CLASSES, FLESHINESS, girthToLiveKg, loadCattleSettings, METHOD_LABEL, type FatClass, type Fleshiness, type WeightMethod } from '../lib/carcassValue'
import { FAT_TEXT, FatPicture, FLESH_TEXT, FleshPicture } from './ChTaxPictures'

const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-base'
const chip = (on: boolean) => `min-h-11 rounded-lg border px-3 text-sm ${on ? 'border-brand-700 bg-brand-50 font-semibold text-brand-900' : 'border-gray-300 bg-white text-gray-800'}`
const fr = (v: number) => Math.round(v).toLocaleString('de-CH')

/** Tierseite Rindvieh: geschätzter Schlachtwert mit Grundlagen, eigene Gewichts- und CH-TAX-Schätzungen. */
export default function CarcassSection({ moduleKey, animalId }: { moduleKey: string; animalId: string }) {
  const { prices, week } = useCattlePrices()
  const settings = useMemo(() => loadCattleSettings(moduleKey), [moduleKey])
  const date = settings.slaughterDate || localTodayIso()
  const { data } = useQuery((pg) => Promise.all([loadCattleData(pg, prices), loadEstimates(pg, animalId)]), [prices, animalId])
  const [dialog, setDialog] = useState<'gewicht' | 'chtax' | null>(null)
  if (!data) return <p className="text-sm text-gray-500">Lädt…</p>
  const [cattle, history] = data
  const input = cattle.inputs.get(animalId)
  const v = input ? cattleValue(input, date, prices, settings, cattle.calibration) : null
  return (
    <div className="space-y-3 text-sm">
      {!v ? (
        <p className="text-gray-600">Ohne Geburtsdatum keine Schätzung.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-2xl font-semibold tabular-nums text-gray-900">≈ {fr(v.net)} Fr.</span>
            <span className="text-gray-700">
              {CATEGORY_LABEL[v.category]} · {chtaxLabel(v.fleshiness, v.fat)}
            </span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-700">
            <dt className="text-gray-500">Schlachtgewicht</dt>
            <dd>
              {v.kg} kg SG{v.liveKg ? ` (≈ ${v.liveKg} kg lebend)` : ''} · {v.weightBasis}
            </dd>
            <dt className="text-gray-500">CH-TAX</dt>
            <dd>
              {chtaxLabel(v.fleshiness, v.fat)} · {v.chtaxBasis}
            </dd>
            <dt className="text-gray-500">Preis</dt>
            <dd>
              {v.pricePerKg.toFixed(2)} Fr./kg SG ({v.category} {v.fleshiness === '+' || v.fleshiness === '-' ? `${v.fleshiness}T` : v.fleshiness} {v.price.base.toFixed(2)}
              {v.price.fat ? `, Fett ${v.price.fat.toFixed(2)}` : ''}
              {v.price.age ? `, Alter ${v.price.age.toFixed(2)}` : ''}
              {settings.priceFactor !== 1 ? `, ×${settings.priceFactor}` : ''}) · Proviande {week ? `Woche ${week}` : 'Woche 48/2026 (Ersatz)'}
            </dd>
            <dt className="text-gray-500">Am</dt>
            <dd>
              {fmtDate(date)}
              {settings.slaughterDate ? ' (Schlachttermin im Dashboard)' : ' (heute)'} · {v.ageDays} Tage alt
              {settings.feePerAnimal + settings.transportPerAnimal > 0 ? ` · nach Abzügen ${fr(settings.feePerAnimal + settings.transportPerAnimal)} Fr.` : ''}
            </dd>
          </dl>
        </>
      )}
      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 font-medium text-gray-800 active:bg-gray-50" onClick={() => setDialog('gewicht')}>
          ⚖️ Gewicht schätzen
        </button>
        <button type="button" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 font-medium text-gray-800 active:bg-gray-50" onClick={() => setDialog('chtax')}>
          🏷️ CH-TAX schätzen
        </button>
      </div>
      {history.length > 0 && <History rows={history.slice(0, 6)} />}
      {dialog === 'gewicht' && <WeightDialog animalId={animalId} onClose={() => setDialog(null)} />}
      {dialog === 'chtax' && <ChTaxDialog animalId={animalId} current={v ? { f: v.fleshiness, fat: v.fat } : null} onClose={() => setDialog(null)} />}
    </div>
  )
}

function History({ rows }: { rows: EstimateRow[] }) {
  const db = useDb()
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2 px-2 py-1">
          <span className="w-20 shrink-0 tabular-nums text-gray-600">{fmtDate(r.estimate_date)}</span>
          <span className="min-w-0 flex-1 text-gray-800">
            {r.kind === 'chtax' && r.fleshiness && r.fat_class
              ? `CH-TAX ${chtaxLabel(r.fleshiness, r.fat_class)}`
              : `${r.method ? METHOD_LABEL[r.method] : ''} ${r.weight_kg} kg ${r.basis === 'sg' ? 'SG' : 'lebend'}${r.girth_cm ? ` (Brustumfang ${r.girth_cm} cm)` : ''}`}
          </span>
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-lg px-2 text-xs text-gray-600 active:bg-gray-100"
            onClick={() => void upsertRow(db, 'carcass_estimates', { ...r, deleted_at: new Date().toISOString() } as never).catch((e: unknown) => notifyError(errorText(e)))}
          >
            löschen
          </button>
        </li>
      ))}
    </ul>
  )
}

function WeightDialog({ animalId, onClose }: { animalId: string; onClose: () => void }) {
  const db = useDb()
  const [method, setMethod] = useState<WeightMethod>('messband')
  const [date, setDate] = useState(localTodayIso())
  const [value, setValue] = useState('')
  const [basis, setBasis] = useState<'lg' | 'sg'>('lg')
  const [busy, setBusy] = useState(false)
  const n = Number(value.replace(',', '.'))
  const live = method === 'messband' ? girthToLiveKg(n) : n > 0 ? n : null
  async function save() {
    if (!live) return
    setBusy(true)
    try {
      if (method === 'waage') {
        await upsertRow(db, 'animal_weights', { id: crypto.randomUUID(), animal_id: animalId, offspring_id: null, weigh_date: date, weight_kg: Math.round(n * 10) / 10, notes: 'Waage', created_by: getCurrentUserEmail() } as never)
      } else {
        await upsertRow(db, 'carcass_estimates', {
          id: crypto.randomUUID(),
          animal_id: animalId,
          estimate_date: date,
          kind: 'gewicht',
          method,
          basis: method === 'messband' ? 'lg' : basis,
          weight_kg: Math.round(live * 10) / 10,
          girth_cm: method === 'messband' ? n : null,
          fleshiness: null,
          fat_class: null,
          notes: null,
          created_by: getCurrentUserEmail(),
        } as never)
      }
      notifySuccess('Gewicht gespeichert')
      onClose()
    } catch (e) {
      notifyError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="Gewicht schätzen" onClose={onClose} onSubmit={() => void save()}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {(['waage', 'messband', 'auge'] as WeightMethod[]).map((m) => (
            <button key={m} type="button" className={chip(method === m)} onClick={() => setMethod(m)}>
              {m === 'waage' ? '⚖️ ' : m === 'messband' ? '📏 ' : '👁️ '}
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-gray-600">{method === 'messband' ? 'Brustumfang (cm, hinter den Vorderbeinen)' : method === 'waage' ? 'Lebendgewicht (kg)' : 'Gewicht (kg)'}</span>
          <input className={`${field} w-full`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        {method === 'auge' && (
          <div className="flex gap-2">
            <button type="button" className={chip(basis === 'lg')} onClick={() => setBasis('lg')}>
              lebend
            </button>
            <button type="button" className={chip(basis === 'sg')} onClick={() => setBasis('sg')}>
              Schlachtgewicht
            </button>
          </div>
        )}
        {method === 'messband' && <p className="text-gray-700">{live ? `≈ ${live} kg lebend` : 'Umfang 80–230 cm eingeben.'} Formel nach Heinrichs (Holstein-Rinder); bei Fleischrassen eher zu tief.</p>}
        <label className="block">
          <span className="text-gray-600">Datum</span>
          <input type="date" className={`${field} w-full`} value={date} max={localTodayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="text-xs text-gray-600">Die jüngste Angabe zählt (Waage, Messband oder Auge) und wird bis zum Schlachttermin mit der Wachstumskurve fortgeschrieben.</p>
        <button type="button" disabled={busy || !live} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40">
          Speichern
        </button>
      </div>
    </Modal>
  )
}

function ChTaxDialog({ animalId, current, onClose }: { animalId: string; current: { f: Fleshiness; fat: FatClass } | null; onClose: () => void }) {
  const db = useDb()
  const [f, setF] = useState<Fleshiness>(current?.f ?? 'T')
  const [fat, setFat] = useState<FatClass>(current?.fat ?? 3)
  // Assistent mit Bildern: zuerst die Keule, dann das Fett
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await upsertRow(db, 'carcass_estimates', {
        id: crypto.randomUUID(),
        animal_id: animalId,
        estimate_date: localTodayIso(),
        kind: 'chtax',
        method: null,
        basis: null,
        weight_kg: null,
        girth_cm: null,
        fleshiness: f,
        fat_class: fat,
        notes: null,
        created_by: getCurrentUserEmail(),
      } as never)
      notifySuccess(`CH-TAX ${chtaxLabel(f, fat)} gespeichert`)
      onClose()
    } catch (e) {
      notifyError(errorText(e))
      setBusy(false)
    }
  }
  const pick = 'flex min-h-11 min-w-0 flex-col items-center rounded-lg border p-1.5 text-center'
  return (
    <Modal title="CH-TAX schätzen" onClose={onClose} onSubmit={() => void save()}>
      <div className="space-y-3 text-sm">
        {step === 0 && (
          <>
            <div>
              <div className="mb-1 text-gray-600">Fleischigkeit</div>
              <div className="flex flex-wrap gap-1.5">
                {FLESHINESS.map((x) => (
                  <button key={x} type="button" className={`${chip(f === x)} w-11`} title={FLESH_TEXT[x].name} onClick={() => setF(x)}>
                    {x === '+' ? '+T' : x === '-' ? '−T' : x}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-600">{FLESH_TEXT[f].name}: {FLESH_TEXT[f].hint}</p>
            </div>
            <div>
              <div className="mb-1 text-gray-600">Fettgewebe</div>
              <div className="flex flex-wrap gap-1.5">
                {FAT_CLASSES.map((x) => (
                  <button key={x} type="button" className={`${chip(fat === x)} w-11`} title={FAT_TEXT[x].name} onClick={() => setFat(x)}>
                    {x}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-600">{FAT_TEXT[fat].name}: {FAT_TEXT[fat].hint}</p>
            </div>
            <button type="button" className="min-h-11 w-full rounded-lg border border-dashed border-gray-400 bg-white font-medium text-gray-800" onClick={() => setStep(1)}>
              🖼️ Mit Bildern einschätzen
            </button>
          </>
        )}
        {step === 1 && (
          <div>
            <div className="mb-1 font-medium text-gray-800">1/2 · Keule von hinten: welches Bild passt am besten?</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {FLESHINESS.map((x) => (
                <button key={x} type="button" className={`${pick} ${f === x ? 'border-brand-700 bg-brand-50' : 'border-gray-300 bg-white'}`} onClick={() => (setF(x), setStep(2))}>
                  <FleshPicture f={x} size={72} />
                  <span className="font-semibold">{x === '+' ? '+T' : x === '-' ? '−T' : x}</span>
                  <span className="text-xs text-gray-600">{FLESH_TEXT[x].name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <div className="mb-1 font-medium text-gray-800">2/2 · Fett: Rippen und Schwanzansatz abtasten</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {FAT_CLASSES.map((x) => (
                <button key={x} type="button" className={`${pick} ${fat === x ? 'border-brand-700 bg-brand-50' : 'border-gray-300 bg-white'}`} onClick={() => (setFat(x), setStep(0))}>
                  <FatPicture fat={x} size={72} />
                  <span className="font-semibold">{x}</span>
                  <span className="text-xs text-gray-600">{FAT_TEXT[x].hint}</span>
                </button>
              ))}
            </div>
            <button type="button" className="mt-2 min-h-11 text-sm text-gray-700 underline" onClick={() => setStep(1)}>
              ← zurück zur Keule
            </button>
          </div>
        )}
        {step === 0 && (
          <button type="button" disabled={busy} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40">
            {chtaxLabel(f, fat)} speichern
          </button>
        )}
      </div>
    </Modal>
  )
}
