// Fass-Ereignisse laden/speichern (schema/0021); Rechnen in lib/slurry.ts.

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import { num } from './format'
import type { TankEvent } from '../types'

export async function loadTankEvents(pg: PGlite, machineId: string): Promise<TankEvent[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    'select * from tank_events where deleted_at is null and machine_id = $1 order by event_at',
    [machineId],
  )
  return rows.map((r) => ({
    ...(r as unknown as TankEvent),
    event_at: new Date(r.event_at as string).toISOString(),
    volume_m3: num(r.volume_m3) ?? 0,
    distance_m: num(r.distance_m) ?? 0,
    spread_s: num(r.spread_s) ?? 0,
    width_m: num(r.width_m) ?? 0,
  }))
}

export async function loadTrackTanks(pg: PGlite, trackIds: string[]): Promise<TankEvent[]> {
  if (!trackIds.length) return []
  const { rows } = await pg.query<Record<string, unknown>>(
    'select * from tank_events where deleted_at is null and track_id = any($1) order by event_at',
    [trackIds],
  )
  return rows.map((r) => ({ ...(r as unknown as TankEvent), volume_m3: num(r.volume_m3) ?? 0 }))
}

export const saveTankEvent = (e: TankEvent) => upsertRow('tank_events', e as never)
