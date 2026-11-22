// Tiere finden über Nummer, Name oder Geburtsdatum (Tier-Info, Suche über alles).
//
// Eingabe wird in Teile zerlegt; jedes Teil muss passen:
// - Datum (mit Punkt, Komma, Schrägstrich oder Bindestrich): «12.3.2021», «12.3.21», «12.3.» (jedes Jahr),
//   «3.2021» (Monat), «2021-03-12»
// - Wort mit Buchstaben: im Namen enthalten (Umlaute egal)
// - reine Ziffern: Nummer (Laufnummer, Ende der Ohrmarke) — prüft der Aufrufer selbst

export interface BirthQuery {
  day?: number
  month?: number
  year?: number
}

const fullYear = (y: number) => (y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y)

/** Datum aus einem Teil der Eingabe, sonst null. */
export function parseBirthQuery(token: string): BirthQuery | null {
  const t = token.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return { year: +m[1], month: +m[2], day: +m[3] }
  if (!/[.,/-]/.test(t)) return null
  const parts = t.split(/[.,/-]/)
  if (parts[parts.length - 1] === '') parts.pop()
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null
  const n = parts.map(Number)
  let q: BirthQuery
  if (n.length === 3) q = { day: n[0], month: n[1], year: fullYear(n[2]) }
  // zwei Teile: «12.3» = Tag und Monat, «3.2021» oder «3.21» (zweiter Teil kein Monat) = Monat und Jahr
  else if (n.length === 2) q = parts[1].length >= 3 || n[1] > 12 ? { month: n[0], year: fullYear(n[1]) } : { day: n[0], month: n[1] }
  else {
    // «12.» = Tag
    if (parts[0].length > 2) return null
    q = { day: n[0] }
  }
  if ((q.day != null && (q.day < 1 || q.day > 31)) || (q.month != null && (q.month < 1 || q.month > 12))) return null
  return q
}

/** Passt das Geburtsdatum (ISO) zur Datumsangabe? */
export function birthMatches(q: BirthQuery, iso: string | null | undefined): boolean {
  if (!iso) return false
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number)
  return (q.year == null || q.year === y) && (q.month == null || q.month === mo) && (q.day == null || q.day === d)
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export interface TextQuery {
  /** Wörter mit Buchstaben (für den Namen) */
  words: string[]
  /** Datumsangaben (für das Geburtsdatum) */
  dates: BirthQuery[]
  /** reine Ziffern (für Laufnummer und Ohrmarke) */
  number: string
}

/** Eingabe zerlegen. */
export function parseAnimalQuery(input: string): TextQuery {
  const words: string[] = []
  const dates: BirthQuery[] = []
  const numbers: string[] = []
  for (const tok of input.trim().split(/\s+/).filter(Boolean)) {
    const d = parseBirthQuery(tok)
    if (d) dates.push(d)
    else if (/\p{L}/u.test(tok) && !/^CH\d/i.test(tok)) words.push(fold(tok))
    else numbers.push(tok.replace(/\D/g, ''))
  }
  return { words, dates, number: numbers.join('') }
}

/** Name und Geburtsdatum passen zu den Wörtern und Datumsangaben (Nummer prüft der Aufrufer). */
export function nameAndBirthMatch(q: TextQuery, a: { name: string | null; birth_date: unknown }): boolean {
  const name = fold(a.name ?? '')
  if (!q.words.every((w) => name.includes(w))) return false
  const iso = a.birth_date instanceof Date ? a.birth_date.toISOString().slice(0, 10) : a.birth_date == null ? null : String(a.birth_date).slice(0, 10)
  return q.dates.every((d) => birthMatches(d, iso))
}
