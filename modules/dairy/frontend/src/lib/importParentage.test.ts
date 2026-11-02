import { describe, expect, it } from 'vitest'
import { isSmgAnimalList, parseParentCell, parseSmgAnimalList, tvdParentColumns } from './importParentage'

describe('Abstammung aus Tierlisten', () => {
  it('liest Elternzellen der SMG-Tierliste', () => {
    expect(parseParentCell('1777.9901 EUGEN')).toEqual({ key: 'CH17779901', ear_tag: '1777.9901', name: 'EUGEN' })
    expect(parseParentCell('1971.1090 ')).toEqual({ key: 'CH19711090', ear_tag: '1971.1090', name: null })
    expect(parseParentCell('')).toBeNull()
    expect(parseParentCell('unbekannt')).toBeNull()
  })
  it('erkennt die SMG-Tierliste und liest Tier, Geburt, Geschlecht, Eltern', () => {
    expect(isSmgAnimalList(['Nr.', 'Orig.-Nr.', 'Name', 'Vater', 'Mutter'])).toBe(true)
    expect(isSmgAnimalList(['Ohrmarkennummer', 'Tiername'])).toBe(false)
    const [r] = parseSmgAnimalList([{ 'Nr.': 2217, 'Orig.-Nr.': '2053.3161', Name: '', 'Geb.-Dat': '06.11.2022', 'Ges.': 'F', Vater: '1777.9901 EUGEN', Mutter: '1971.1090 ' }])
    expect(r).toMatchObject({ key: 'CH20533161', birth_date: '2022-11-06', sex: 'w', sire: { key: 'CH17779901', name: 'EUGEN' }, dam: { key: 'CH19711090' } })
  })
  it('findet Mutter/Vater-Spalten einer TVD-Liste, falls es sie gibt', () => {
    expect(tvdParentColumns(['Ohrmarkennummer', 'Tiername', 'Ohrmarke Mutter', 'Vater'])).toEqual({ dam: 'Ohrmarke Mutter', sire: 'Vater' })
    expect(tvdParentColumns(['Ohrmarkennummer', 'Tiername', 'Geschlecht'])).toEqual({ dam: null, sire: null })
  })
})
