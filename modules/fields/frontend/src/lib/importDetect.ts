// Zentrale Upload-Seite (core/frontend/src/upload.ts): GELAN-
// "Raumdatenexport Bewirtschafter" erkennen — ein Shapefile-Satz mit dem
// Layer betrieb_betrieb, als ZIP (wie heruntergeladen, auch mehrere in einem
// ZIP) oder als lose Dateien. Alle Dateien desselben Containers gehören zum
// Export (inkl. GeoPackage, das nicht gebraucht wird).

import type { ImportClaim, ModuleImporter, UploadFile } from '@fmis/core/upload'

const MARKER = /^betrieb_betrieb\.shp$/i

/** Container (ZIP bzw. lose Dateien) mit einem GELAN-Export. */
export function gelanGroups(files: UploadFile[]): UploadFile[][] {
  const containers = new Set(files.filter((f) => MARKER.test(f.name)).map((f) => f.container))
  return [...containers].map((c) => files.filter((f) => f.container === c))
}

export function createFieldsImporter(Panel: ModuleImporter['Panel']): ModuleImporter {
  return {
    formats: ['GELAN Raumdatenexport Bewirtschafter (ZIP mit Shapefiles)'],
    permission: 'fields:fields:write',
    async detect(files) {
      const claims: ImportClaim[] = gelanGroups(files).map((group) => {
        const label = group[0].container ? group[0].container.split('/').pop()! : 'Shapefiles'
        const unused = group.filter((f) => !/^(betrieb_betrieb|betrieb_bewirtschaftungseinheit|lnf_nutzung_flaeche|lnf_nutzung_punkt)\.(shp|dbf|shx|prj|cpg)$/i.test(f.name))
        return {
          format: `GELAN-Raumdaten ${label}`,
          detail: '→ Kulturen',
          files: group,
          skipped: unused.map((file) => ({ file, reason: 'gehört zum Export, wird nicht gebraucht' })),
        }
      })
      return { claims }
    },
    Panel,
  }
}
