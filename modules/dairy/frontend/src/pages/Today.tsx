import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { shortEarTag } from '@fmis/core/earTag'
import { SessionUndoList } from '@fmis/core/UndoBar'
import { useQuery } from '../hooks/useQuery'
import { loadToday, type TodayAnimal } from '../lib/today'
import { fmtDate, localTodayIso } from '../lib/format'
import { speciesOf } from '../lib/species'

const who = (a: TodayAnimal) => `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}${a.name ? ` ${a.name}` : ''}`

/** Laufende Durchgänge dieses Geräts (Trächtigkeit, Klauen — localStorage der Erfassungsseiten). */
function runningRound(key: string): { date?: string; examiner?: string | null } | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as { date?: string; examiner?: string | null } | null
  } catch {
    return null
  }
}

// Links relativ zur Modulwurzel (diese Seite IST die Wurzel /<modul>)

/** Startseite für den Stall: was heute ansteht, die häufigsten Wege und die
 * letzten Schritte dieser Sitzung. Die Auswertung «Leistung» hat eine eigene Seite. */
export default function Today({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const sheep = species === 'sheep'
  const today = localTodayIso()
  const { data } = useQuery((pg) => loadToday(pg, species, today), [species, today])
  const word = sheep ? { birth: 'Ablammungen', young: 'Lämmer' } : { birth: 'Abkalbungen', young: 'Kälber' }
  const pregnancy = runningRound(`fmis_${moduleKey}_pregnancy_round`)
  const claws = runningRound(`fmis_${moduleKey}_claw_round`)

  const todo: ReactNode[] = []
  if (data?.openBank) {
    todo.push(
      <Row key="bank" to="milchwaegung" icon="⚖️" title={`Milchwägung läuft: Bank ${data.openBank.bank_number}`} detail={`${fmtDate(data.openBank.session_date)} · ${data.openBank.slots} Tiere aufgenommen`} />,
    )
  }
  if (pregnancy) todo.push(<Row key="preg" to="traechtigkeit" icon="🤰" title="Trächtigkeits-Durchgang läuft" detail={[pregnancy.date && fmtDate(pregnancy.date), pregnancy.examiner].filter(Boolean).join(' · ')} />)
  if (claws) todo.push(<Row key="claw" to="klauen" icon="🐾" title="Klauen-Durchgang läuft" detail={[claws.date && fmtDate(claws.date), claws.examiner].filter(Boolean).join(' · ')} />)
  if (data && data.pendingEarTags > 0) {
    todo.push(<Row key="tags" to="ohrmarken" icon="🏷️" title={`${data.pendingEarTags} ${data.pendingEarTags === 1 ? (sheep ? 'Lamm' : 'Kalb') : word.young} ohne Ohrmarke`} detail="nachtragen" badge={data.pendingEarTags} />)
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Heute, {fmtDate(today)}</h1>

      <div className="grid grid-cols-2 gap-3">
        <Link to="erfassen" className="flex min-h-20 flex-col items-center justify-center rounded-xl bg-brand-700 p-3 text-white shadow-sm active:bg-brand-800">
          <span className="text-2xl">✏️</span>
          <span className="font-semibold">Erfassen</span>
        </Link>
        <Link to="tierinfo" className="flex min-h-20 flex-col items-center justify-center rounded-xl bg-white p-3 text-gray-900 shadow-sm active:bg-gray-50">
          <span className="text-2xl">🔎</span>
          <span className="font-semibold">Tier-Info</span>
        </Link>
      </div>

      {todo.length > 0 && (
        <Section title="Offen">
          <ul className="divide-y rounded-xl bg-white shadow-sm">{todo}</ul>
        </Section>
      )}

      {data && data.withdrawals.length > 0 && (
        <Section title={`Absetzfrist Milch (${data.withdrawals.length})`}>
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {data.withdrawals.map((w) => (
              <Row key={w.id} to={`kuehe/${w.id}#journal`} icon="🚫" title={who(w)} detail={`Milch nicht abliefern bis und mit ${fmtDate(w.until)}`} tone="red" />
            ))}
          </ul>
        </Section>
      )}

      {data && data.expected.length > 0 && (
        <Section title={`${word.birth} erwartet, nächste 14 Tage (${data.expected.length})`}>
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {data.expected.map((e) => (
              <Row
                key={e.animal.id}
                to={`tierinfo?tier=${e.animal.id}`}
                icon={e.to < today ? '⏰' : '📅'}
                title={who(e.animal)}
                detail={`${e.from === e.to ? fmtDate(e.from) : `${fmtDate(e.from)} – ${fmtDate(e.to)}`}${e.to < today ? ' · überfällig' : ''} (aus der Belegung)`}
              />
            ))}
          </ul>
        </Section>
      )}

      {data && data.markedLists.length > 0 && (
        <Section title="Merklisten mit Markierungen">
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {data.markedLists.map((l) => (
              <Row key={l.id} to="merklisten" icon="🔖" title={l.name} detail={`${l.marked} markiert · ${l.open} offen`} />
            ))}
          </ul>
        </Section>
      )}

      {data && todo.length === 0 && data.withdrawals.length === 0 && data.expected.length === 0 && (
        <p className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm">Nichts Offenes. 👍</p>
      )}

      <SessionUndoList source={moduleKey} title="Zuletzt gespeichert (diese Sitzung)" />

      <Section title="Weitere Seiten">
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ['leistung', '🥛', 'Leistung'],
            ['milchwaegung', '⚖️', 'Milchwägung'],
            ['ausmerzen', '📋', 'Ausmerzliste'],
            ['merklisten', '🔖', 'Merklisten'],
          ].map(([to, icon, label]) => (
            <Link key={to} to={to} className="flex min-h-12 items-center gap-2 rounded-lg bg-white px-3 font-medium text-gray-800 shadow-sm active:bg-gray-50">
              <span aria-hidden>{icon}</span>
              {label}
            </Link>
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      {children}
    </section>
  )
}

function Row({ to, icon, title, detail, badge, tone }: { to: string; icon: string; title: string; detail?: string; badge?: number; tone?: 'red' }) {
  return (
    <li>
      <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-2 active:bg-gray-50">
        <span className="text-xl" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block font-medium ${tone === 'red' ? 'text-red-800' : 'text-gray-900'}`}>{title}</span>
          {detail && <span className="block text-sm text-gray-600">{detail}</span>}
        </span>
        {badge != null && <span className="shrink-0 rounded-full bg-amber-700 px-2.5 py-1 text-sm font-bold text-white">{badge}</span>}
        <span className="text-gray-500" aria-hidden>
          ›
        </span>
      </Link>
    </li>
  )
}
