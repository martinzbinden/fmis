import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { isUniqueViolation, mergeInto, parseUniqueDetail, setAsideConflicts } from './pullConflicts'

describe('Pull: Doppelzeile mit dem Server zusammenführen', () => {
  it('liest den Schlüssel aus der Fehlermeldung', () => {
    expect(parseUniqueDetail('Key (ear_tag)=(CH20041511) already exists.')).toEqual({ ear_tag: 'CH20041511' })
    expect(parseUniqueDetail('Key (season_year, fields_lineage_id)=(2026, abc)')).toBeNull()
    expect(parseUniqueDetail('Key (season_year, fields_lineage_id)=(2026, abc) already exists.')).toEqual({ season_year: '2026', fields_lineage_id: 'abc' })
  })

  it('Server-Zeile gewinnt, Verweise ziehen um und werden neu gesendet', async () => {
    const pg = new PGlite()
    await pg.exec(`
      create table animals (id text primary key, ear_tag text not null unique, updated_at text);
      create table animal_journal (id text primary key, animal_id text references animals(id), updated_at text);
      create table sync_outbox (table_name text, row_id text, updated_at text, primary key (table_name, row_id));
      insert into animals values ('lokal', 'CH20041511', '2026-11-01');
      insert into animal_journal values ('j1', 'lokal', '2026-11-01');
      insert into sync_outbox values ('animals', 'lokal', '2026-11-01'), ('animal_journal', 'j1', '2026-11-01');
    `)
    const sql = `insert into animals (id, ear_tag, updated_at) values ($1, $2, $3) on conflict (id) do update set ear_tag = excluded.ear_tag`
    const row = { id: 'server', ear_tag: 'CH20041511', updated_at: '2026-11-02' }
    await pg.transaction(async (tx) => {
      await tx.query('savepoint p')
      let err: unknown
      try {
        await tx.query(sql, [row.id, row.ear_tag, row.updated_at])
      } catch (e) {
        err = e
        await tx.query('rollback to savepoint p')
      }
      expect(isUniqueViolation(err)).toBe(true)
      const aside = await setAsideConflicts(tx, 'animals', row, err as { constraint?: string; detail?: string })
      expect(aside).toEqual(['lokal'])
      await tx.query(sql, [row.id, row.ear_tag, row.updated_at])
      for (const id of aside!) await mergeInto(tx, 'animals', id, row.id)
    })
    expect((await pg.query('select id from animals')).rows).toEqual([{ id: 'server' }])
    expect((await pg.query<{ animal_id: string }>('select animal_id from animal_journal')).rows[0].animal_id).toBe('server')
    const outbox = (await pg.query<{ table_name: string; row_id: string }>('select table_name, row_id from sync_outbox order by 1')).rows
    expect(outbox).toEqual([{ table_name: 'animal_journal', row_id: 'j1' }])
  })
})
