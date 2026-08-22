import { Link } from 'react-router-dom'

const items = [
  { to: '/gewichte', icon: '⚖️', label: 'Gewichte erfassen', desc: 'Schnellerfassung pro Gruppe' },
  { to: '/medikamente', icon: '💊', label: 'Medikamente erfassen', desc: 'Pro Tier oder ganze Gruppe' },
  { to: '/futter', icon: '🌾', label: 'Futter erfassen', desc: 'Pro Gruppe' },
  { to: '/schlachtung', icon: '🔪', label: 'Schlachtung erfassen', desc: 'Pro Ohrmarke' },
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
          <span className="text-3xl">{item.icon}</span>
          <span>
            <span className="block text-base font-semibold text-gray-800">{item.label}</span>
            <span className="block text-sm text-gray-500">{item.desc}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
