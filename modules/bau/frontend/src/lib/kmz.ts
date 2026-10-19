// KMZ = ZIP mit doc.kml (Google Earth, swisstopo-App, map.geo.admin.ch).
import JSZip from 'jszip'

export async function buildKmz(kml: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('doc.kml', kml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
