// Daten und Schreibvorgänge des Stallkalenders (pages/Stall.tsx); die Regeln selbst stehen in lib/stallCalendar.ts.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { shortEarTag } from '@fmis/core/earTag'
import { inTransaction } from '../db/transaction'
import { upsertRow } from '../db/write'
import type { Species } from './fertility'
import { isoDate } from './format'
import { loadDryAnimalIds } from './dryOff'
import { loadLambs, unmarkedLabel, type Lamb } from './lambs'
import { loadExpectedBirths, loadToday, type TodayData } from './today'
import type { DecisionStep, DecisionValue, StallDecision } from './stallCalendar'
import type { StallRules } from './stallRules'

export interface StallData {
  lambs: Lamb[]
  decisions: StallDecision[]
  expected: Awaited<ReturnType<typeof loadExpectedBirths>>
  dryIds: Set<string>
  /** Tierkennung je Tier-ID (Mutter) für Beschriftungen */
  damLabel: Map<string, string>
  /** «Heute»-Daten: Absetzfristen, Erinnerungen, laufende Milchwägung */
  today: TodayData
}

export async function loadStall(pg: PGlite, species: Species, today: string, rules: StallRules): Promise<StallData> {
  const [lambs, decisions, expected, dryIds, animals, todayData] = await Promise.all([
    loadLambs(pg, today),
    pg.query<Record<string, unknown>>('select step, offspring_id, animal_id, decision, decided_on, until from stall_decisions where deleted_at is null order by decided_on, updated_at'),
    loadExpectedBirths(pg, species, today, rules.trockenDays + rules.lookaheadDays),
    loadDryAnimalIds(pg),
    pg.query<{ id: string; ear_tag: string; lauf_nr: string | null }>('select id, ear_tag, lauf_nr from animals where deleted_at is null'),
    loadToday(pg, species, today),
  ])
  return {
    lambs,
    decisions: decisions.rows.map((d) => ({
      step: d.step as DecisionStep,
      offspringId: (d.offspring_id as string | null) ?? null,
      animalId: (d.animal_id as string | null) ?? null,
      decision: d.decision as DecisionValue,
      decidedOn: isoDate(d.decided_on)!,
      until: isoDate(d.until) ?? null,
    })),
    expected,
    dryIds,
    damLabel: new Map(animals.rows.map((a) => [a.id, a.lauf_nr ?? shortEarTag(a.ear_tag)])),
    today: todayData,
  }
}

/** Beschriftung eines Jungtiers: Nummer und Ohrmarke, ohne Ohrmarke Meldezeitpunkt und Mutter. */
export function lambTitle(l: Lamb, damLabel: Map<string, string>): string {
  if (l.earTag) return `${l.lauf_nr ? `${l.lauf_nr} · ` : ''}${shortEarTag(l.earTag)}${l.name ? ` ${l.name}` : ''}`
  return unmarkedLabel(l, l.damId ? (damLabel.get(l.damId) ?? null) : null)
}

/** Entscheid für mehrere Jungtiere in einem Schritt speichern (eine Zeile je Tier). */
export async function saveDecisions(pg: PGlite, lambs: Lamb[], step: DecisionStep, decision: DecisionValue, decidedOn: string, until: string | null = null): Promise<void> {
  await inTransaction(pg, async (tx) => {
    for (const l of lambs) {
      await upsertRow(tx, 'stall_decisions', {
        id: crypto.randomUUID(),
        step,
        offspring_id: l.offspringId,
        animal_id: l.animalId,
        decision,
        decided_on: decidedOn,
        until,
        notes: null,
        created_by: getCurrentUserEmail(),
      })
    }
  })
}
