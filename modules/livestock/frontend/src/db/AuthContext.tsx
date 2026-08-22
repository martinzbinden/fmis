import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchMe, type CurrentUser } from './auth'

/**
 * Lädt /auth/me einmal nach dem Login und stellt Rolle/Permissions bereit.
 * Reine UX-Gating-Hilfe (Formulare/Nav-Einträge ausblenden, die eh nicht
 * genutzt werden dürfen) — die eigentliche Durchsetzung passiert serverseitig
 * beim Sync (siehe backend/app/sync.py).
 */
const AuthUserContext = createContext<CurrentUser | null>(null)

export function AuthUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch((err) => console.error('auth/me fehlgeschlagen', err))
  }, [])

  return <AuthUserContext.Provider value={user}>{children}</AuthUserContext.Provider>
}

/** null solange /auth/me noch lädt. */
export function useAuthUser(): CurrentUser | null {
  return useContext(AuthUserContext)
}

export function useHasPermission(permission: string): boolean {
  const user = useAuthUser()
  return user?.permissions.includes(permission) ?? false
}
