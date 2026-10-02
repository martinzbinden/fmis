import { describe, expect, it } from 'vitest'
import { animalKey } from './animalId'
import {
  mergePedigree,
  parseK01Pedigree,
  parseK02Pedigree,
  parseK09Cattle,
  parseK09Sheep,
  parseK10,
  parseK11,
} from './herdbookRecords'

/** Baut eine synthetische Festbreiten-Zeile: jeder Wert wird an seine
 * 1-basierte Startposition geschrieben (rechtsbündige Zahlen gibt der Test
 * selbst mit Leerzeichen vor). */
function line(satzart: string, length: number, fields: [number, string][]): string {
  const chars = (satzart + ' '.repeat(length)).slice(0, length).split('')
  for (const [from, value] of fields) {
    for (let i = 0; i < value.length; i++) chars[from - 1 + i] = value[i]
  }
  return chars.join('')
}

describe('animalKey', () => {
  it('fasst Lang- und Kurzform eines Schafs zusammen', () => {
    expect(animalKey('CH113200415115')).toBe('CH20041511')
    expect(animalKey('CH2004.1511')).toBe('CH20041511')
    expect(animalKey('ch 2004 1511')).toBe('CH20041511')
  })
  it('lässt Rinder und ausländische IDs unverändert', () => {
    expect(animalKey('CH120136152533')).toBe('CH120136152533')
    expect(animalKey('FR009999901520')).toBe('FR009999901520')
  })
  it('liefert null für leere IDs', () => {
    expect(animalKey('')).toBeNull()
    expect(animalKey('  ')).toBeNull()
    expect(animalKey('CH')).toBeNull()
    expect(animalKey(null)).toBeNull()
  })
})

describe('K01 Abstammung', () => {
  it('liest Tier, Vater und Mutter', () => {
    const l = line('K01', 310, [
      [23, 'CH113197110291'],
      [37, 'LAC'],
      [40, 'ALMA'],
      [52, '20200201'],
      [60, 'CH113200065914'],
      [77, 'CH113183586161'],
      [112, '2'],
    ])
    expect(parseK01Pedigree(l)).toEqual({
      key: 'CH19711029',
      ear_tag: 'CH113197110291',
      sire_key: 'CH20006591',
      dam_key: 'CH18358616',
      breed_code: 'LAC',
      name: 'ALMA',
      birth_date: '2020-02-01',
      sex: 'w',
    })
  })
})

describe('K02 drei Generationen', () => {
  it('liefert Tier, Eltern und Grosseltern mit richtigen Verknüpfungen', () => {
    const l = line('K02', 281, [
      [23, 'CH120000000001'],
      [52, '20200101'],
      [60, 'CH120000000010'], [77, 'VATER'],
      [97, 'US000000000020'], [114, 'VV'],
      [134, 'CH120000000021'],
      [171, 'CH120000000011'], [200, '20150505'],
      [208, 'DE000000000030'],
      [245, 'CH120000000031'],
    ])
    const entries = parseK02Pedigree(l)
    const byKey = new Map(entries.map((e) => [e.key, e]))
    expect(entries).toHaveLength(7)
    expect(byKey.get('CH120000000001')).toMatchObject({ sire_key: 'CH120000000010', dam_key: 'CH120000000011', birth_date: '2020-01-01' })
    expect(byKey.get('CH120000000010')).toMatchObject({ name: 'VATER', sex: 'm', sire_key: 'US000000000020', dam_key: 'CH120000000021' })
    expect(byKey.get('CH120000000011')).toMatchObject({ sex: 'w', sire_key: 'DE000000000030', dam_key: 'CH120000000031', birth_date: '2015-05-05' })
    expect(byKey.get('US000000000020')).toMatchObject({ name: 'VV', sex: 'm', sire_key: null })
  })

  it('lässt leere Grosseltern weg', () => {
    const l = line('K02', 281, [[23, 'CH120000000001'], [60, 'CH120000000010']])
    expect(parseK02Pedigree(l).map((e) => e.key)).toEqual(['CH120000000001', 'CH120000000010'])
  })
})

describe('mergePedigree', () => {
  it('ergänzt leere Felder, ohne bekannte zu überschreiben', () => {
    const merged = mergePedigree([
      { key: 'A', ear_tag: 'A', sire_key: 'S', dam_key: null, breed_code: null, name: null, birth_date: null, sex: 'w' },
      { key: 'A', ear_tag: 'A', sire_key: 'X', dam_key: 'D', breed_code: 'LAC', name: null, birth_date: null, sex: null },
    ])
    expect(merged).toEqual([
      { key: 'A', ear_tag: 'A', sire_key: 'S', dam_key: 'D', breed_code: 'LAC', name: null, birth_date: null, sex: 'w' },
    ])
  })
})

describe('K10 Belegungen', () => {
  it('erkennt KB bei Kühen', () => {
    const l = line('K10', 207, [
      [23, 'CH120136152533'], [69, ' 7'], [80, '20251002'], [88, '3'], [89, ' 1'],
      [91, 'CH120165843099'], [105, 'SF '], [108, 'ARMON'],
    ])
    expect(parseK10(l)).toEqual({
      ear_tag: 'CH120136152533', parity: 7, service_date: '2025-10-02', service_to: null,
      kind: 'kb', seq: 1, sire_ear_tag: 'CH120165843099', sire_breed: 'SF', sire_name: 'ARMON',
    })
  })

  it('liest Belegperioden der Schafe als Natursprung', () => {
    const l = line('K10', 207, [
      [23, 'CH113197110291'], [80, '20250902'], [89, ' 1'], [91, 'CH113200454343'], [198, '20251015'],
    ])
    expect(parseK10(l)).toMatchObject({ kind: 'natursprung', service_date: '2025-09-02', service_to: '2025-10-15' })
  })

  it('verwirft Zeilen ohne Datum', () => {
    expect(parseK10(line('K10', 207, [[23, 'CH120136152533']]))).toBeNull()
  })
})

describe('K11 Geburten', () => {
  it('liest Nachkomme, Vater, Totgeburt und Gewicht', () => {
    const l = line('K11', 252, [
      [23, 'CH120136152533'], [69, ' 3'], [71, '20240310'], [79, 'CH120200000001'],
      [96, '2'], [97, '0'], [98, 'DE009874621015'], [119, '2'], [120, '0'], [121, '38'],
      [143, '20230601'], [152, '0'],
    ])
    expect(parseK11(l)).toEqual({
      dam_ear_tag: 'CH120136152533', parity: 3, birth_date: '2024-03-10',
      offspring_ear_tag: 'CH120200000001', offspring_sex: 'w', sire_ear_tag: 'DE009874621015',
      ease: 2, died_24h: false, birth_weight_kg: 38, conception_date: '2023-06-01', stillborn: false,
    })
  })

  it('akzeptiert tote Lämmer ohne Ohrmarke', () => {
    const l = line('K11', 245, [[23, 'CH113197110291'], [71, '20210425'], [96, '0'], [120, '1'], [152, '1']])
    expect(parseK11(l)).toMatchObject({ offspring_ear_tag: null, offspring_sex: null, died_24h: true, stillborn: true })
  })
})

describe('K09 Zuchtwerte', () => {
  it('Kühe gemäss Spec', () => {
    const l = line('K09', 180, [
      [23, 'CH120136152533'], [52, '20260811'], [61, '66'], [63, ' -123'], [68, '  -9'],
      [72, '-0.05'], [86, 'SF26  '], [92, '61'], [94, '   93'], [111, ' 964'], [132, '26'], [134, ' 95'],
    ])
    const values = Object.fromEntries(parseK09Cattle(l).map((v) => [v.trait, v.value]))
    expect(values).toMatchObject({ milk_kg: -123, fat_kg: -9, fat_pct: -0.05, scc: 93, iset: 964, mastitis: 95 })
    expect(parseK09Cattle(l).find((v) => v.trait === 'scc')?.reliability).toBe(61)
    expect(parseK09Cattle(l)[0].base).toBe('SF26')
  })

  it('Schafe mit abweichendem Satzaufbau', () => {
    const l = line('K09', 184, [
      [23, 'CH113197110291'], [52, '20260226'], [60, '2'], [61, '75'], [63, '  +97'],
      [68, '    +095.00'], [79, '    +105.00'], [95, 'S'], [107, ' 99'],
    ])
    expect(Object.fromEntries(parseK09Sheep(l).map((v) => [v.trait, v.value]))).toEqual({
      idx_milk: 97, idx_fat_pct: 95, idx_protein_pct: 105, gzw: 99,
    })
  })
})
