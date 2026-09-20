import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { logout } from '@fmis/core/auth'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'

export default function Dashboard({
  modules,
  onLoggedOut,
}: {
  modules: ModuleDescriptor[]
  onLoggedOut: () => void
}) {
  const canManageUsers = useHasPermission('core:users:manage')
  const canManageModules = useHasPermission('core:modules:manage')

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-4 py-3">
        <span className="text-lg font-bold text-brand-800">FMIS</span>
        <div className="flex items-center gap-1">
          {(canManageUsers || canManageModules) && (
            <Link to="/admin" className="rounded px-2 py-1 text-lg active:bg-gray-100">
              ⚙️
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              logout()
              onLoggedOut()
            }}
            className="rounded px-2 py-1 text-xs text-gray-500 active:bg-gray-100"
          >
            Abmelden
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 p-4">
        {modules.length === 0 ? (
          <p className="mt-8 text-center text-sm text-gray-500">
            Keine Module aktiviert — bitte einen Admin kontaktieren.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {modules.map((mod) => (
              <Link
                key={mod.key}
                to={`/${mod.key}`}
                className="flex flex-col items-center justify-center gap-2 rounded-xl bg-white p-6 text-center shadow-sm active:bg-gray-100"
              >
                <span className="text-4xl">{mod.icon}</span>
                <span className="font-semibold text-gray-800">{mod.title}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
