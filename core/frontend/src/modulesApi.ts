import { API_URL, getToken } from './auth'

export interface ReaderInfo {
  enabled: boolean
  host: string
  port: number
}

export interface ModuleInfo {
  key: string
  title: string
  enabled: boolean
  reader_capable: boolean
  reader: ReaderInfo | null
}

/**
 * Ruft GET /core/modules ab — die Laufzeit-Modulliste (siehe
 * core/backend/fmis_core/modules_admin.py). Der Shell (frontend/src/App.tsx)
 * ruft dies einmal nach dem Login ab, um Navigation/Routen nur für aktuell
 * aktivierte Module zu bauen; ein Admin kann Module jederzeit über
 * PATCH /core/modules/{key} umschalten, ohne dass ein Redeploy nötig ist.
 */
export async function fetchModules(): Promise<ModuleInfo[]> {
  const res = await fetch(`${API_URL}/core/modules`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    throw new ModuleListError(`Modulliste konnte nicht geladen werden (${res.status})`, res.status)
  }
  const modules = (await res.json()) as ModuleInfo[]
  cacheModules(modules)
  return modules
}

/** Trägt den HTTP-Status mit, damit die Shell 401 (abgelaufene Anmeldung)
 *  von "gerade kein Netz" unterscheiden kann. */
export class ModuleListError extends Error {
  status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ModuleListError'
    this.status = status
  }
}

// Die Modulliste ist winzig und ändert sich fast nie — aber ohne sie baut die
// Shell weder Navigation noch Routen. Sie zwischenzuspeichern ist der
// Unterschied zwischen "App startet im Stall ohne Netz" und einem endlosen
// Ladekringel.
const MODULES_CACHE_KEY = 'fmis_modules'

function cacheModules(modules: ModuleInfo[]): void {
  try {
    localStorage.setItem(MODULES_CACHE_KEY, JSON.stringify(modules))
  } catch {
    /* ohne localStorage eben nur online */
  }
}

export function cachedModules(): ModuleInfo[] | null {
  try {
    const raw = localStorage.getItem(MODULES_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ModuleInfo[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export async function setModuleEnabled(key: string, enabled: boolean): Promise<ModuleInfo> {
  const res = await fetch(`${API_URL}/core/modules/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ enabled }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Fehler ${res.status}`)
  }
  return (await res.json()) as ModuleInfo
}

/** Setzt Leser-Aktivierung + Adresse/Port für EINE Modul-Instanz (siehe
 * PATCH /core/modules/{key}/reader, core/backend/fmis_core/modules_admin.py). */
export async function setReaderSettings(
  key: string,
  settings: { enabled: boolean; host: string; port: number },
): Promise<ReaderInfo> {
  const res = await fetch(`${API_URL}/core/modules/${key}/reader`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(settings),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Fehler ${res.status}`)
  }
  return (await res.json()) as ReaderInfo
}
