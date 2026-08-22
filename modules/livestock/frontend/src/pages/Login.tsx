import { useState } from 'react'
import { login } from '../db/auth'

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(password)
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-2 text-4xl">🐑</div>
          <h1 className="text-2xl font-bold text-brand-800">Mastplaner</h1>
          <p className="mt-1 text-sm text-gray-500">Lämmermast-Überwachung</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
              Betriebs-Passwort
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-lg bg-brand-700 py-3 text-base font-semibold text-white active:bg-brand-800 disabled:opacity-50"
          >
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
          <p className="text-center text-xs text-gray-400">
            Nach der Anmeldung funktioniert die App vollständig offline im Stall.
          </p>
        </form>
      </div>
    </div>
  )
}
