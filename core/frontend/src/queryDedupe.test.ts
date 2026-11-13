import { describe, expect, it } from 'vitest'
import { createReadDeduper, queryKey } from './queryDedupe'

type Res = { rows: { id: number }[]; n: number }
const defer = () => {
  let resolve!: (v: Res) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<Res>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

describe('createReadDeduper', () => {
  it('gleichzeitige identische Abfragen laufen einmal', async () => {
    const d = createReadDeduper<Res>()
    let runs = 0
    const gate = defer()
    const run = () => (runs++, gate.promise)
    const a = d.read('k', run)
    const b = d.read('k', run)
    const c = d.read('k', run)
    gate.resolve({ rows: [{ id: 1 }], n: 1 })
    await Promise.all([a, b, c])
    expect(runs).toBe(1)
  })

  it('jeder bekommt eigene Zeilen, auch wenn ein anderer sie verändert', async () => {
    const d = createReadDeduper<Res>()
    const gate = defer()
    const a = d.read('k', () => gate.promise)
    const b = d.read('k', () => gate.promise)
    gate.resolve({ rows: [{ id: 1 }], n: 1 })
    const [ra, rb] = await Promise.all([a, b])
    ra.rows[0].id = 99
    ra.rows.push({ id: 5 })
    expect(rb.rows).toEqual([{ id: 1 }])
  })

  it('verschiedene Schlüssel laufen getrennt', async () => {
    const d = createReadDeduper<Res>()
    let runs = 0
    const run = async () => (runs++, { rows: [], n: runs })
    await Promise.all([d.read('a', run), d.read('b', run)])
    expect(runs).toBe(2)
  })

  it('nach dem Abschluss läuft eine neue Abfrage wieder (kein Zwischenspeicher)', async () => {
    const d = createReadDeduper<Res>()
    let runs = 0
    const run = async () => (runs++, { rows: [], n: runs })
    await d.read('k', run)
    await d.read('k', run)
    expect(runs).toBe(2)
    expect(d.size).toBe(0)
  })

  it('nach einem Schreibvorgang hängt sich nichts an eine frühere Abfrage', async () => {
    const d = createReadDeduper<Res>()
    const before = defer()
    const after = defer()
    let runs = 0
    const reads = [before, after]
    const a = d.read('k', () => reads[runs++].promise)
    d.invalidate() // Schreibvorgang gestartet
    const b = d.read('k', () => reads[runs++].promise)
    expect(runs).toBe(2)
    before.resolve({ rows: [{ id: 1 }], n: 1 })
    after.resolve({ rows: [{ id: 2 }], n: 2 })
    expect((await a).rows[0].id).toBe(1)
    expect((await b).rows[0].id).toBe(2)
  })

  it('Fehler gehen an alle und der Eintrag verschwindet', async () => {
    const d = createReadDeduper<Res>()
    const gate = defer()
    const a = d.read('k', () => gate.promise)
    const b = d.read('k', () => gate.promise)
    gate.reject(new Error('kaputt'))
    await expect(a).rejects.toThrow('kaputt')
    await expect(b).rejects.toThrow('kaputt')
    expect(d.size).toBe(0)
  })
})

describe('queryKey', () => {
  it('unterscheidet Schema, SQL und Parameter', () => {
    expect(queryKey('a', 'select 1')).not.toBe(queryKey('b', 'select 1'))
    expect(queryKey('a', 'select $1', [1])).not.toBe(queryKey('a', 'select $1', [2]))
    expect(queryKey('a', 'select $1', [1])).toBe(queryKey('a', 'select $1', [1]))
  })
})
