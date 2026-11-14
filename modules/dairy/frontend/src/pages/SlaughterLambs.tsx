import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { animalLabel, shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'
import { useQuery } from '../hooks/useQuery'
import { loadLambSelection, SIRE_TRAIT } from '../lib/lambSelectionData'
import { rankLambs, type LambRow } from '../lib/lambSelection'
import { DEFAULT_SLAUGHTER_SETTINGS, lambMaxMonths, slaughterValue, type SlaughterSettings, type SlaughterValue } from '../lib/slaughterLambs'
import { fmtDate, todayIso } from '../lib/format'
import { speciesOf } from '../lib/species'
import { loadSettings } from './LambSelection'
import { useProviandePrices } from '../lib/proviandePrices'

const settingsKey = (moduleKey: string) => `${moduleKey}_slaughter_lambs`

function loadSlaughterSettings(moduleKey: string): SlaughterSettings {
  try {
    const raw = localStorage.getItem(settingsKey(moduleKey))
    if (raw) return { ...DEFAULT_SLAUGHTER_SETTINGS, ...(JSON.parse(raw) as Partial<SlaughterSettings>) }
  } catch {
    // ohne localStorage gelten die Vorgaben
  }
  return DEFAULT_SLAUGHTER_SETTINGS
}

const FIELDS: { key: Exclude<keyof SlaughterSettings, 'ownPrices'>; label: string; step: number }[] = [
  { key: 'priceLamb', label: 'Lämmer LA T3, CHF/kg SG', step: 0.05 },
  { key: 'priceSheep', label: 'Schafe SM T3, CHF/kg SG', step: 0.05 },
  { key: 'carcassKg', label: 'Schlachtgewicht, kg', step: 0.5 },
  { key: 'minAgeMonths', label: 'schlachtreif ab, Monate', step: 0.5 },
  { key: 'lambMaxDays', label: 'Lamm bis Alter, Tage', step: 1 },
]

const chf = (v: number | null) => (v == null ? '–' : v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const months = (days: number) => (days / 30.4375).toLocaleString('de-CH', { maximumFractionDigits: 1 })

type Row = LambRow & { value: SlaughterValue }
type SexFilter = 'alle' | 'w' | 'm'

/** Lämmer am Schlachttermin: Abstammungsindex (Lämmer-Selektion) gegen den möglichen Erlös. */
export default function SlaughterLambs({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const today = todayIso()
  const [date, setDate] = useState(today)
  const [stored, setSettings] = useState(() => loadSlaughterSettings(moduleKey))
  // Preise: Proviande-Woche, solange keine eigenen gewählt sind
  const proviande = useProviandePrices('sheep')
  const settings = useMemo<SlaughterSettings>(
    () => (!stored.ownPrices && proviande ? { ...stored, priceLamb: proviande.young ?? stored.priceLamb, priceSheep: proviande.adult ?? stored.priceSheep } : stored),
    [stored, proviande],
  )
  const [showSettings, setShowSettings] = useState(false)
  const [sex, setSex] = useState<SexFilter>('alle')
  const [onlyReady, setOnlyReady] = useState(false)
  const { data, loading } = useQuery((pg) => loadLambSelection(pg, species, today), [species, today])
  const sireTrait = SIRE_TRAIT[species]

  function update(next: SlaughterSettings) {
    setSettings(next)
    try {
      localStorage.setItem(settingsKey(moduleKey), JSON.stringify(next))
    } catch {
      // nur bis zum Reload
    }
  }

  const rows = useMemo<Row[]>(() => {
    if (!data || !date) return []
    const selection = loadSettings(moduleKey)
    return rankLambs({
      candidates: data.candidates,
      dams: data.dams,
      sireValues: data.sireValues,
      inbreeding: (dam, sire) => data.inbreeding.offspring(dam, sire),
      decisions: new Map([...data.decisions].map(([k, d]) => [k, d.purpose])),
      settings: { ...selection, maxAgeMonths: lambMaxMonths(settings) },
      today: date,
    })
      .map((r) => ({ ...r, value: slaughterValue(r.birth_date, date, settings) }))
      // nur Tiere im Bestand (der Herdebuch-Export kennt auch längst verkaufte Lämmer)
      .filter((r) => r.animal_id != null && r.value.isLamb)
      // tiefster Index zuerst (eher Schlachtlamm), ohne Index ans Ende
      .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || a.value.daysLeftAsLamb - b.value.daysLeftAsLamb)
  }, [data, date, settings, moduleKey])

  const visible = rows.filter((r) => (sex === 'alle' || r.sex === sex) && (!onlyReady || r.value.ready))
  const ready = rows.filter((r) => r.value.ready)
  const sum = (rs: Row[]) => rs.reduce((s, r) => s + (r.value.revenue ?? 0), 0)
  const bands = [
    { label: 'Index unter 95', rs: ready.filter((r) => r.index != null && r.index < 95) },
    { label: '95–105', rs: ready.filter((r) => r.index != null && r.index >= 95 && r.index <= 105) },
    { label: 'über 105', rs: ready.filter((r) => r.index != null && r.index > 105) },
    { label: 'ohne Index', rs: ready.filter((r) => r.index == null) },
  ].filter((b) => b.rs.length > 0)

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Lämmer zum Schlachttermin</h1>
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="link-btn rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            ⚙️ Preise
          </button>
          <button type="button" onClick={() => window.print()} className="link-btn rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            Drucken
          </button>
          <Link to=".." relative="path" className="link-btn rounded border border-gray-300 px-2 py-1 text-xs text-gray-600">
            ‹ Ausmerzliste
          </Link>
        </div>
      </div>

      <label className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-3 text-sm text-gray-700 shadow-sm">
        Schlachttermin
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-3 text-base" />
      </label>

      {showSettings && (
        <SettingsEditor value={stored} onSave={update} onReset={() => DEFAULT_SLAUGHTER_SETTINGS} label="Preise" className="rounded-lg bg-white p-4 shadow-sm print:hidden" title="Preise und Schlachtgewichte für den Erlös">
          {({ value, set, editing }) => {
            // Anzeige: Proviande-Wochenpreise, solange keine eigenen gewählt sind
            const eff: SlaughterSettings = !value.ownPrices && proviande ? { ...value, priceLamb: proviande.young ?? value.priceLamb, priceSheep: proviande.adult ?? value.priceSheep } : value
            return (
              <div className="mt-2">
                {proviande ? (
                  <label className="mb-2 flex items-start gap-2 text-sm text-gray-800">
                    {editing ? (
                      <input type="checkbox" checked={!value.ownPrices} onChange={(e) => set({ ...value, ownPrices: !e.target.checked })} className="mt-1 h-5 w-5" />
                    ) : (
                      <span aria-hidden>{value.ownPrices ? '✏️' : '✓'}</span>
                    )}
                    <span>
                      Proviande-Wochenpreise Woche {proviande.week} (ab {fmtDate(proviande.validFrom)}): LA T3 {proviande.young?.toFixed(2) ?? '–'}, SM T3 {proviande.adult?.toFixed(2) ?? '–'} CHF/kg SG
                      {!editing && <span className="block text-xs text-gray-600">{value.ownPrices ? 'Es gelten eigene Preise.' : 'Diese Preise gelten.'}</span>}
                    </span>
                  </label>
                ) : (
                  <p className="mb-2 text-xs text-gray-600">Proviande-Wochenpreise noch nicht da (holt der Server automatisch).</p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="flex items-center justify-between gap-2 text-sm text-gray-700">
                      {f.label}
                      {editing ? (
                        <NumberInput
                          min={0}
                          step={f.step}
                          value={Number(eff[f.key])}
                          disabled={(f.key === 'priceLamb' || f.key === 'priceSheep') && !!proviande && !value.ownPrices}
                          onChange={(e) => set({ ...value, [f.key]: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-right disabled:bg-gray-100"
                        />
                      ) : (
                        <ReadValue>{Number(eff[f.key])}</ReadValue>
                      )}
                    </label>
                  ))}
                </div>
          <p className="mt-2 text-xs text-gray-500">
            Index: Gewichtung wie in der{' '}
            <Link to="../../selektion" relative="path" className="text-brand-700">
              Lämmer-Selektion
            </Link>
            .
          </p>
              </div>
            )
          }}
        </SettingsEditor>
      )}

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}

      {data && date && (
        <section className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
          <p className="text-sm text-gray-800">
            Am <b>{fmtDate(date)}</b> zählen <b>{rows.length}</b> Tiere im Bestand als Lamm (jünger als {settings.lambMaxDays} Tage). Schlachtreif (ab {settings.minAgeMonths} Mt., ca. {settings.carcassKg} kg SG):{' '}
            <b>{ready.length}</b>, zusammen <b>CHF {chf(sum(ready))}</b>.
          </p>
          <p className="text-xs text-gray-600">
            Je Lamm {settings.carcassKg} kg × {chf(settings.priceLamb)} = CHF {chf(settings.carcassKg * settings.priceLamb)}; nach {settings.lambMaxDays} Tagen als Schaf {settings.carcassKg} kg × {chf(settings.priceSheep)} = CHF{' '}
            {chf(settings.carcassKg * settings.priceSheep)} (Gewicht gleich angenommen).
          </p>
          {bands.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {bands.map((b) => (
                <div key={b.label} className="rounded-lg border border-gray-200 px-3 py-2">
                  <span className="block text-xs text-gray-600">{b.label}</span>
                  <span className="block text-lg font-bold tabular-nums text-gray-900">{b.rs.length}</span>
                  <span className="block text-xs tabular-nums text-gray-700">CHF {chf(sum(b.rs))}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-3 text-sm print:hidden">
          <div className="flex overflow-hidden rounded-lg border border-gray-300">
            {(['alle', 'w', 'm'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSex(s)} className={`min-h-11 px-3 ${sex === s ? 'bg-brand-700 text-white' : 'bg-white text-gray-700'}`}>
                {s === 'alle' ? 'alle' : s === 'w' ? '♀' : '♂'}
              </button>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="h-5 w-5" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} />
            nur schlachtreife
          </label>
        </div>
      )}

      {data && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-gray-300 text-left text-xs text-gray-600">
                <th className="px-2 py-2">Tier</th>
                <th className="px-2 py-2">Alter am Termin</th>
                <th className="px-2 py-2">Lamm bis</th>
                <th className="bg-brand-50 px-2 py-2 text-right text-brand-800">Index</th>
                <th className="px-2 py-2 text-right">Vater {sireTrait.label}</th>
                <th className="px-2 py-2 text-right">Erlös am Termin</th>
                <th className="px-2 py-2 text-right">später als Schaf</th>
                <th className="px-2 py-2">Entscheid</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const v = r.value
                const idxTone = r.index == null ? 'text-gray-500' : r.index < 95 ? 'text-rose-700' : r.index > 105 ? 'text-green-700' : 'text-gray-900'
                return (
                  <tr key={r.key} className="border-b border-gray-100 last:border-0">
                    <td className="px-2 py-1.5">
                      {r.animal_id ? (
                        <Link to={`../../tiere/${r.animal_id}`} relative="path" className="font-medium text-gray-900">
                          {animalLabel(r)}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-900">{animalLabel(r)}</span>
                      )}
                      <span className="ml-1 text-gray-600">{r.sex === 'w' ? '♀' : r.sex === 'm' ? '♂' : ''}</span>
                      <span className="block text-xs text-gray-500">
                        Mutter {r.dam ? (r.dam.lauf_nr ?? shortEarTag(r.dam.ear_tag)) : shortEarTag(r.dam_key) || '?'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {months(v.ageDays)} Mt.
                      <span className="block text-xs text-gray-500">geb. {fmtDate(r.birth_date)}</span>
                    </td>
                    <td className={`px-2 py-1.5 tabular-nums ${v.daysLeftAsLamb < 30 ? 'font-semibold text-amber-800' : ''}`}>
                      {fmtDate(v.lambUntil)}
                      <span className="block text-xs text-gray-500">noch {v.daysLeftAsLamb} T. nach Termin</span>
                    </td>
                    <td className={`bg-brand-50 px-2 py-1.5 text-right font-bold tabular-nums ${idxTone}`}>
                      {r.index != null ? r.index.toLocaleString('de-CH', { minimumFractionDigits: 1 }) : '–'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.sire_value ?? '–'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {v.revenue != null ? chf(v.revenue) : <span className="text-xs text-gray-500">reif ab {fmtDate(v.readyFrom)}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{chf(v.revenueAsSheep)}</td>
                    <td className="px-2 py-1.5">{r.purpose === 'zucht' ? '⭐ Zucht' : r.purpose === 'mast' ? 'Mast' : <span className="text-gray-500">offen</span>}</td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-3 text-gray-700">
                    Keine Lämmer für diesen Termin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Index = Abstammung wie in der Lämmer-Selektion (Mutterleistung, Zellzahl, Tendenz{', '}Vater-Zuchtwert je nach Gewichtung; 100 = Herdenmittel, rot unter 95, grün über 105).
        Sortiert nach Index, tiefster zuerst. Erlös als Schätzung mit festem Schlachtgewicht; die Liste entscheidet nichts.
      </p>
    </div>
  )
}
