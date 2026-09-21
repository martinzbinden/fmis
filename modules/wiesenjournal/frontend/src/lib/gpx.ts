import type { Track } from '../types'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Baut minimales, valides GPX 1.1 aus einem Track — kein npm-Paket nötig,
 * das Format ist einfach genug für einen handgeschriebenen Serializer. */
export function trackToGpx(track: Track): string {
  let coords: [number, number][] = []
  if (track.geometry) {
    const geo = JSON.parse(track.geometry) as { type: string; coordinates: [number, number][] }
    coords = geo.coordinates
  }
  let times: string[] = []
  if (track.point_times) {
    try {
      times = JSON.parse(track.point_times) as string[]
    } catch {
      times = []
    }
  }

  const trkpts = coords
    .map(([lng, lat], i) => {
      const time = times[i] ? `<time>${times[i]}</time>` : ''
      return `      <trkpt lat="${lat}" lon="${lng}">${time}</trkpt>`
    })
    .join('\n')

  const name = track.label ? escapeXml(track.label) : `Track ${track.started_at.slice(0, 10)}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FMIS Wiesenjournal" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

export function downloadGpx(track: Track): void {
  const xml = trackToGpx(track)
  const blob = new Blob([xml], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(track.label ?? 'track').replace(/[^a-z0-9-_]+/gi, '_')}_${track.started_at.slice(0, 10)}.gpx`
  a.click()
  URL.revokeObjectURL(url)
}
