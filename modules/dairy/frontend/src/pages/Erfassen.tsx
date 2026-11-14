import { Link } from 'react-router-dom'
import { speciesOf } from '../lib/species'
import { useQuery } from '../hooks/useQuery'
import { loadPendingOffspring } from '../lib/earTagPending'
import { loadTvdBirths, reportable } from '../lib/tvdBirths'
import { loadLambs, WEAN_FROM_DAYS } from '../lib/lambs'
import { localTodayIso } from '../lib/format'

export default function Erfassen({ moduleKey }: { moduleKey: string }) {
  const sheep = speciesOf(moduleKey) === 'sheep'
  const pending = useQuery(loadPendingOffspring).data?.length ?? 0
  const tvdOpen = useQuery((pg) => loadTvdBirths(pg, '2000-01-01')).data?.reduce((n, b) => n + reportable(b).length, 0) ?? 0
  const weanDue = useQuery((pg) => loadLambs(pg, localTodayIso())).data?.filter((l) => l.nursing && l.ageDays >= WEAN_FROM_DAYS).length ?? 0
  const items = [
    { to: 'leistung', icon: '🥛', label: 'Leistung', desc: 'Milchleistung und Zuchtwerte, je Tier und Gruppe' },
    { to: 'tierinfo', icon: '🔎', label: 'Tier-Info', desc: 'Nummer tippen oder lesen: Alter, Abstammung, Index, Ablammung, Belegung, Trächtigkeit, Merklisten, Verlauf aller Erfassungen' },
    { to: 'geburt', icon: sheep ? '🐑' : '🐄', label: sheep ? 'Ablammung' : 'Abkalbung', desc: 'Mutter, Vater, Nachkommen – Ohrmarke auch später' },
    { to: 'ohrmarken', icon: '🏷️', label: 'Ohrmarken nachtragen', desc: sheep ? 'Lämmer, die bei der Ablammung noch keine Ohrmarke hatten' : 'Kälber, die bei der Abkalbung noch keine Ohrmarke hatten' },
    { to: 'tvd', icon: '📨', label: 'TVD-Geburtsmeldungen', desc: sheep ? 'Angaben je Lamm für die Meldung im Agate-Portal, kopieren oder als CSV, Abhaken' : 'Angaben je Kalb für die Meldung im Agate-Portal, kopieren oder als CSV, Abhaken' },
    { to: 'laemmer?aktion=absetzen', icon: '✂️', label: 'Absetzen', desc: sheep ? `Saugende Lämmer ab ${WEAN_FROM_DAYS} Tagen wählen, in eine Lämmergruppe zügeln` : `Saugende Kälber ab ${WEAN_FROM_DAYS} Tagen wählen` },
    { to: 'laemmer', icon: '🍼', label: sheep ? 'Lämmer' : 'Kälber', desc: 'Alter, Gewicht, saugend oder abgesetzt – wägen, Schoppen, Drenchen, Bolus, Behandlung für mehrere auf einmal' },
    { to: 'belegung', icon: '❤️', label: sheep ? 'Belegung' : 'Besamung / Belegung', desc: sheep ? 'Widder und Zeitraum, für die ganze Gruppe' : 'Stier und Datum' },
    { to: 'traechtigkeit', icon: '🤰', label: 'Trächtigkeit', desc: 'Einzeln oder mehrere Tiere (+ / Lesegerät), ja/leer/unsicher, Wochen' },
    { to: 'klauen', icon: '🐾', label: 'Klauen', desc: sheep ? 'Moderhinke-Score je Fuss, lahm, geschnitten, Behandlung – im Durchgang, mit Lesegerät' : 'Befunde nach ICAR-Atlas, Lahmheit 1–5, geschnitten, Behandlung' },
    { to: 'journal', icon: '💉', label: 'Beobachtung / Behandlung', desc: 'Krankheit, Behandlung mit Absetzfrist, Brunst, Klauen' },
    { to: 'milchwaegung', icon: '⚖️', label: 'Milchwägung', desc: 'Melkreihenfolge für die Probenahme (Lesegerät oder von Hand)' },
    { to: 'ausmerzen', icon: '📋', label: 'Ausmerzliste', desc: 'Tiere mit Gründen zum Ausmerzen: Fruchtbarkeit, Euter, Leistung, Klauen' },
    { to: 'behandlungen', icon: '📒', label: 'Behandlungsjournal', desc: 'Tierarzneimittel für die Kontrolle: Liste, Absetzfristen, Druck, Favoriten, cownect-Import' },
    { to: 'selektion', icon: '⭐', label: sheep ? 'Lämmer-Selektion' : 'Kälber-Selektion', desc: 'Remonte oder Mast nach Mutterleistung, Vater und Inzucht' },
    { to: 'merklisten', icon: '🔖', label: 'Merklisten', desc: 'Tiere vormerken, z.B. «Ausmerzen prüfen» – auch aus Warnungen bei der Erfassung' },
    { to: 'gruppen', icon: '📊', label: 'Gruppen', desc: 'Tiergruppen und Merklisten vergleichen: Leistung + Zuchtwert, Schlachterlös, Fortpflanzung, Klauen – beliebige Gruppen nebeneinander' },
    { to: 'anpaarung', icon: '🧬', label: 'Anpaarung planen', desc: 'Erwartete Inzucht je Mutter × ' + (sheep ? 'Widder' : 'Stier') },
  ]
  return (
    <div className="mx-auto max-w-lg space-y-3 p-4 pb-24">
      <h1 className="mb-2 text-xl font-bold text-gray-800">Mehr</h1>
      {items.map((item) => (
        <Link key={item.to} to={`../${item.to}`} relative="path" className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm active:bg-gray-50">
          <span className="text-3xl">{item.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-gray-800">{item.label}</span>
            <span className="block text-sm text-gray-500">{item.desc}</span>
          </span>
          {item.to === 'ohrmarken' && pending > 0 && (
            <span className="shrink-0 rounded-full bg-amber-700 px-2.5 py-1 text-sm font-bold text-white" aria-label={`${pending} offen`}>
              {pending}
            </span>
          )}
          {item.to === 'tvd' && tvdOpen > 0 && (
            <span className="shrink-0 rounded-full bg-amber-700 px-2.5 py-1 text-sm font-bold text-white" aria-label={`${tvdOpen} offen`}>
              {tvdOpen}
            </span>
          )}
          {item.to.startsWith('laemmer?aktion=absetzen') && weanDue > 0 && (
            <span className="shrink-0 rounded-full bg-amber-700 px-2.5 py-1 text-sm font-bold text-white" aria-label={`${weanDue} ab ${WEAN_FROM_DAYS} Tagen`}>
              {weanDue}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
