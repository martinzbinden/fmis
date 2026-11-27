import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import { animalLabel, shortEarTag } from '@fmis/core/earTag'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { getSyncedDb as getBetriebDb } from '@fmis/betrieb/db/access'
import { fetchFile, findForm, FORM_SOURCE, loadDocuments, storedDocuments, type TierDocument } from '@fmis/tiere/lib/documents'
import AnimalPicker from '../components/AnimalPicker'
import { useQuery } from '../hooks/useQuery'
import { bdProblems, buildPdf, fmtDay, healthSummary, loadBdAnimals, loadMovementDocs, PURPOSES, saveMovementDoc, tagList, type BdAnimal, type BdData, type BdHolder, type Purpose } from '../lib/begleitdokument'
import { localTodayIso } from '../lib/format'
import { speciesOf } from '../lib/species'
import type { Animal } from '../types'

const HOLDER_KEY = 'fmis_begleit_holder'
const field = 'min-h-11 w-full rounded-lg border-2 border-gray-300 px-3 text-base focus:border-brand-700 focus:outline-none'

function storedHolder(): Partial<BdHolder> & { signer?: string; place?: string } {
  try {
    return JSON.parse(localStorage.getItem(HOLDER_KEY) ?? '{}') as Partial<BdHolder>
  } catch {
    return {}
  }
}

/** TVD-Nr. und Angaben zum Tierhalter aus den Betriebsdaten (Modul Betrieb), sonst die zuletzt verwendeten. */
async function farmHolder(): Promise<Partial<BdHolder>> {
  try {
    const pg = await getBetriebDb()
    const { rows } = await pg.query<{ label: string; value: string }>('select label, value from farm_numbers where deleted_at is null order by sort_order')
    const find = (re: RegExp) => rows.find((r) => re.test(r.label))?.value.trim()
    return {
      tvd: find(/tvd/i)?.replace(/\D/g, ''),
      name: find(/tierhalter|name/i),
      address: find(/^adresse|strasse/i),
      place: find(/plz|wohnort/i),
    }
  } catch {
    return {}
  }
}

async function loadPage(pg: PGlite, ids: string[], species: 'cattle' | 'sheep', date: string) {
  const [animals, chosen, docs] = await Promise.all([
    pg.query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' order by lauf_nr nulls last, ear_tag"),
    loadBdAnimals(pg, ids, species, date),
    loadMovementDocs(pg, '1900-01-01'),
  ])
  return { animals: animals.rows, chosen, destinations: [...new Set(docs.map((d) => d.destination).filter((d): d is string => !!d))] }
}

function save(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Begleitdokument für Klauentiere auf Papier, wenn die TVD nicht geht: BLV-Formular samt Tierliste aus den Tieren
 * einer Gruppe/Merkliste (?tiere=id,id) ausfüllen; danach bleibt eine Pendenz, den Abgang in der TVD zu melden. */
export default function Begleitdokument({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const species: 'cattle' | 'sheep' = speciesOf(moduleKey) === 'sheep' ? 'sheep' : 'cattle'
  const [params] = useSearchParams()
  const [ids, setIds] = useState<string[]>(() => (params.get('tiere') ?? params.get('tier') ?? '').split(',').filter(Boolean))
  const [date, setDate] = useState(localTodayIso)
  const { data } = useQuery((pg) => loadPage(pg, ids, species, date), [ids.join(','), species, date])
  const stored = useMemo(storedHolder, [])
  const [holder, setHolder] = useState<BdHolder>({ tvd: stored.tvd ?? '', name: stored.name ?? '', address: stored.address ?? '', place: stored.place ?? '' })
  const [signer, setSigner] = useState(stored.signer ?? '')
  const [place, setPlace] = useState(stored.place ?? '')
  const [purpose, setPurpose] = useState<Purpose | null>(null)
  const [destination, setDestination] = useState('')
  const [diseaseFree, setDiseaseFree] = useState(true)
  // Angaben je Tier, die FMIS nicht sicher weiss (Trächtigkeit, kastriert)
  const [overrides, setOverrides] = useState<Record<string, Partial<BdAnimal>>>({})
  const [templates, setTemplates] = useState<TierDocument[]>(() => storedDocuments())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ tags: string; count: number } | null>(null)
  // ?dokument=<id> (TVD → Abgänge → ✎ «PDF erneut»): Angaben eines erfassten Dokuments übernehmen,
  // PDF nochmals erstellen, ohne einen zweiten Abgang zu erfassen
  const docId = params.get('dokument')
  const [again, setAgain] = useState<string | null>(null)
  useEffect(() => {
    if (!docId) return
    void loadMovementDocs(db, '1900-01-01').then((docs) => {
      const d = docs.find((x) => x.id === docId)
      if (!d) return notifyError('Begleitdokument nicht gefunden.')
      setIds(d.animals.map((a) => a.id))
      setDate(d.doc_date)
      setPurpose(d.purpose)
      setDestination(d.destination ?? '')
      setAgain(d.doc_date)
    })
  }, [db, docId])

  useEffect(() => {
    void farmHolder().then((f) =>
      setHolder((h) => ({ tvd: h.tvd || f.tvd || '', name: h.name || f.name || '', address: h.address || f.address || '', place: h.place || f.place || '' })),
    )
    loadDocuments()
      .then((list) => {
        setTemplates(list)
        // gleich auf dieses Gerät holen, damit es auch ohne Netz geht
        for (const d of [findForm(list, 'begleitdokument_klauentiere'), findForm(list, 'tierliste_klauentiere')].filter((x): x is TierDocument => !!x)) void fetchFile(d.id).catch(() => undefined)
      })
      .catch(() => undefined)
  }, [])

  const begleit = findForm(templates, 'begleitdokument_klauentiere')
  const tierliste = findForm(templates, 'tierliste_klauentiere')
  const animals: BdAnimal[] = useMemo(() => (data?.chosen ?? []).map((a) => ({ ...a, ...overrides[a.id] })), [data, overrides])
  const health = healthSummary(animals)
  const input: BdData = { species, date, holder, destination, purpose, diseaseFree, animals, place: place || holder.place.replace(/^\d{4}\s*/, ''), signer: signer || holder.name }
  const problems = [...bdProblems(input), ...(!begleit ? ['Vorlage Begleitdokument fehlt (siehe unten).'] : []), ...(animals.length > 3 && !tierliste ? ['Vorlage Tierliste fehlt (mehr als 3 Tiere).'] : [])]

  async function create() {
    if (!begleit || problems.length) return
    setBusy(true)
    try {
      const [b, t] = await Promise.all([fetchFile(begleit.id).then((x) => x.arrayBuffer()), tierliste ? fetchFile(tierliste.id).then((x) => x.arrayBuffer()) : Promise.resolve(null)])
      const pdf = await buildPdf(input, { begleit: b, tierliste: t })
      save(`Begleitdokument_${date}_${animals.length}_Tiere.pdf`, pdf)
      try {
        localStorage.setItem(HOLDER_KEY, JSON.stringify({ ...holder, signer, place }))
      } catch {
        /* Speicher gesperrt */
      }
      if (again) {
        notifySuccess('PDF erneut erstellt — der Abgang war schon erfasst')
        return
      }
      await undoAction(`Begleitdokument ${fmtDay(date)}, ${animals.length} Tiere`, () => saveMovementDoc(db, input, getCurrentUserEmail()))
      setDone({ tags: tagList({ animals }), count: animals.length })
      notifySuccess('Begleitdokument erstellt — ausdrucken, unterschreiben')
    } catch (e) {
      notifyError(errorText(e, 'Begleitdokument nicht erstellt'))
    } finally {
      setBusy(false)
    }
  }

  const patchO = (id: string, p: Partial<BdAnimal>) => setOverrides((o) => ({ ...o, [id]: { ...o[id], ...p } }))

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 pb-24">
      <h1 className="text-xl font-bold text-gray-900">Begleitdokument</h1>
      <p className="text-sm text-gray-700">
        Papierformular des BLV für Klauentiere, z.B. wenn die TVD nicht geht. FMIS füllt aus, was es weiss; ausdrucken, unterschreiben, Original mit den Tieren mitgeben, Kopie 2 drei Jahre aufbewahren.
      </p>
      {again && (
        <p className="rounded-lg border-2 border-brand-700 bg-brand-50 p-3 text-sm text-brand-900">
          PDF erneut erstellen: Angaben vom Begleitdokument {fmtDay(again)} übernommen. Der Abgang ist schon erfasst und wird nicht nochmals als Pendenz angelegt.
        </p>
      )}

      {done && (
        <section className="space-y-2 rounded-lg border-2 border-green-700 bg-green-50 p-3 text-sm text-green-950">
          <p className="font-semibold">Erstellt. Abgang später in der TVD melden ({done.count} Tiere).</p>
          <p>Die Pendenz steht auf «Heute» und unter TVD, bis du sie abhakst. Nummern zum Einfügen:</p>
          <textarea readOnly value={done.tags} rows={Math.min(8, done.count)} className="w-full rounded border border-green-300 bg-white p-2 font-mono text-sm" onFocus={(e) => e.target.select()} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(done.tags).then(() => notifySuccess('Nummern kopiert'), () => notifyError('Kopieren nicht möglich — Feld antippen und von Hand kopieren'))}
              className="min-h-11 rounded-lg bg-green-800 px-4 font-semibold text-white"
            >
              ⧉ Nummern kopieren
            </button>
            <Link to="../tvd#abgaenge" relative="path" className="inline-flex min-h-11 items-center rounded-lg border-2 border-green-800 px-4 font-semibold text-green-900">
              Zu den TVD-Meldungen
            </Link>
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-lg bg-white p-3 shadow-sm" aria-label="Tiere">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-gray-900">Tiere ({animals.length})</h2>
          {animals.length > 3 && <span className="text-xs text-gray-600">mit Tierliste ({Math.ceil(animals.length / 10)} Blatt)</span>}
        </div>
        <AnimalPicker animals={data?.animals ?? []} selected={ids} onChange={setIds} multiple hideSelected readerModule={moduleKey} />
        <ul className="divide-y text-sm">
          {animals.map((a) => (
            <li key={a.id} className="space-y-1 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-gray-900">{a.lauf_nr ? `${a.lauf_nr} · ` : ''}{animalLabel({ ear_tag: a.ear_tag, name: a.name })}</span>
                  {species === 'cattle' && (
                    <span className="ml-1 text-xs text-gray-600">
                      {a.birth_date ? `${a.birth_date.slice(5, 7)}/${a.birth_date.slice(0, 4)}` : ''} {a.sex === 'w' ? '♀' : a.sex === 'm' ? (a.castrated ? 'k' : '♂') : '?'}
                    </span>
                  )}
                </span>
                {species === 'cattle' && a.sex === 'm' && (
                  <button type="button" aria-pressed={!!a.castrated} onClick={() => patchO(a.id, { castrated: !a.castrated })} className={`min-h-11 rounded-lg px-2 text-xs ${a.castrated ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'}`}>
                    kastriert
                  </button>
                )}
                <button type="button" onClick={() => setIds(ids.filter((x) => x !== a.id))} aria-label={`${shortEarTag(a.ear_tag)} entfernen`} className="min-h-11 shrink-0 px-2 text-red-700">
                  ✕
                </button>
              </div>
              {a.pregnancyNeeded && (
                <div className="flex items-center gap-2 text-xs">
                  <span className={a.pregnant ? 'text-gray-600' : 'font-semibold text-amber-800'}>Trächtig?</span>
                  {(['ja', 'nein'] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={a.pregnant === v} onClick={() => patchO(a.id, { pregnant: v })} className={`min-h-11 rounded-lg px-3 ${a.pregnant === v ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}>
                      {v}
                    </button>
                  ))}
                </div>
              )}
              {(a.sick.length > 0 || a.withdrawal) && (
                <p className="text-xs text-red-800">
                  {a.sick.length > 0 && `🤒 letzte 10 Tage: ${a.sick.join(', ')}. `}
                  {a.withdrawal && `💊 Absetzfrist Fleisch bis ${fmtDay(a.withdrawal.until)}${a.withdrawal.medication ? ` (${a.withdrawal.medication})` : ''}.`}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm" aria-label="Herkunftsbetrieb">
        <h2 className="font-semibold text-gray-900">1. Herkunftsbetrieb</h2>
        <label className="block text-gray-700">
          TVD-Nr.
          <input className={field} inputMode="numeric" value={holder.tvd} onChange={(e) => setHolder({ ...holder, tvd: e.target.value.replace(/\D/g, '').slice(0, 7) })} />
        </label>
        <label className="block text-gray-700">
          Name, Vorname
          <input className={field} value={holder.name} onChange={(e) => setHolder({ ...holder, name: e.target.value })} />
        </label>
        <label className="block text-gray-700">
          Adresse
          <input className={field} value={holder.address} onChange={(e) => setHolder({ ...holder, address: e.target.value })} />
        </label>
        <label className="block text-gray-700">
          PLZ, Wohnort
          <input className={field} value={holder.place} onChange={(e) => setHolder({ ...holder, place: e.target.value })} />
        </label>
        <p className="text-xs text-gray-600">
          Vorbelegt aus <Link to="/betrieb/betriebsdaten" className="text-brand-700 underline">Betriebsdaten</Link> (TVD-Betriebsnummer) bzw. vom letzten Mal.
        </p>
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm" aria-label="Bestimmung">
        <h2 className="font-semibold text-gray-900">3. Bestimmungsort, Zweck</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {PURPOSES.map((p) => (
            <button key={p.key} type="button" aria-pressed={purpose === p.key} onClick={() => setPurpose(p.key)} className={`min-h-11 rounded-lg border-2 px-2 text-left ${purpose === p.key ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-900'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="block text-gray-700">
          Name und Adresse Käufer, Händler, Schlachtbetrieb, Markt
          <input className={field} list="begleit-ziele" value={destination} onChange={(e) => setDestination(e.target.value)} />
          <datalist id="begleit-ziele">
            {(data?.destinations ?? []).map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm" aria-label="Bestätigungen">
        <h2 className="font-semibold text-gray-900">4.–5. Bestätigungen</h2>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={diseaseFree} onChange={(e) => setDiseaseFree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
          Der Betrieb ist keinen seuchenpolizeilichen Massnahmen unterworfen.
        </label>
        {!diseaseFree && <p className="rounded bg-red-50 p-2 text-red-900">Dann stellt der amtliche Tierarzt ein spezielles Begleitdokument aus.</p>}
        <p className={health.healthy ? 'text-gray-700' : 'font-semibold text-red-800'}>
          {health.healthy ? '☑ Alle Tiere nicht krank, verletzt oder verunfallt (Journal der letzten 10 Tage).' : `☐ Krank/verletzt in den letzten 10 Tagen: ${health.illness || 'siehe Journal'} — wird unter Punkt 5 eingetragen.`}
        </p>
        <p className={health.noWithdrawal ? 'text-gray-700' : 'font-semibold text-red-800'}>
          {health.noWithdrawal ? '☑ Keine offene Absetzfrist (Fleisch).' : `☐ Offene Absetzfrist Fleisch: ${health.medication || 'Medikament'} — wird unter Punkt 5 eingetragen.`}
        </p>
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm" aria-label="Unterschrift">
        <h2 className="font-semibold text-gray-900">6. Ort, Datum, Name</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-gray-700">
            Ort
            <input className={field} value={place} placeholder={holder.place.replace(/^\d{4}\s*/, '')} onChange={(e) => setPlace(e.target.value)} />
          </label>
          <label className="block text-gray-700">
            Datum
            <input type="date" className={field} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        </div>
        <label className="block text-gray-700">
          Name (wird in Blockschrift gesetzt)
          <input className={field} value={signer} placeholder={holder.name} onChange={(e) => setSigner(e.target.value)} />
        </label>
        <p className="text-xs text-gray-600">Punkt 7 (Fahrzeiten, Kontrollschild) füllt der Fahrer von Hand aus. Unterschrift von Hand.</p>
      </section>

      {(!begleit || (animals.length > 3 && !tierliste)) && (
        <section className="space-y-1 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Leere Formulare einmal hinterlegen</p>
          <p>
            Die ausfüllbaren PDF «Begleitdokument für Klauentiere» und «Tierliste – Beilage» beim{' '}
            <a href={FORM_SOURCE} target="_blank" rel="noreferrer" className="underline">
              BLV (Tiertransporte)
            </a>{' '}
            herunterladen und unter{' '}
            <Link to="/tiere/merkblaetter" className="font-semibold underline">
              Tiergruppen → Merkblätter
            </Link>{' '}
            hineinziehen oder den Link einfügen – FMIS erkennt die Formulare selbst. Danach gehen sie auch ohne Netz.
          </p>
        </section>
      )}

      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <button type="button" disabled={busy || problems.length > 0} onClick={() => void create()} className="min-h-12 w-full rounded-lg bg-brand-700 text-base font-semibold text-white disabled:opacity-40">
        {busy ? 'Erstellt…' : `📄 ${again ? 'PDF erneut erstellen' : 'Begleitdokument erstellen'} (PDF${animals.length > 3 ? ' mit Tierliste' : ''})`}
      </button>
    </div>
  )
}
