// Node 18 (lokale Entwicklung) kennt crypto und File noch nicht als Globale —
// im Browser und ab Node 20 gibt es sie. Nur ergänzen, wenn sie fehlen.
import { File } from 'node:buffer'
import { webcrypto } from 'node:crypto'

const g = globalThis as Record<string, unknown>
g.crypto ??= webcrypto
g.File ??= File
