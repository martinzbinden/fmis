// Zentrale Upload-Seite (core/frontend/src/upload.ts): Zugänge für den
// Mastplaner — TVD-Begleitdokument (PDF mit Tierliste) und CSV mit den
// Spalten ear_tag,birth_date,sex. Wägelisten brauchen eine
// Spaltenzuordnung und bleiben auf der Seite "Wägen".

import type { ImportClaim, ImportDetection, ModuleImporter } from '@fmis/core/upload'
import { parseIntakeCsv, type SeedRow } from './importCsv'
import { parseIntakePdf } from './parsePdfIntake'

type IntakeClaim = ImportClaim & { rows: SeedRow[]; warnings: string[] }

export const intakeOf = (claim: ImportClaim) => claim as IntakeClaim

export function createLivestockImporter(Panel: ModuleImporter['Panel']): ModuleImporter {
  return {
    formats: ['TVD-Begleitdokument mit Tierliste (PDF)', 'Zugangsliste CSV (ear_tag,birth_date,sex)'],
    permission: 'livestock:animals:write',
    async detect(files) {
      const out: ImportDetection = { claims: [], rejected: [] }
      for (const f of files) {
        const lower = f.name.toLowerCase()
        if (lower.endsWith('.pdf')) {
          try {
            const { animals, warnings } = await parseIntakePdf(f.data.slice(0))
            if (animals.length === 0) continue
            const claim: IntakeClaim = {
              format: `TVD-Begleitdokument ${f.name} (${animals.length} Tiere)`,
              detail: '→ Mastplaner, neue Gruppe',
              files: [f],
              rows: animals,
              warnings,
            }
            out.claims.push(claim)
          } catch {
            // kein lesbares PDF — bleibt unbekannt
          }
        } else if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
          const header = f.head.split(/\r?\n/)[0].split(',').map((c) => c.trim().toLowerCase())
          if (['ear_tag', 'birth_date', 'sex'].every((c) => header.includes(c))) {
            const rows = parseIntakeCsv(new TextDecoder().decode(f.data))
            const claim: IntakeClaim = {
              format: `Zugangsliste ${f.name} (${rows.length} Tiere)`,
              detail: '→ Mastplaner, neue Gruppe',
              files: [f],
              rows,
              warnings: [],
            }
            out.claims.push(claim)
          } else if (/ohrmarke|ear_?tag/i.test(f.head.split(/\r?\n/)[0])) {
            out.rejected!.push({ file: f, reason: 'Tabelle mit Ohrmarken — Wägelisten im Mastplaner unter «Wägen» einlesen (Spalten zuordnen)' })
          }
        }
      }
      return out
    },
    Panel,
  }
}
