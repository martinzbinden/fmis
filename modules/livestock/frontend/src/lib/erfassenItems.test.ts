import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ERFASSEN_ITEMS } from './erfassenItems'

// Routen aus module.tsx als Text lesen: module.tsx selbst zieht alle Seiten,
// pglite und recharts nach, das braucht der Test nicht.
const moduleSource = readFileSync(fileURLToPath(new URL('../module.tsx', import.meta.url)), 'utf8')
const routesBlock = moduleSource.slice(moduleSource.indexOf('routes: ['))
const routePaths = [...routesBlock.matchAll(/\{\s*path:\s*'([^']*)'/g)].map((m) => m[1]).filter((p) => p !== '*')

describe('Kacheln auf «Erfassen»', () => {
  it('findet die Routen in module.tsx', () => {
    expect(routePaths).toContain('gewichte')
  })

  it.each(ERFASSEN_ITEMS.map((i) => [i.to]))('%s führt auf eine Route des Moduls', (to) => {
    expect(to.startsWith('/livestock/')).toBe(true)
    expect(routePaths).toContain(to.slice('/livestock/'.length))
  })
})
