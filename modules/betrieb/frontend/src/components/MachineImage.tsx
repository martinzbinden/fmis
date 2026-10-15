import { useEffect, useState } from 'react'
import { machineFileUrl } from '../lib/machineFiles'

/** Bild einer Maschine — wird beim Anzeigen vom Server geladen (bzw. aus dem
 * Browser-Cache); ohne Netz und ohne Cache bleibt ein Platzhalter. */
export default function MachineImage({ fileId, alt, className }: { fileId: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    machineFileUrl(fileId).then(
      (u) => alive && setUrl(u),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [fileId])

  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 text-xs text-gray-400 ${className ?? ''}`}>
        {failed ? 'offline' : '…'}
      </div>
    )
  }
  return <img src={url} alt={alt} className={`object-cover ${className ?? ''}`} />
}
