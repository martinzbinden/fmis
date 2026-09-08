import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { verifyToken } from '../db/auth'

export default function VerifyToken({ onVerified }: { onVerified: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  // React StrictMode (Dev) ruft Effects doppelt auf — der Token ist aber nur
  // einmal einlösbar. Ohne diese Guard würde der zweite Aufruf serverseitig
  // "bereits verwendet" zurückbekommen und fälschlich einen Fehler anzeigen,
  // obwohl der erste Aufruf bereits erfolgreich eingeloggt hat.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setError('Kein Token in der URL gefunden.')
      return
    }
    verifyToken(token)
      .then(() => {
        onVerified()
        // Über React Router navigieren, nicht window.history direkt — sonst
        // bekommt useLocation() den URL-Wechsel nicht mit und App.tsx würde
        // wegen der /verify-Sonderbehandlung weiter diese Seite rendern.
        navigate('/', { replace: true })
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-sm">
        {error ? (
          <>
            <p className="mb-2 text-2xl">⚠️</p>
            <p className="font-medium text-red-700">{error}</p>
            <a href="/" className="mt-4 inline-block text-sm text-brand-700 underline">
              Zurück zum Login
            </a>
          </>
        ) : (
          <>
            <p className="mb-2 text-2xl">🐑</p>
            <p className="text-gray-600">Melde dich an…</p>
          </>
        )}
      </div>
    </div>
  )
}
