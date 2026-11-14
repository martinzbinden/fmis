import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, localTodayIso } from '../lib/format'
import { speciesOf, speciesTerms } from '../lib/species'
import { loadRules } from '../lib/stallRules'
import { ageDays, COLUMNS, deadlineDays, deadlineTone, lambFields, lambState, loadTvdBirths, markReported, reportable, toCsv, toTabText, type TvdBirth } from '../lib/tvdBirths'

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    notifySuccess(`${what} kopiert`)
  } catch {
    notifyError('Kopieren nicht möglich (Browser-Berechtigung)')
  }
}

const TONE = { over: 'border-red-500', soon: 'border-amber-400', ok: 'border-transparent' } as const

/** Geburtsmeldungen an die TVD vorbereiten: je Nachkomme die Angaben für das Agate-Portal, zum Kopieren oder als CSV,
 * dazu Abhaken nach dem Melden. FMIS sendet nichts an die TVD. */
export default function TvdBirths({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const terms = speciesTerms(moduleKey)
  const young = species === 'sheep' ? 'Lamm' : 'Kalb'
  const youngPl = species === 'sheep' ? 'Lämmer' : 'Kälber'
  const db = useDb()
  const today = localTodayIso()
  const deadline = deadlineDays(species)
  const [tab, setTab] = useState<'offen' | 'gemeldet'>('offen')
  const { data } = useQuery((pg) => loadTvdBirths(pg, addDays(today, -120), species, loadRules(moduleKey, species).vaterGewaehlt === 1))

  const { open, done } = useMemo(() => {
    const all = data ?? []
    return {
      open: all.filter((b) => b.offspring.some((l) => ['offen', 'ohne_marke'].includes(lambState(l)))),
      done: all.filter((b) => !b.offspring.some((l) => ['offen', 'ohne_marke'].includes(lambState(l)))),
    }
  }, [data])
  const ready = open.reduce((n, b) => n + reportable(b).length, 0)

  async function mark(ids: string[], date: string | null) {
    try {
      await markReported(db, ids, date)
      notifySuccess(date ? 'Als gemeldet abgehakt' : 'Markierung zurückgenommen')
    } catch (e) {
      notifyError(errorText(e, 'Speichern fehlgeschlagen'))
    }
  }

  const list = tab === 'offen' ? open : done
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">TVD-Geburtsmeldungen</h1>
        <Link to="../geburt" relative="path" className="min-h-11 shrink-0 content-center rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-medium text-gray-800">
          + {terms.calving}
        </Link>
      </div>
      <p className="text-sm text-gray-600">
        FMIS meldet nicht selbst an die TVD. Hier stehen die Angaben je {young} für die Meldung im Agate-Portal (Neue Meldung → Geburtsmeldung). Danach «Gemeldet» abhaken. Frist {deadline} Tage nach der Geburt.
        Rasse wie im Bestand erfasst; Farbe und Abzeichen trägst du im Portal ein.
      </p>

      <div className="flex gap-2" role="tablist">
        {(
          [
            ['offen', `Offen (${open.length})`],
            ['gemeldet', `Gemeldet (${done.length})`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 rounded-lg px-4 text-sm font-medium ${tab === k ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'offen' && ready > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy(toTabText(open), `${ready} Zeilen`)} className="min-h-11 rounded-lg border-2 border-brand-700 bg-white px-3 text-sm font-medium text-brand-800">
            Alle offenen kopieren ({ready})
          </button>
          <button type="button" onClick={() => download(`TVD-Geburten-${today}.csv`, toCsv(open))} className="min-h-11 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-medium text-gray-800">
            CSV herunterladen
          </button>
        </div>
      )}

      {data && list.length === 0 && (
        <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">{tab === 'offen' ? 'Nichts zu melden. 👍' : 'Noch nichts als gemeldet abgehakt.'}</p>
      )}

      {list.map((b) => (
        <BirthCard key={b.id} b={b} today={today} deadline={deadline} young={young} youngPl={youngPl} onMark={mark} />
      ))}
      <p className="text-xs text-gray-500">
        Es erscheinen nur {terms.calving}en, die hier in FMIS erfasst wurden (nicht der Herdebuch-Import), der letzten 120 Tage und alles, was noch offen ist. Spalten der Kopie: {COLUMNS.join(', ')}.
      </p>
    </div>
  )
}

function BirthCard({
  b,
  today,
  deadline,
  young,
  youngPl,
  onMark,
}: {
  b: TvdBirth
  today: string
  deadline: number
  young: string
  youngPl: string
  onMark: (ids: string[], date: string | null) => Promise<void>
}) {
  const age = ageDays(b.birth_date, today)
  const ready = reportable(b)
  const reportedIds = b.offspring.filter((l) => lambState(l) === 'gemeldet').map((l) => l.id)
  const noTag = b.offspring.filter((l) => lambState(l) === 'ohne_marke').length
  const tone = ready.length > 0 ? TONE[deadlineTone(age, deadline)] : 'border-transparent'
  return (
    <div className={`space-y-2 rounded-lg border-2 bg-white p-3 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-900">
          {fmtDate(b.birth_date)} · Mutter {b.dam_lauf_nr ?? shortEarTag(b.dam_ear_tag)}
          {b.dam_lauf_nr && <span className="ml-1 text-xs font-normal text-gray-600">{shortEarTag(b.dam_ear_tag)}</span>}
        </span>
        <span className="text-xs text-gray-600">
          {b.litter > 1 ? `${b.litter} ${youngPl} im Wurf` : 'Einling'} · Vater {b.sire ? shortEarTag(b.sire) : 'unbekannt'}
          {b.sireDoubt && (
            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900" title="Keine passende Belegung zur Tragzeit erfasst: Vater wird als «unbekannt» gemeldet">
              ⚠ Vater unklar, wird als «unbekannt» gemeldet
            </span>
          )}
        </span>
      </div>
      {ready.length > 0 && (
        <p className={`text-xs ${age > deadline ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
          {age > deadline ? `Frist überschritten (${age} Tage seit der Geburt)` : `Tag ${age} von ${deadline}`}
        </p>
      )}
      <ul className="divide-y divide-gray-100 text-sm">
        {b.offspring.map((l) => {
          const st = lambState(l)
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="text-gray-900">
                {l.ear_tag ? shortEarTag(l.ear_tag) : `${young} ohne Ohrmarke`} · {l.sex === 'w' ? '♀' : l.sex === 'm' ? '♂' : '?'}
                {l.breed && <span className="ml-1 text-xs text-gray-600">{l.breed}</span>}
                {l.stillborn && <span className="ml-1 rounded bg-gray-200 px-1.5 text-xs">Totgeburt</span>}
              </span>
              <span className="text-xs text-gray-600">
                {st === 'gemeldet' && `gemeldet ${fmtDate(l.reportedOn)}`}
                {st === 'ohne_marke' && (
                  <Link to="../ohrmarken" relative="path" className="font-medium text-brand-700">
                    Ohrmarke nachtragen →
                  </Link>
                )}
                {st === 'nicht_noetig' && 'vor der Ohrmarke verendet, meist keine Meldung'}
                {st === 'offen' && (
                  <button type="button" onClick={() => void copy([COLUMNS.join('\t'), lambFields(b, l).join('\t')].join('\n'), 'Zeile')} className="min-h-9 rounded border border-gray-300 px-2 text-gray-800">
                    Zeile kopieren
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {noTag > 0 && ready.length > 0 && <p className="text-xs text-amber-800">{noTag} {noTag === 1 ? young : youngPl} ohne Ohrmarke: erst nach dem Nachtragen meldbar.</p>}
      <div className="flex flex-wrap gap-2">
        {ready.length > 0 && (
          <>
            <button type="button" onClick={() => void copy(toTabText([b]), `${ready.length} ${ready.length === 1 ? 'Zeile' : 'Zeilen'}`)} className="min-h-11 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-medium text-gray-800">
              Wurf kopieren
            </button>
            <button type="button" onClick={() => void onMark(ready.map((l) => l.id), today)} className="min-h-11 rounded-lg bg-brand-700 px-3 text-sm font-medium text-white">
              Als gemeldet abhaken
            </button>
          </>
        )}
        {ready.length === 0 && reportedIds.length > 0 && (
          <button type="button" onClick={() => void onMark(reportedIds, null)} className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700">
            Abhaken zurücknehmen
          </button>
        )}
      </div>
    </div>
  )
}
