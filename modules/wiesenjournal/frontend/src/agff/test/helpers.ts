import { readFileSync } from 'node:fs'
import { memoryPersist, Store } from '../db/store'
import { setDb } from '../db/db'

/** Store im Speicher (wie in der App, nur ohne IndexedDB); auch als db() gesetzt. */
export async function memoryDb(): Promise<Store> {
  const s = await Store.open(memoryPersist())
  setDb(s)
  return s
}

export function demoFile(name: string): ArrayBuffer {
  const b = readFileSync(new URL(`../../public/demo/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
