// KMZ = ZIP mit doc.kml (Google Earth, swisstopo-App, map.geo.admin.ch).
import JSZip from 'jszip'

/** `files`: Bilder der Grundlagen unter files/ (GroundOverlay). */
export async function buildKmz(kml: string, files: { path: string; data: Uint8Array }[] = []): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('doc.kml', kml)
  for (const f of files) zip.file(f.path, f.data)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
