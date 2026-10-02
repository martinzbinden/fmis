import { describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { planCertificateImport } from './importCertificate'
import type { CertificateAnimal, SmgCertificate } from './smgCertificate'

/** Minimal-Datenbank für planCertificateImport: beantwortet nur
 * "select * from <tabelle> where <spalte> = any($1)". */
function fakeDb(tables: Record<string, Record<string, unknown>[]>): PGlite {
  return {
    query: async (sql: string, params: unknown[]) => {
      const m = /from (\w+) where (\w+) = any\(\$1\)/.exec(sql)
      if (!m) throw new Error(`unerwartete Abfrage: ${sql}`)
      const wanted = new Set(params[0] as string[])
      return { rows: (tables[m[1]] ?? []).filter((r) => wanted.has(String(r[m[2]]))) }
    },
  } as unknown as PGlite
}

const animal = (position: string, ear_tag: string, extra: Partial<CertificateAnimal> = {}): CertificateAnimal => ({
  position,
  ear_tag,
  name: null,
  birth_date: null,
  breed_code: 'LAC',
  breeding_values: null,
  info: {
    color: null,
    maedi_visna: null,
    ccr5: null,
    scrapie: null,
    parasite_resistance: null,
    offspring_male: null,
    offspring_female: null,
    offspring_total: null,
    offspring_breeding: null,
  },
  scores: [],
  performance: [],
  ...extra,
})

const cert = (date: string, gzw: number, offspring: number): SmgCertificate => ({
  document_date: date,
  inbreeding_pct: 0,
  subject: animal('', 'CH99990001', {
    name: 'TESTBOCK',
    info: { ...animal('', 'x').info, maedi_visna: 'KK', offspring_total: offspring },
  }),
  ancestors: [
    animal('S', 'CH99990002', {
      name: 'VATER',
      breeding_values: { year: Number(date.slice(0, 4)), reliability: 90, idx_milk: 100, idx_fat_pct: 100, idx_protein_pct: 100, gzw },
    }),
    animal('D', 'CH99990003'),
  ],
})

describe('planCertificateImport', () => {
  it('legt beim ersten Import alles ohne Rückfrage an', async () => {
    const plan = await planCertificateImport(fakeDb({}), cert('2026-05-27', 101, 272))
    expect(plan.conflicts).toEqual([])
    expect(plan.writes.filter((w) => w.table === 'pedigree')).toHaveLength(3)
    expect(plan.writes.filter((w) => w.table === 'pedigree_breeding_values')).toHaveLength(4)
    expect(plan.writes.find((w) => w.table === 'pedigree')!.row).toMatchObject({ animal_key: 'CH99990001', sire_key: 'CH99990002', dam_key: 'CH99990003' })
  })

  const stored = {
    pedigree: [
      // aus dem Herdebuch-Export: Tier ohne Eltern, Vater mit anderem Namen
      { id: 'p1', animal_key: 'CH99990001', ear_tag: 'CH113999900011', name: 'TESTBOCK', sire_key: null, dam_key: null, breed_code: 'LAC', birth_date: null, sex: null, source: 'import' },
      { id: 'p2', animal_key: 'CH99990002', ear_tag: 'CH99990002', name: 'ANDERS', sire_key: null, dam_key: null, breed_code: 'LAC', birth_date: null, sex: 'm', source: 'import' },
      { id: 'p3', animal_key: 'CH99990003', ear_tag: 'CH99990003', name: null, sire_key: null, dam_key: null, breed_code: 'LAC', birth_date: null, sex: 'w', source: 'import' },
    ],
    pedigree_breeding_values: ['idx_milk', 'idx_fat_pct', 'idx_protein_pct', 'gzw'].map((t, i) => ({
      id: `b${i}`,
      animal_key: 'CH99990002',
      trait: t,
      value: t === 'gzw' ? '101' : '100',
      reliability: 90,
      eval_date: '2026-05-27',
      import_key: `CH99990002|${t}`,
    })),
    pedigree_info: [{ id: 'i1', animal_key: 'CH99990001', maedi_visna: 'KK', offspring_total: 272, document_date: '2026-05-27' }],
  }

  it('meldet Abweichungen eines neueren Ausweises und füllt Lücken auch ohne Überschreiben', async () => {
    const plan = await planCertificateImport(fakeDb(stored), cert('2027-05-20', 104, 310))
    expect(plan.older_than_stored).toBe(false)
    expect(plan.conflicts).toEqual(['VATER 9999.0002: Name ANDERS → VATER, GZW 101 → 104', 'TESTBOCK 9999.0001: Nachkommen total 272 → 310'])
    const subject = plan.writes.find((w) => w.table === 'pedigree' && w.row.animal_key === 'CH99990001')!
    // Eltern füllen leere Felder — keine Abweichung
    expect(subject.changes).toEqual([])
    expect(subject.row).toMatchObject({ id: 'p1', sire_key: 'CH99990002', dam_key: 'CH99990003', ear_tag: 'CH113999900011' })
    const sire = plan.writes.find((w) => w.table === 'pedigree' && w.row.animal_key === 'CH99990002')!
    expect(sire.row.name).toBe('VATER')
    expect(sire.gapsOnly).toBeNull()
  })

  it('warnt, wenn der Ausweis älter ist als der gespeicherte Stand', async () => {
    const plan = await planCertificateImport(fakeDb(stored), cert('2025-05-20', 98, 200))
    expect(plan.older_than_stored).toBe(true)
    expect(plan.conflicts.join(' ')).toContain('GZW 101 → 98')
  })

  it('ändert nichts, wenn derselbe Ausweis nochmals kommt', async () => {
    const same = { ...stored, pedigree: stored.pedigree.map((p) => (p.id === 'p2' ? { ...p, name: 'VATER' } : p.id === 'p1' ? { ...p, sire_key: 'CH99990002', dam_key: 'CH99990003' } : p)) }
    const plan = await planCertificateImport(fakeDb(same), cert('2026-05-27', 101, 272))
    expect(plan.conflicts).toEqual([])
    expect(plan.writes.filter((w) => w.table !== 'pedigree')).toEqual([])
  })
})
