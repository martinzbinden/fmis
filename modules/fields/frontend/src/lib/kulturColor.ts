// Stabile, deterministische Farbe je Kultur-Code (kein manuell gepflegtes
// Mapping nötig — der amtliche Kulturartenkatalog hat >100 Codes). Von der
// Karte (FieldMap.tsx), der Legende (Fields.tsx) und dem Fruchtfolge-
// Zeitstrahl (RotationTimeline.tsx) gemeinsam genutzt, damit dieselbe
// Kultur überall gleich eingefärbt ist.
export function colorForKultur(code: string): string {
  let hash = 0
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) & 0xffffffff
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 42%)`
}
