import { useEffect, type ReactNode } from 'react'
import { writeLastCapture } from '../lib/lastCapture'

/** Merkt sich beim Öffnen die Erfassungsseite für den dynamischen Punkt der Fussleiste (lib/lastCapture.ts). */
export default function LastCapture({ moduleKey, path, children }: { moduleKey: string; path: string; children: ReactNode }) {
  useEffect(() => writeLastCapture(moduleKey, path), [moduleKey, path])
  return <>{children}</>
}
