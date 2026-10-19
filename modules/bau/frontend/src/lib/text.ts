// Kleine Text-Helfer für XML/CSV/Dateinamen (rein, ohne DOM).

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function unescapeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

/** Dateiname-tauglich: Umlaute ausgeschrieben, nur A–Z a–z 0–9 _ - */
export function safeName(s: string): string {
  return (
    s
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Projekt'
  )
}

/** «Guelleleitung_Riedacker_2026-11-05.dxf» */
export function exportFileName(project: string, ext: string, date: string): string {
  return `${safeName(project)}_${date}.${ext}`
}

/** CSV-Feld: ; " und Zeilenumbruch → in Anführungszeichen. */
export function csvField(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
