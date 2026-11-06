import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadPendingOffspring, loadRecentBirths } from './earTagPending'

const DAM = '11111111-1111-4111-8111-111111111111'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let pg: PGlite
let next = 1

async function birth(date: string, source: 'import' | 'manual', offspring: Record<string, unknown>[]) {
  const birthId = uuid(next++)
  await pg.query('insert into births (id, dam_id, birth_date, source, import_key) values ($1, $2, $3, $4, $5)', [birthId, DAM, date, source, `CH1|${date}`])
  const ids: string[] = []
  for (const [i, o] of offspring.entries()) {
    const id = uuid(next++)
    ids.push(id)
    await pg.query(
      'insert into birth_offspring (id, birth_id, ear_tag, sex, stillborn, died_24h, died_on, import_key) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, birthId, o.ear_tag ?? null, o.sex ?? null, o.stillborn ?? false, o.died_24h ?? false, o.died_on ?? null, `CH1|${date}|#${i}`],
    )
  }
  return ids
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`
    create table animals (id uuid primary key, ear_tag text, lauf_nr text, name text);
    create table births (id uuid primary key, dam_id uuid, birth_date date, sire_key text, sire_ear_tag text, sire_name text,
      source text, import_key text, updated_at timestamptz not null default now(), deleted_at timestamptz);
    create table birth_offspring (id uuid primary key, birth_id uuid, ear_tag text, animal_key text, sex text, stillborn boolean, died_24h boolean,
      died_on date, import_key text, loss_cause text, deleted_at timestamptz);
    create table lamb_selection (animal_key text, offspring_id uuid, purpose text, leaning text, updated_at timestamptz default now(), deleted_at timestamptz);
    insert into animals (id, ear_tag, lauf_nr) values ('${DAM}', 'CH1', '2106');
  `)
}, 60_000) // pglite startet im vollen Testlauf langsam
beforeEach(async () => {
  await pg.exec('delete from birth_offspring; delete from births')
})
afterAll(async () => {
  await pg.close()
})

describe('loadPendingOffspring', () => {
  it('zählt Nachkommen aus dem Herdebuch ohne Nummer nicht als Pendenz', async () => {
    const [open] = await birth('2026-10-30', 'manual', [{ sex: 'w' }])
    await birth('2021-01-20', 'import', [{}])
    await birth('2026-10-29', 'manual', [{ ear_tag: 'CH2' }, { stillborn: true }, { died_24h: true }, { died_on: '2026-10-30' }])
    expect((await loadPendingOffspring(pg)).map((p) => p.id)).toEqual([open])
  })

  it('zeigt einen Nachkommen aus dem Herdebuch auf Wunsch und stellt ihn zuoberst', async () => {
    const [imported] = await birth('2025-01-31', 'import', [{}])
    const [old] = await birth('2024-01-01', 'manual', [{ sex: 'm' }])
    const pending = await loadPendingOffspring(pg, imported)
    expect(pending.map((p) => p.id)).toEqual([imported, old])
  })

  it('zählt die Geschwister trotzdem zum Wurf', async () => {
    await birth('2026-10-30', 'manual', [{ sex: 'w' }, { ear_tag: 'CH3', sex: 'm' }, { stillborn: true }])
    const [p] = await loadPendingOffspring(pg)
    expect(p).toMatchObject({ litter: 3, dead: 1, siblings: ['CH3'] })
  })
})

describe('loadRecentBirths', () => {
  it('liefert die neuesten Geburten zuerst, begrenzt, mit dem Verbleib der Nachkommen', async () => {
    await birth('2025-05-05', 'import', [{ ear_tag: 'CH9' }])
    await birth('2026-11-06', 'manual', [{ sex: 'w' }, { stillborn: true }])
    await birth('2026-10-30', 'import', [{}, { died_on: '2026-11-01' }, { died_24h: true }])
    const recent = await loadRecentBirths(pg, 2)
    expect(recent.map((b) => b.birth_date)).toEqual(['2026-11-06', '2026-10-30'])
    expect(recent[0]).toMatchObject({ source: 'manual', dam_lauf_nr: '2106' })
    expect(recent[0].offspring.map((o) => [o.untagged, o.death])).toEqual([[true, null], [false, 'tot geboren']])
    expect(recent[1].offspring.map((o) => [o.untagged, o.death])).toEqual([[true, null], [false, 'verendet 1.11.2026'], [false, 'verendet < 24 h']])
  })

  it('nennt Ursache und Vorauswahl, die neueste Zeile gewinnt', async () => {
    const [live, dead] = await birth('2026-11-06', 'manual', [{ sex: 'w' }, { stillborn: true }])
    await pg.query(`update birth_offspring set loss_cause = 'fehllage' where id = $1`, [dead])
    await pg.query(`insert into lamb_selection (offspring_id, leaning, updated_at) values ($1, 'spaeter', now() - interval '1 hour'), ($1, 'eher_ja', now())`, [live])
    const [b] = await loadRecentBirths(pg, 1)
    expect(b.offspring.map((o) => [o.preselection, o.loss_cause])).toEqual([['eher_ja', null], [null, 'fehllage']])
    await pg.exec('delete from lamb_selection')
  })
})
