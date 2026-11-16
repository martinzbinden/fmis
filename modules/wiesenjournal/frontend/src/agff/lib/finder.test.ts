import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { herdeAnlegen } from './herden'
import { chipUmschalten, finden, finderDaten, FINDER_LEER, passtSuche, sternUmschalten } from './finder'
import type { Parcel } from '../types'

async function setup() {
  const s = await memoryDb()
  const p = (id: string, name: string, extra: Partial<Parcel> = {}) => s.put('parcels', { id, season_year: 2026, name, category: 'futter', area_a: 100, ...extra })
  p('a', 'Eichmatte', { sort_order: 3, area_a: 220, kultur_name_de: 'Kunstwiese' })
  p('b', 'Bachmatte', { sort_order: 1, area_a: 80, wiesentyp: 'Raigras-Weissklee' })
  p('c', 'Lang Acher', { sort_order: 2, category: 'acker', kultur_name_de: 'Wintergerste' })
  p('d', 'Hinterweid', { sort_order: 4, notes: 'steil, Eichen am Rand' })
  p('e', 'Äussere Rüti', { sort_order: 5, favorit: true })
  s.put('usage_entries', { id: 'u1', parcel_id: 'b', entry_date: '2026-06-10', usage_type: 'silage' })
  s.put('usage_entries', { id: 'u2', parcel_id: 'a', entry_date: '2026-04-01', usage_type: 'weide' })
  herdeAnlegen(s, { name: 'Rinder', kategorie: 'rinder', anzahl: 8 }, { ort: 'weide', parcel_id: 'd' }, '2026-06-01')
  return { s, d: finderDaten(s, 2026, '2026-06-16') }
}
const namen = (ps: Parcel[]) => ps.map((p) => p.name)

describe('Parzellen-Finder', () => {
  it('Suche: Name, Kultur, Wiesentyp, Bemerkung; ohne Akzente; alle Wörter', async () => {
    const { s } = await setup()
    const alle = s.rows('parcels')
    expect(namen(alle.filter((p) => passtSuche(p, 'eich')))).toEqual(['Eichmatte', 'Hinterweid'])
    expect(namen(alle.filter((p) => passtSuche(p, 'gerste')))).toEqual(['Lang Acher'])
    expect(namen(alle.filter((p) => passtSuche(p, 'raigras')))).toEqual(['Bachmatte'])
    expect(namen(alle.filter((p) => passtSuche(p, 'aussere ruti')))).toEqual(['Äussere Rüti'])
    expect(namen(alle.filter((p) => passtSuche(p, 'matte bach')))).toEqual(['Bachmatte'])
  })

  it('Gruppen: Favoriten zuoberst, dann Futter und Acker in eigener Reihenfolge', async () => {
    const { s, d } = await setup()
    const r = finden(s.rows('parcels'), FINDER_LEER, d)
    expect(r.gruppen.map((g) => `${g.titel}:${namen(g.parcels).join(',')}`)).toEqual([
      '★ Favoriten:Äussere Rüti',
      'Futterflächen:Bachmatte,Eichmatte,Hinterweid',
      'Acker:Lang Acher',
    ])
  })

  it('Chips: Favoriten, letzte 14 Tage, Herde, Futter/Acker schliessen sich aus, Weiden', async () => {
    const { s, d } = await setup()
    const mit = (chips: Parameters<typeof chipUmschalten>[0]) => namen(finden(s.rows('parcels'), { ...FINDER_LEER, chips }, d).liste)
    expect(mit(['fav'])).toEqual(['Äussere Rüti'])
    expect(mit(['letzte'])).toEqual(['Bachmatte', 'Hinterweid']) // Silage 10.6., Herde seit 1.6.
    expect(mit(['herde'])).toEqual(['Hinterweid'])
    expect(mit(['acker'])).toEqual(['Lang Acher'])
    expect(mit(['weide'])).toEqual(['Eichmatte', 'Hinterweid'])
    expect(chipUmschalten(['futter', 'fav'], 'acker')).toEqual(['fav', 'acker'])
    expect(chipUmschalten(['fav'], 'fav')).toEqual([])
  })

  it('Sortierung: Name, Fläche, zuletzt benutzt', async () => {
    const { s, d } = await setup()
    const sort = (sortierung: 'name' | 'flaeche' | 'zuletzt') => namen(finden(s.rows('parcels'), { ...FINDER_LEER, sort: sortierung }, d).gruppen[1].parcels)
    expect(sort('name')).toEqual(['Bachmatte', 'Eichmatte', 'Hinterweid', 'Lang Acher'])
    expect(sort('flaeche')[0]).toBe('Eichmatte')
    expect(sort('zuletzt').slice(0, 3)).toEqual(['Hinterweid', 'Bachmatte', 'Eichmatte'])
  })

  it('Stern setzt Favorit und «immer zeigen»; nochmals tippen nimmt nur den Favoriten weg', async () => {
    const { s } = await setup()
    sternUmschalten(s, s.get('parcels', 'b')!)
    expect(s.get('parcels', 'b')).toMatchObject({ favorit: true, immer_zeigen: true })
    sternUmschalten(s, s.get('parcels', 'b')!)
    expect(s.get('parcels', 'b')).toMatchObject({ favorit: false, immer_zeigen: true })
  })
})
