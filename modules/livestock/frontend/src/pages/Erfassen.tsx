import { Link } from 'react-router-dom'
import AppIcon from '@fmis/core/AppIcon'

const items = [
  { to: '/gewichte', icon: 'waage', label: 'Gewichte erfassen', desc: 'Schnellerfassung pro Gruppe' },
  { to: '/medikamente', icon: 'behandlung', label: 'Medikamente erfassen', desc: 'Pro Tier oder ganze Gruppe' },
  { to: '/futter', icon: 'wiese', label: 'Futter erfassen', desc: 'Pro Gruppe' },
  { to: '/schlachtung', icon: 'beleg', label: 'Schlachtung erfassen', desc: 'Pro Ohrmarke' },
  { to: '/schlachtungen', icon: 'beleg', label: 'Schlachtungen', desc: 'Alle Tiere aus den Abrechnungen: Gewicht nach Alter, Jahreszeit, Taxation' },
  { to: '/mastauswertung', icon: 'geld', label: 'Mastauswertung', desc: 'Lämmer: Tageszunahmen, Futterverzehr, Futterverwertung, Deckungsbeitrag' },
]

export default function Erfassen() {
  return (
    <div className="mx-auto max-w-lg space-y-3 p-4">
      <h1 className="mb-2 text-xl font-bold text-gray-800">Erfassen</h1>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm active:bg-gray-50"
        >
          <AppIcon icon={item.icon} size={40} />
          <span>
            <span className="block text-base font-semibold text-gray-800">{item.label}</span>
            <span className="block text-sm text-gray-500">{item.desc}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
