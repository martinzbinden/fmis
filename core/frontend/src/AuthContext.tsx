import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { cachedMe, fetchMe, setCurrentUserEmail, type CurrentUser } from './auth'
import { useViewAs } from './viewAs'

/**
 * Lädt /auth/me einmal nach dem Login und stellt Rolle/Permissions bereit.
 * Reine UX-Gating-Hilfe (Formulare/Nav-Einträge ausblenden, die eh nicht
 * genutzt werden dürfen) — die eigentliche Durchsetzung passiert serverseitig
 * beim Sync (siehe modules/<name>/backend/app/sync.py) bzw. bei Core-Routen
 * (siehe core/backend/fmis_core).
 */
const AuthUserContext = createContext<CurrentUser | null>(null)
const RealUserContext = createContext<CurrentUser | null>(null)

export function AuthUserProvider({ children }: { children: ReactNode }) {
  // Start mit den zuletzt bekannten Rechten (Offline-Start), danach aktualisiert
  const [user, setUser] = useState<CurrentUser | null>(() => cachedMe())

  useEffect(() => {
    fetchMe()
      .then((u) => {
        setUser(u)
        setCurrentUserEmail(u.email)
      })
      .catch((err) => console.error('auth/me fehlgeschlagen', err))
  }, [])

  // Fremde Ansicht (Admin → Ansicht wechseln): Rechte des angezeigten Nutzers
  const view = useViewAs()
  const shown = view ? { email: view.email, role: view.role, permissions: view.permissions } : user
  return (
    <RealUserContext.Provider value={user}>
      <AuthUserContext.Provider value={shown}>{children}</AuthUserContext.Provider>
    </RealUserContext.Provider>
  )
}

/** Die angezeigten Rechte; in einer fremden Ansicht die des Nutzers.
 * null solange /auth/me noch lädt. */
export function useAuthUser(): CurrentUser | null {
  return useContext(AuthUserContext)
}

/** Das eigene Konto, auch in einer fremden Ansicht. */
export function useRealUser(): CurrentUser | null {
  return useContext(RealUserContext)
}

export function useRealPermission(permission: string): boolean {
  return useRealUser()?.permissions.includes(permission) ?? false
}

export function useHasPermission(permission: string): boolean {
  const user = useAuthUser()
  return user?.permissions.includes(permission) ?? false
}
