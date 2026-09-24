import { useEffect, useRef, useState } from 'react'
import { fetchAuthConfig, passwordLogin, requestMagicLink, ssoLogin } from './auth'

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mode, setMode] = useState<'email' | 'password'>('email')
  // Der Testpasswort-Weg existiert nur, wo TEST_LOGIN_PASSWORD gesetzt ist.
  // Bis das Backend geantwortet hat (und wenn es nicht erreichbar ist) bleibt
  // der Umschalter aus: in Produktion soll er nie aufblitzen.
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(false)
  // Solange offen ist, ob eine Portal-Anmeldung übernommen werden kann, zeigen
  // wir das Formular noch nicht — sonst blitzt es auf und verschwindet wieder.
  const [ssoPending, setSsoPending] = useState(true)
  const [ssoError, setSsoError] = useState<string | null>(null)

  // Über eine Ref, damit der Effekt einmal läuft: App reicht onLoggedIn als
  // frische Arrow-Funktion herein, als Abhängigkeit gäbe das bei jedem
  // Rendern einen neuen Anmeldeversuch.
  const onLoggedInRef = useRef(onLoggedIn)
  onLoggedInRef.current = onLoggedIn

  useEffect(() => {
    let active = true
    void (async () => {
      let config
      try {
        config = await fetchAuthConfig()
      } catch {
        // Backend nicht erreichbar: normales Formular zeigen, keine Meldung.
        if (active) setSsoPending(false)
        return
      }
      if (!active) return
      setPasswordLoginEnabled(config.passwordLogin)

      if (config.sso) {
        try {
          if (await ssoLogin()) {
            onLoggedInRef.current()
            return
          }
        } catch (err) {
          // Portal-Anmeldung vorhanden, aber abgelehnt — etwa weil das Konto
          // noch auf die Freischaltung wartet. Das gehört auf den Schirm.
          if (active) setSsoError(err instanceof Error ? err.message : 'Anmeldung abgelehnt')
        }
      }
      if (active) setSsoPending(false)
    })()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-2 text-4xl">🌾</div>
          <h1 className="text-2xl font-bold text-brand-800">FMIS</h1>
          <p className="mt-1 text-sm text-gray-500">Farm-Management-Informationssystem</p>
        </div>
        {ssoError && (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-800">
            {ssoError}
          </p>
        )}
        {ssoPending ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
            Anmeldung wird geprüft…
          </p>
        ) : mode === 'email' ? (
          <EmailLogin />
        ) : (
          <PasswordLogin onLoggedIn={onLoggedIn} />
        )}
        {!ssoPending && passwordLoginEnabled && (
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'email' ? 'password' : 'email'))}
            className="mt-4 w-full text-center text-xs text-gray-400 underline"
          >
            {mode === 'email' ? 'Testpasswort verwenden' : 'Mit E-Mail-Link anmelden'}
          </button>
        )}
      </div>
    </div>
  )
}

function EmailLogin() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await requestMagicLink(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anfrage fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-3 rounded-xl bg-white p-6 text-center shadow-sm">
        <p className="text-lg">📬</p>
        <p className="font-medium text-gray-800">Prüfe dein E-Mail-Postfach</p>
        <p className="text-sm text-gray-500">
          Falls die Adresse bekannt ist, haben wir dir einen Login-Link geschickt. Der Link bleibt
          bis zu 1 Jahr gültig — du kannst ihn z.B. als Lesezeichen speichern.
        </p>
        <button type="button" onClick={() => setSent(false)} className="text-sm text-brand-700 underline">
          Andere Adresse verwenden
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
          E-Mail-Adresse
        </label>
        <input
          id="email"
          type="email"
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="du@beispiel.ch"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email}
        className="w-full rounded-lg bg-brand-700 py-3 text-base font-semibold text-white active:bg-brand-800 disabled:opacity-50"
      >
        {busy ? 'Sende Link…' : 'Login-Link anfordern'}
      </button>
      <p className="text-center text-xs text-gray-400">
        Neue Adressen müssen erst von einem Admin freigeschaltet werden. Nach der Anmeldung
        funktioniert die App vollständig offline.
      </p>
    </form>
  )
}

function PasswordLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await passwordLogin(password)
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
        Nur in Test-/Entwicklungsumgebungen aktiv — loggt als Admin ein.
      </p>
      <div>
        <label htmlFor="test-password" className="mb-1 block text-sm font-medium text-gray-700">
          Testpasswort
        </label>
        <input
          id="test-password"
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
        {busy ? 'Melde an…' : 'Anmelden'}
      </button>
    </form>
  )
}
