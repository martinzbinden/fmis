import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { animalKey, animalLabel, shortEarTag } from '@fmis/core/earTag'
import { useQuery } from '../hooks/useQuery'
import { loadInbreeding } from '../lib/pedigreeData'
import { loadSireOptions, sireLabel, type SireOption } from '../lib/sires'
import { speciesOf, speciesTerms } from '../lib/species'
import { InbreedingBadge } from './AnimalDetail'
import type { Animal } from '../types'

async function loadData(pg: PGlite) {
  const [females, sires, inbreeding] = await Promise.all([
    pg.query<Animal>(
      "select * from animals where deleted_at is null and status = 'aktiv' and coalesce(sex, 'w') = 'w' order by lauf_nr nulls last, ear_tag",
    ),
    loadSireOptions(pg),
    loadInbreeding(pg),
  ])
  return { females: females.rows, sires, inbreeding }
}

/** Anpaarungsplaner: erwartete Inzucht der Nachkommen für jede Kombination
 * weibliches Tier × Widder/Stier, dazu die Stammbaumtiefe beider Seiten —
 * ein tiefer Wert bei flachem Stammbaum heisst nur "nichts Gemeinsames
 * bekannt". */
export default function MatingPlanner({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const terms = speciesTerms(moduleKey)
  const maleWord = species === 'sheep' ? 'Widder' : 'Stiere'
  const { data } = useQuery(loadData)
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [extra, setExtra] = useState<SireOption[]>([])
  const [newSire, setNewSire] = useState('')
  const [filter, setFilter] = useState('')

  const allSires = useMemo(() => [...(data?.sires ?? []), ...extra], [data, extra])
  // Vorauswahl: die zuletzt eingesetzten (höchstens sechs).
  const selectedKeys = chosen ?? allSires.slice(0, 6).map((s) => s.key)
  const columns = allSires.filter((s) => selectedKeys.includes(s.key))
  const females = (data?.females ?? []).filter((a) => {
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return `${a.lauf_nr ?? ''} ${animalLabel(a)} ${a.ear_tag}`.toLowerCase().includes(q)
  })

  function toggle(key: string) {
    setChosen(selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key])
  }

  function addSire() {
    const key = animalKey(newSire)
    if (!key) return
    if (!allSires.some((s) => s.key === key)) setExtra((e) => [...e, { key, ear_tag: newSire.trim(), name: null, lastUsed: null }])
    setChosen([...selectedKeys.filter((k) => k !== key), key])
    setNewSire('')
  }

  const inb = data?.inbreeding
  const fmtGen = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1 })

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Anpaarungsplaner</h1>
      <p className="text-xs text-gray-500">
        Erwartete Inzucht der Nachkommen je {terms.singular} und {species === 'sheep' ? 'Widder' : 'Stier'}. Ab 6.25 % rot
        (entspricht einer Cousin-Paarung), ab 3.1 % gelb. Unbekannte Vorfahren gelten als unverwandt — «Gen.» zeigt, wie
        viele vollständige Generationen bekannt sind; bei weniger als 2–3 ist der Wert eher zu tief.
      </p>

      <div className="space-y-2 rounded-lg bg-white p-4 shadow-sm print:hidden">
        <div className="text-sm text-gray-600">{maleWord}</div>
        <div className="flex flex-wrap gap-1.5">
          {allSires.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              className={`rounded-full px-3 py-1 text-sm ${selectedKeys.includes(s.key) ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              {sireLabel(s)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newSire}
            onChange={(e) => setNewSire(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSire()}
            placeholder={`weiteren ${species === 'sheep' ? 'Widder' : 'Stier'} per Ohrmarke/ID`}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="button" onClick={addSire} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            Hinzufügen
          </button>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`${terms.plural} filtern (Laufnummer, Name, Ohrmarke)`}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {!data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && inb && columns.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="sticky left-0 bg-white px-3 py-2">{terms.singular}</th>
                <th className="px-2 py-2 text-right">Gen.</th>
                {columns.map((s) => (
                  <th key={s.key} className="px-2 py-2 text-center">
                    <div className="font-semibold text-gray-700">{s.name ?? shortEarTag(s.ear_tag)}</div>
                    <div className="font-normal">Gen. {fmtGen(inb.completeness(s.key))}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {females.map((a) => {
                const key = animalKey(a.ear_tag)!
                const values = columns.map((s) => inb.offspring(key, s.key))
                const best = Math.min(...values)
                return (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1.5">
                      <Link to={`../kuehe/${a.id}`} relative="path" className="text-gray-800">
                        {a.lauf_nr && <span className="mr-1.5 font-bold">{a.lauf_nr}</span>}
                        {animalLabel(a)}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs text-gray-500">{fmtGen(inb.completeness(key))}</td>
                    {values.map((f, i) => (
                      <td key={columns[i].key} className={`px-2 py-1.5 text-center ${f === best && values.length > 1 ? 'bg-green-50' : ''}`}>
                        <InbreedingBadge f={f} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && columns.length === 0 && <p className="text-center text-sm text-gray-500">Oben mindestens einen {species === 'sheep' ? 'Widder' : 'Stier'} wählen.</p>}
    </div>
  )
}
