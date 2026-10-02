// Parser für die Herdebuch-Satzarten mit Abstammung, Belegungen, Geburten und
// Zuchtwerten ("Datenschnittstelle Rindvieh-Schweiz" v4.35, Qualitas AG).
// Positionen 1-basiert und inklusive wie in der Spec; gegen die echten
// Exporte beider Instanzen geprüft (Kühe swissherdbook, Milchschafe SMG —
// die Schafe folgen der Rinder-Spec mit Ausnahme von K09, siehe unten).
// Codes laut CODE.C01: Bezug 11 Geschlecht, 17 Belegungsart, 19
// Geburtsverlauf, 20 verendet innert 24 h, 67 Totgeburt.

import { animalKey } from '@fmis/core/earTag'

export function field(line: string, from: number, to: number): string {
  return line.slice(from - 1, to)
}

function text(line: string, from: number, to: number): string | null {
  const t = field(line, from, to).trim()
  return t === '' ? null : t
}

function date(line: string, from: number, to: number): string | null {
  const t = field(line, from, to).trim()
  if (!/^\d{8}$/.test(t) || t === '00000000') return null
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
}

function int(line: string, from: number, to: number): number | null {
  const t = field(line, from, to).trim()
  if (t === '') return null
  const n = Number.parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

function dec(line: string, from: number, to: number): number | null {
  const t = field(line, from, to).trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

function sexCode(code: string): 'w' | 'm' | null {
  return code === '1' ? 'm' : code === '2' ? 'w' : null
}

// --- Abstammung ---------------------------------------------------------

export interface PedigreeEntry {
  key: string
  ear_tag: string
  sire_key: string | null
  dam_key: string | null
  breed_code: string | null
  name: string | null
  birth_date: string | null
  sex: 'w' | 'm' | null
}

function entry(
  id: string | null,
  rest: Partial<Omit<PedigreeEntry, 'key' | 'ear_tag'>>,
): PedigreeEntry | null {
  const key = animalKey(id)
  if (!key || !id) return null
  return {
    key,
    ear_tag: id.trim(),
    sire_key: rest.sire_key ?? null,
    dam_key: rest.dam_key ?? null,
    breed_code: rest.breed_code ?? null,
    name: rest.name ?? null,
    birth_date: rest.birth_date ?? null,
    sex: rest.sex ?? null,
  }
}

/** K01 (Datei .Y01): Herdentier mit Vater (60–73) und Mutter (77–90). */
export function parseK01Pedigree(line: string): PedigreeEntry | null {
  return entry(text(line, 23, 36), {
    sire_key: animalKey(text(line, 60, 73)),
    dam_key: animalKey(text(line, 77, 90)),
    breed_code: text(line, 37, 39),
    name: text(line, 40, 51),
    birth_date: date(line, 52, 59),
    sex: sexCode(field(line, 112, 112)),
  })
}

/** Ein 37-Zeichen-Block in K02: ID 14, Rasse 3, Name 12, Geburt 8. */
function k02Block(line: string, from: number) {
  return {
    id: text(line, from, from + 13),
    breed_code: text(line, from + 14, from + 16),
    name: text(line, from + 17, from + 28),
    birth_date: date(line, from + 29, from + 36),
  }
}

/** K02 (Datei .Y02): drei Generationen — Tier, Eltern und alle vier
 * Grosseltern. Liefert bis zu sieben Einträge; Grosseltern ohne eigene
 * Eltern. */
export function parseK02Pedigree(line: string): PedigreeEntry[] {
  const sire = k02Block(line, 60)
  const vv = k02Block(line, 97)
  const vm = k02Block(line, 134)
  const dam = k02Block(line, 171)
  const mv = k02Block(line, 208)
  const mm = k02Block(line, 245)
  const animalId = text(line, 23, 36)
  const out = [
    entry(animalId, {
      sire_key: animalKey(sire.id),
      dam_key: animalKey(dam.id),
      breed_code: text(line, 37, 39),
      name: text(line, 40, 51),
      birth_date: date(line, 52, 59),
    }),
    entry(sire.id, { ...sire, sex: 'm', sire_key: animalKey(vv.id), dam_key: animalKey(vm.id) }),
    entry(dam.id, { ...dam, sex: 'w', sire_key: animalKey(mv.id), dam_key: animalKey(mm.id) }),
    entry(vv.id, { ...vv, sex: 'm' }),
    entry(vm.id, { ...vm, sex: 'w' }),
    entry(mv.id, { ...mv, sex: 'm' }),
    entry(mm.id, { ...mm, sex: 'w' }),
  ]
  return out.filter((e): e is PedigreeEntry => e !== null)
}

/** Fasst mehrfach gelieferte Individuen zusammen (K01, K02, K10, K11 nennen
 * dieselben Tiere) — ein bekannter Wert gewinnt gegen einen leeren. */
export function mergePedigree(entries: PedigreeEntry[]): PedigreeEntry[] {
  const byKey = new Map<string, PedigreeEntry>()
  for (const e of entries) {
    const prev = byKey.get(e.key)
    if (!prev) {
      byKey.set(e.key, { ...e })
      continue
    }
    prev.sire_key ??= e.sire_key
    prev.dam_key ??= e.dam_key
    prev.breed_code ??= e.breed_code
    prev.name ??= e.name
    prev.birth_date ??= e.birth_date
    prev.sex ??= e.sex
  }
  return [...byKey.values()]
}

// --- Belegungen (K10) -----------------------------------------------------

export interface ParsedMating {
  ear_tag: string
  parity: number | null
  service_date: string
  service_to: string | null
  kind: 'kb' | 'natursprung' | null
  seq: number | null
  sire_ear_tag: string | null
  sire_breed: string | null
  sire_name: string | null
}

/** K10: Besamung (Kühe) bzw. Belegung (Schafe). Art laut Bezug 17:
 * 1 = Natursprung, 2/3/5–9 = KB/ET. Schafe liefern Belegperioden mit leerer
 * Art und "belegt bis" in 198–205 — das ist Natursprung mit dem Widder. */
export function parseK10(line: string): ParsedMating | null {
  const ear_tag = text(line, 23, 36)
  const service_date = date(line, 80, 87)
  if (!ear_tag || !service_date) return null
  const code = field(line, 88, 88).trim()
  const serviceTo = date(line, 198, 205)
  let kind: ParsedMating['kind'] = null
  if (code === '1') kind = 'natursprung'
  else if (/^[235-9]$/.test(code)) kind = 'kb'
  else if (code === '' && serviceTo) kind = 'natursprung'
  return {
    ear_tag,
    parity: int(line, 69, 70),
    service_date,
    service_to: serviceTo && serviceTo !== service_date ? serviceTo : null,
    kind,
    seq: int(line, 89, 90),
    sire_ear_tag: text(line, 91, 104),
    sire_breed: text(line, 105, 107),
    sire_name: text(line, 108, 119),
  }
}

// --- Geburten (K11) -------------------------------------------------------

export interface ParsedBirthLine {
  dam_ear_tag: string
  parity: number | null
  birth_date: string
  offspring_ear_tag: string | null
  offspring_sex: 'w' | 'm' | null
  sire_ear_tag: string | null
  ease: number | null
  died_24h: boolean
  birth_weight_kg: number | null
  conception_date: string | null
  stillborn: boolean
}

/** K11: eine Zeile je Nachkomme (auch tot geborene ohne Ohrmarke). Die
 * Zwischenkalbezeit 116–118 wird bewusst NICHT gelesen — auf den kürzeren
 * TVD-Zeilen ist sie um eine Stelle abgeschnitten; sie wird aus den Daten
 * berechnet. */
export function parseK11(line: string): ParsedBirthLine | null {
  const dam_ear_tag = text(line, 23, 36)
  const birth_date = date(line, 71, 78)
  if (!dam_ear_tag || !birth_date) return null
  const weight = int(line, 121, 122)
  return {
    dam_ear_tag,
    parity: int(line, 69, 70),
    birth_date,
    offspring_ear_tag: text(line, 79, 92),
    offspring_sex: sexCode(field(line, 96, 96)),
    sire_ear_tag: text(line, 98, 111),
    ease: int(line, 119, 119),
    died_24h: field(line, 120, 120) === '1',
    birth_weight_kg: weight && weight > 0 ? weight : null,
    conception_date: date(line, 143, 150),
    stillborn: field(line, 152, 152) === '1',
  }
}

// --- Zuchtwerte (K09) -----------------------------------------------------

export interface ParsedBreedingValue {
  ear_tag: string
  eval_date: string
  trait: string
  value: number
  reliability: number | null
  base: string | null
}

/** K09 Kühe (swissherdbook) gemäss Spec. Es gibt dort keine Zuchtwerte für
 * Fruchtbarkeit oder Nutzungsdauer (nur in den Stiersätzen). */
export function parseK09Cattle(line: string): ParsedBreedingValue[] {
  const ear_tag = text(line, 23, 36)
  const eval_date = date(line, 52, 59)
  if (!ear_tag || !eval_date) return []
  const base = text(line, 86, 91)
  const relMilk = int(line, 61, 62)
  const out: ParsedBreedingValue[] = []
  const push = (trait: string, value: number | null, reliability: number | null) => {
    if (value != null) out.push({ ear_tag, eval_date, trait, value, reliability, base })
  }
  push('milk_kg', int(line, 63, 67), relMilk)
  push('fat_kg', int(line, 68, 71), relMilk)
  push('fat_pct', dec(line, 72, 76), relMilk)
  push('protein_kg', int(line, 77, 80), relMilk)
  push('protein_pct', dec(line, 81, 85), relMilk)
  push('scc', int(line, 94, 98), int(line, 92, 93))
  push('milk_value', int(line, 102, 105), relMilk)
  push('persistency', int(line, 108, 110), int(line, 106, 107))
  push('iset', int(line, 111, 114), relMilk)
  push('feed_eff', int(line, 126, 128), int(line, 124, 125))
  push('mastitis', int(line, 134, 136), int(line, 132, 133))
  push('claw', int(line, 150, 152), int(line, 148, 149))
  return out
}

/** K09 Milchschafe (SMG): weicht ab Spalte 63 von der Spec ab — drei
 * relative Indizes (Basis 100) für Milch, Fett-% und Eiweiss-% sowie der
 * Gesamtzuchtwert. Aus den Daten hergeleitet und per Regression geprüft
 * (GZW ≈ 0.48·Milch + 0.64·Fett% + 0.64·Eiweiss% − 75.6, Rest ≤ 0.55),
 * nicht durch eine Spec bestätigt. */
export function parseK09Sheep(line: string): ParsedBreedingValue[] {
  const ear_tag = text(line, 23, 36)
  const eval_date = date(line, 52, 59)
  if (!ear_tag || !eval_date) return []
  const reliability = int(line, 61, 62)
  const out: ParsedBreedingValue[] = []
  const push = (trait: string, value: number | null) => {
    if (value != null) out.push({ ear_tag, eval_date, trait, value, reliability, base: null })
  }
  push('idx_milk', dec(line, 63, 67))
  push('idx_fat_pct', dec(line, 68, 78))
  push('idx_protein_pct', dec(line, 79, 89))
  push('gzw', int(line, 96, 109))
  return out
}
