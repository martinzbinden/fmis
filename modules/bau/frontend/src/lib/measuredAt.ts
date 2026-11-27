// Zeitpunkt eines Messpunkts: nur die Uhrzeit, wenn er von heute ist, sonst mit Datum (Ortszeit).
export function measuredAtLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return time
  const date = d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
  return `${date} ${time}`
}
