// Formeln im Suchfeld der Parzellenkarte (pages/Fields.tsx), Felder siehe core/frontend/src/query/engine.ts.

import type { QueryField } from '@fmis/core/query/engine'
import type { FieldDeclaration } from '../types'

export const DECLARATION_QUERY_FIELDS: QueryField<FieldDeclaration, { farmName: (id: string) => string | undefined }>[] = [
  {
    kind: 'num',
    key: 'flaeche',
    label: 'Fläche',
    unit: 'ha',
    aliases: ['flaeche', 'ha', 'groesse'],
    example: 'Fläche > 2',
    get: (d) => (d.area_a == null ? null : d.area_a / 100),
    units: { ha: 1, a: 1 / 100, ar: 1 / 100 },
    defaultUnit: 'ha',
  },
  { kind: 'num', key: 'baeume', label: 'Anzahl Bäume', unit: '', aliases: ['baeume', 'baum'], example: 'Bäume > 10', get: (d) => d.baeume },
  { kind: 'flag', key: 'plan', label: 'aus der Planung', aliases: ['plan', 'planung'], test: (d) => d.source === 'plan' },
  { kind: 'flag', key: 'import', label: 'aus dem Import', aliases: ['import', 'gelan'], test: (d) => d.source === 'import' },
  { kind: 'choice', key: 'kultur', label: 'Kultur', aliases: ['kultur'], options: (d) => [d.kultur_name_de ?? d.kultur_code] },
  { kind: 'choice', key: 'flurname', label: 'Flurname', aliases: ['flurname', 'flur'], options: (d) => [d.flurname ?? ''] },
  { kind: 'choice', key: 'sorte', label: 'Sorte', aliases: ['sorte'], options: (d) => [d.sorte ?? ''] },
  { kind: 'choice', key: 'betrieb', label: 'Betrieb', aliases: ['betrieb'], options: (d, ctx) => [ctx.farmName(d.farm_id) ?? ''] },
]

export const DECLARATION_EXAMPLES = [
  { q: 'Fläche > 2', text: 'grösser als 2 ha' },
  { q: 'Fläche < 50 a', text: 'kleiner als 50 Aren' },
  { q: 'Kultur = Kunstwiese', text: 'nach Kultur (der Anfang genügt)' },
  { q: 'Bäume > 0', text: 'Parzellen mit Bäumen' },
  { q: 'Betrieb = Zbinden', text: 'nach Betrieb' },
  { q: 'Hofstatt', text: 'Flurname oder Kultur enthält «Hofstatt»' },
]

export const declarationTexts = (d: FieldDeclaration) => [d.flurname, d.kultur_name_de, d.kultur_code, d.sorte, d.notes]
