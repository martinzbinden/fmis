/** Foto verkleinern (längste Seite `max` px, JPEG) und als data-URL liefern —
 * so bleibt die lokale Datenbank und die Sicherung klein. */
export async function downscalePhoto(file: File, max = 1280, quality = 0.75): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'))
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Aktuelle GPS-Position (einmal). */
export function currentPosition(timeoutMs = 20000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Dieses Gerät kann keinen Standort liefern.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, (err) => reject(new Error(geoErrorText(err))), {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 5000,
    })
  })
}

export function geoErrorText(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return 'Standort nicht erlaubt. Bitte in den Browser-Einstellungen freigeben.'
  if (err.code === err.TIMEOUT) return 'Kein GPS-Signal (Zeit abgelaufen).'
  return 'Standort nicht verfügbar.'
}
