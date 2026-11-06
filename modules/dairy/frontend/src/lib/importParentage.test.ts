import { describe, expect, it } from 'vitest'
import { isSmgAnimalList, parseParentCell, parseSmgAnimalList, tvdParentColumns } from './importParentage'

describe('Abstammung aus Tierlisten', () => {
  it('liest Elternzellen der SMG-Tierliste', () => {
    expect(parseParentCell('9000.0050 EUGEN')).toEqual({ key: 'CH90000050', ear_tag: '9000.0050', name: 'EUGEN' })
    expect(parseParentCell('9000.0100 ')).toEqual({ key: 'CH90000100', ear_tag: '9000.0100', name: null })
    expect(parseParentCell('')).toBeNull()
    expect(parseParentCell('unbekannt')).toBeNull()
  })
  it('erkennt die SMG-Tierliste und liest Tier, Geburt, Geschlecht, Eltern', () => {
    expect(isSmgAnimalList(['Nr.', 'Orig.-Nr.', 'Name', 'Vater', 'Mutter'])).toBe(true)
    expect(isSmgAnimalList(['Ohrmarkennummer', 'Tiername'])).toBe(false)
    const [r] = parseSmgAnimalList([{ 'Nr.': 2217, 'Orig.-Nr.': '9000.0170', Name: '', 'Geb.-Dat': '06.11.2022', 'Ges.': 'F', Vater: '9000.0050 EUGEN', Mutter: '9000.0100 ' }])
    expect(r).toMatchObject({ key: 'CH90000170', birth_date: '2022-11-06', sex: 'w', sire: { key: 'CH90000050', name: 'EUGEN' }, dam: { key: 'CH90000100' } })
  })
  it('findet Mutter/Vater-Spalten einer TVD-Liste, falls es sie gibt', () => {
    expect(tvdParentColumns(['Ohrmarkennummer', 'Tiername', 'Ohrmarke Mutter', 'Vater'])).toEqual({ dam: 'Ohrmarke Mutter', sire: 'Vater' })
    expect(tvdParentColumns(['Ohrmarkennummer', 'Tiername', 'Geschlecht'])).toEqual({ dam: null, sire: null })
  })
})
