import { Link } from 'react-router-dom'
import { speciesOf } from '../lib/species'
import { useQuery } from '../hooks/useQuery'
import { loadPendingOffspring } from '../lib/earTagPending'

export default function Erfassen({ moduleKey }: { moduleKey: string }) {
  const sheep = speciesOf(moduleKey) === 'sheep'
  const pending = useQuery(loadPendingOffspring).data?.length ?? 0
  const items = [
    { to: 'tierinfo', icon: '🔎', label: 'Tier-Info', desc: 'Nummer tippen oder lesen: Alter, Abstammung, Index, Ablammung, Belegung, Trächtigkeit, Merklisten' },
    { to: 'geburt', icon: sheep ? '🐑' : '🐄', label: sheep ? 'Ablammung' : 'Abkalbung', desc: 'Mutter, Vater, Nachkommen – Ohrmarke auch später' },
    { to: 'ohrmarken', icon: '🏷️', label: 'Ohrmarken nachtragen', desc: sheep ? 'Lämmer, die bei der Ablammung noch keine Ohrmarke hatten' : 'Kälber, die bei der Abkalbung noch keine Ohrmarke hatten' },
    { to: 'belegung', icon: '❤️', label: sheep ? 'Belegung' : 'Besamung / Belegung', desc: sheep ? 'Widder und Zeitraum, für die ganze Gruppe' : 'Stier und Datum' },
    { to: 'traechtigkeit', icon: '🤰', label: 'Trächtigkeit', desc: 'Einzeln oder mehrere Tiere (+ / Lesegerät), ja/leer/unsicher, Wochen' },
    { to: 'journal', icon: '💉', label: 'Beobachtung / Behandlung', desc: 'Krankheit, Behandlung mit Absetzfrist, Brunst, Klauen' },
    { to: 'behandlungen', icon: '📒', label: 'Behandlungsjournal', desc: 'Tierarzneimittel für die Kontrolle: Liste, Absetzfristen, Druck, Favoriten, cownect-Import' },
    { to: 'selektion', icon: '⭐', label: sheep ? 'Lämmer-Selektion' : 'Kälber-Selektion', desc: 'Remonte oder Mast nach Mutterleistung, Vater und Inzucht' },
    { to: 'merklisten', icon: '📋', label: 'Merklisten', desc: 'Tiere vormerken, z.B. «Ausmerzen prüfen» – auch aus Warnungen bei der Erfassung' },
    { to: 'anpaarung', icon: '🧬', label: 'Anpaarung planen', desc: 'Erwartete Inzucht je Mutter × ' + (sheep ? 'Widder' : 'Stier') },
  ]
  return (
    <div className="mx-auto max-w-lg space-y-3 p-4 pb-24">
      <h1 className="mb-2 text-xl font-bold text-gray-800">Erfassen</h1>
      {items.map((item) => (
        <Link key={item.to} to={`../${item.to}`} relative="path" className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm active:bg-gray-50">
          <span className="text-3xl">{item.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-gray-800">{item.label}</span>
            <span className="block text-sm text-gray-500">{item.desc}</span>
          </span>
          {item.to === 'ohrmarken' && pending > 0 && (
            <span className="shrink-0 rounded-full bg-amber-500 px-2.5 py-1 text-sm font-bold text-white" aria-label={`${pending} offen`}>
              {pending}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
