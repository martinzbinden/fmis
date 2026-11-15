import { beforeEach, describe, expect, it } from 'vitest'
import { describeStep, getUndoSteps, onUndo, recordUndo, redoStep, resetUndo, undoAction, undoStep, type UndoChange } from './undo'

const ins = (id: string, table = 'watchlist_entries'): UndoChange => ({ table, id, kind: 'insert', before: null })
const upd = (id: string, before: Record<string, unknown>): UndoChange => ({ table: 'animals', id, kind: 'update', before })

describe('undo', () => {
  beforeEach(() => resetUndo())

  it('fasst schnell aufeinanderfolgende Schreibungen eines Moduls zu einem Schritt zusammen', () => {
    const restore = async () => {}
    recordUndo('dairy_schafe', restore, [ins('a')], 1000)
    recordUndo('dairy_schafe', restore, [ins('b')], 2000)
    recordUndo('dairy_schafe', restore, [ins('c')], 5000)
    recordUndo('tiere', restore, [ins('d')], 5100)
    const steps = getUndoSteps()
    expect(steps.map((s) => s.changes.map((c) => c.id))).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('stellt in umgekehrter Reihenfolge wieder her und markiert den Schritt', async () => {
    let got: string[] = []
    recordUndo('dairy', async (cs) => void (got = cs.map((c) => c.id)), [ins('a'), upd('b', { name: 'alt' })], 1000)
    const id = getUndoSteps()[0].id
    await undoStep(id)
    expect(got).toEqual(['b', 'a'])
    expect(getUndoSteps()[0].undone).toBe(true)
  })

  it('erfasst das Zurücknehmen selbst nicht als neuen Schritt', async () => {
    recordUndo('dairy', async () => recordUndo('dairy', async () => {}, [ins('x')]), [ins('a')], 1000)
    await undoStep(getUndoSteps()[0].id)
    expect(getUndoSteps()).toHaveLength(1)
  })

  it('beschreibt jede Zeile einmal', () => {
    expect(describeStep({ changes: [ins('a'), ins('b'), upd('c', {})] })).toBe('Merklisten-Eintrag + Tier: 2 neu, 1 geändert')
    expect(describeStep({ changes: [upd('c', {}), { ...upd('c', {}), kind: 'delete' }] })).toBe('Tier: 1 gelöscht')
  })
  it('undoAction: alles darin ist ein Schritt mit Text, auch über Module und Zeit', async () => {
    const got: string[] = []
    const r = (name: string) => async (cs: UndoChange[]) => void got.push(`${name}:${cs.map((c) => c.id).join(',')}`)
    await undoAction('Gruppe «Jährlinge»', async () => {
      recordUndo('tiere', r('tiere'), [ins('g', 'herd_groups')], 1000)
      recordUndo('dairy_schafe', r('dairy'), [upd('t', {})], 9000)
      recordUndo('tiere', r('tiere'), [ins('m', 'herd_members')], 20000)
    })
    recordUndo('tiere', r('tiere'), [ins('x', 'herd_members')], 20100)
    const steps = getUndoSteps()
    expect(steps).toHaveLength(2)
    expect(describeStep(steps[0])).toBe('Gruppe «Jährlinge»')
    let seen = 0
    const off = onUndo(() => seen++)
    await undoStep(steps[0].id)
    off()
    // zuletzt angefangenes Modul zuerst, je Modul rückwärts
    expect(got).toEqual(['dairy:t', 'tiere:m,g'])
    expect(seen).toBe(1)
  })

  it('nennt bei vielen Bereichen den ersten', () => {
    expect(describeStep({ changes: [ins('a', 'births'), ins('b', 'birth_offspring'), ins('c', 'animals')] })).toBe('Geburt u.a.: 3 neu')
  })
})

describe('Wiederholen (redo)', () => {
  it('macht das Zurücknehmen rückgängig: Zeilenstände davor und danach', async () => {
    resetUndo()
    const db = new Map<string, string>([['a', 'neu']])
    const restore = async (cs: UndoChange[]) => {
      for (const c of cs) {
        if (c.before) db.set(c.id, String((c.before as { v: string }).v))
        else db.delete(c.id)
      }
    }
    const snapshot = async (cs: UndoChange[]) => cs.filter((c) => db.has(c.id)).map((c) => ({ table: c.table, id: c.id, kind: 'update' as const, before: { v: db.get(c.id)! } }))
    // Änderung: a war «alt», ist jetzt «neu»
    recordUndo('dairy', restore, [{ table: 't', id: 'a', kind: 'update', before: { v: 'alt' } }], 1000, snapshot)
    const id = getUndoSteps()[0].id
    await undoStep(id)
    expect(db.get('a')).toBe('alt')
    expect(getUndoSteps()[0].undone).toBe(true)
    await redoStep(id)
    expect(db.get('a')).toBe('neu')
    expect(getUndoSteps()[0].undone).toBe(false)
    // wieder zurücknehmbar
    await undoStep(id)
    expect(db.get('a')).toBe('alt')
  })
  it('ohne zurückgenommenen Schritt passiert nichts', async () => {
    resetUndo()
    recordUndo('dairy', async () => undefined, [{ table: 't', id: 'x', kind: 'insert', before: null }], 1000, async () => [])
    await redoStep(getUndoSteps()[0].id)
    expect(getUndoSteps()[0].undone).toBe(false)
  })
})

