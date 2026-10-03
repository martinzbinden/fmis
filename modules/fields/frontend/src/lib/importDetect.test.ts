import { describe, expect, it } from 'vitest'
import type { UploadFile } from '@fmis/core/upload'
import { gelanGroups } from './importDetect'

const file = (container: string, inner: string): UploadFile => ({
  path: container ? `${container}/${inner}` : inner,
  name: inner.split('/').pop()!,
  container,
  inner,
  data: new ArrayBuffer(0),
  head: '',
})

describe('gelanGroups', () => {
  it('fasst je ZIP alle Dateien eines Exports zusammen', () => {
    const files = [
      file('a.zip', 'ESRISHAPE_1/shapefile/betrieb_betrieb.shp'),
      file('a.zip', 'GEOPACKAGE_1/GEOPACKAGE/Export.gpkg'),
      file('b.zip', 'ESRISHAPE_1/shapefile/betrieb_betrieb.shp'),
      file('c.zip', 'b2109939.K04'),
      file('', 'notiz.txt'),
    ]
    const groups = gelanGroups(files)
    expect(groups.map((g) => g.map((f) => f.path))).toEqual([
      ['a.zip/ESRISHAPE_1/shapefile/betrieb_betrieb.shp', 'a.zip/GEOPACKAGE_1/GEOPACKAGE/Export.gpkg'],
      ['b.zip/ESRISHAPE_1/shapefile/betrieb_betrieb.shp'],
    ])
  })
})
