import { Link } from 'react-router-dom'
import { speciesOf } from '../lib/species'

export default function Erfassen({ moduleKey }: { moduleKey: string }) {
  const sheep = speciesOf(moduleKey) === 'sheep'
  const items = [
    { to: 'geburt', icon: sheep ? '🐑' : '🐄', label: sheep ? 'Ablammung' : 'Abkalbung', desc: 'Mutter, Vater, Nachkommen mit Ohrmarke' },
    { to: 'belegung', icon: '❤️', label: sheep ? 'Belegung' : 'Besamung / Belegung', desc: sheep ? 'Widder und Zeitraum, für die ganze Gruppe' : 'Stier und Datum' },
    { to: 'journal', icon: '💉', label: 'Beobachtung / Behandlung', desc: 'Krankheit, Behandlung mit Absetzfrist, Brunst, Klauen' },
    { to: 'anpaarung', icon: '🧬', label: 'Anpaarung planen', desc: 'Erwartete Inzucht je Mutter × ' + (sheep ? 'Widder' : 'Stier') },
  ]
  return (
    <div className="mx-auto max-w-lg space-y-3 p-4 pb-24">
      <h1 className="mb-2 text-xl font-bold text-gray-800">Erfassen</h1>
      {items.map((item) => (
        <Link key={item.to} to={`../${item.to}`} relative="path" className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm active:bg-gray-50">
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
