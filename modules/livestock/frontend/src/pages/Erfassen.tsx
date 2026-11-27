import { Link } from 'react-router-dom'
import AppIcon from '@fmis/core/AppIcon'
import { ERFASSEN_ITEMS } from '../lib/erfassenItems'

export default function Erfassen() {
  return (
    <div className="mx-auto max-w-lg space-y-3 p-4">
      <h1 className="mb-2 text-xl font-bold text-gray-800">Erfassen</h1>
      {ERFASSEN_ITEMS.map((item) => (
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
