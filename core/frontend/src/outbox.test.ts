import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearSent, describeRejected, readOutbox } from './outbox'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

let pg: PGlite
const put = (table: string, id: string, at: string) =>
  pg.query(
    `insert into sync_outbox (table_name, row_id, updated_at) values ($1, $2, $3)
     on conflict (table_name, row_id) do update set updated_at = excluded.updated_at`,
    [table, id, at],
  )
const ids = async () => (await readOutbox(pg)).map((e) => e.id).sort()

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`create table sync_outbox (
    table_name text not null, row_id uuid not null, updated_at timestamptz not null default now(),
    primary key (table_name, row_id))`)
})
beforeEach(async () => {
  await pg.exec('delete from sync_outbox')
})
afterAll(async () => {
  await pg.close()
})

describe('clearSent', () => {
  it('entfernt gesendete Einträge', async () => {
    await put('usage_entries', A, '2026-10-18T10:00:00.123Z')
    await put('usage_entries', B, '2026-10-18T10:00:01.456Z')
    const sent = await readOutbox(pg)
    expect(await clearSent(pg, sent)).toBe(2)
    expect(await ids()).toEqual([])
  })

  it('B2: eine während des Sendens erneut gespeicherte Zeile bleibt in der Outbox', async () => {
    await put('usage_entries', A, '2026-10-18T10:00:00.000Z')
    await put('usage_entries', B, '2026-10-18T10:00:00.500Z')
    const sent = await readOutbox(pg)
    // … Push läuft, in der Zwischenzeit wird A nochmals gespeichert (upsertRow)
    await put('usage_entries', A, '2026-10-18T10:00:02.000Z')
    expect(await clearSent(pg, sent)).toBe(1)
    expect(await ids()).toEqual([A])
  })

  it('stimmt auf die Mikrosekunde genau', async () => {
    await pg.query(`insert into sync_outbox values ('tracks', $1, '2026-10-18 10:00:00.123456+00')`, [A])
    const sent = await readOutbox(pg)
    expect(await clearSent(pg, sent)).toBe(1)
  })

  it('B3: abgelehnte Zeilen bleiben stehen, der Rest wird entfernt', async () => {
    await put('usage_entries', A, '2026-10-18T10:00:00.000Z')
    await put('usage_entries', B, '2026-10-18T10:00:00.000Z')
    await put('tracks', C, '2026-10-18T10:00:00.000Z')
    const sent = await readOutbox(pg)
    const n = await clearSent(pg, sent, [{ table: 'usage_entries', id: B, reason: 'invalid', detail: 'x' }])
    expect(n).toBe(2)
    expect(await ids()).toEqual([B])
  })

  it('gleiche id in anderer Tabelle wird nicht mit abgelehnt', async () => {
    await put('usage_entries', A, '2026-10-18T10:00:00.000Z')
    await put('tracks', A, '2026-10-18T10:00:00.000Z')
    const sent = await readOutbox(pg)
    await clearSent(pg, sent, [{ table: 'tracks', id: A, reason: 'invalid', detail: 'x' }])
    expect((await readOutbox(pg)).map((e) => e.table)).toEqual(['tracks'])
  })

  it('leere Liste: nichts zu tun', async () => {
    expect(await clearSent(pg, [])).toBe(0)
  })
})

describe('describeRejected', () => {
  it('nennt Anzahl, Tabelle und Grund', () => {
    const t = describeRejected([
      { table: 'usage_entries', id: A, reason: 'invalid', detail: 'violates check constraint' },
      { table: 'usage_entries', id: B, reason: 'invalid', detail: 'x' },
    ])
    expect(t).toContain('2 Einträge wurden vom Server abgelehnt')
    expect(t).toContain('usage_entries: violates check constraint')
  })

  it('Schreibrecht wird verständlich benannt', () => {
    expect(describeRejected([{ table: 'tracks', id: A, reason: 'forbidden', detail: 'Keine Schreibrechte für tracks' }])).toContain(
      '1 Eintrag wurde vom Server abgelehnt — alle anderen Änderungen sind gesichert. tracks: fehlendes Schreibrecht',
    )
  })
})
