import { describe, expect, it } from 'vitest'
import { groupsChanged, groupsProblem, moduleChanges, userChanged } from './Admin'
import type { AdminUser } from './admin'
import type { ModuleInfo } from './modulesApi'

const mod = (over: Partial<ModuleInfo> = {}): ModuleInfo => ({
  key: 'dairy',
  title: 'Milchkühe',
  enabled: true,
  reader_capable: true,
  reader: { enabled: false, host: '192.168.0.10', port: 4001 },
  ...over,
})
const user = (status: AdminUser['status'], role_id: string | null): AdminUser => ({ id: 'u1', email: 'a@b.ch', status, role_id, role_name: role_id ? 'R' : null, sso_managed: false, sso_groups: null })

describe('moduleChanges', () => {
  it('erkennt Ein/Aus und Leser-Änderungen', () => {
    const m = mod()
    const same = { enabled: true, reader: { enabled: false, host: '192.168.0.10', port: '4001' } }
    expect(moduleChanges(m, same)).toEqual({ enabled: false, reader: false })
    expect(moduleChanges(m, { ...same, enabled: false }).enabled).toBe(true)
    expect(moduleChanges(m, { ...same, reader: { ...same.reader, enabled: true } }).reader).toBe(true)
    expect(moduleChanges(m, { ...same, reader: { ...same.reader, port: '4002' } }).reader).toBe(true)
    expect(moduleChanges(m, { ...same, reader: { ...same.reader, host: ' 192.168.0.10 ' } }).reader).toBe(false)
  })
})

describe('userChanged', () => {
  it('aktive: Rolle oder Schalter geändert', () => {
    expect(userChanged(user('active', 'r1'), { role_id: 'r1', active: true })).toBe(false)
    expect(userChanged(user('active', 'r1'), { role_id: 'r2', active: true })).toBe(true)
    expect(userChanged(user('active', 'r1'), { role_id: 'r1', active: false })).toBe(true)
    expect(userChanged(user('disabled', 'r1'), { role_id: 'r1', active: true })).toBe(true)
  })
  it('wartende: erst mit Schalter, eine Rolle allein speichert nichts', () => {
    expect(userChanged(user('pending', null), { role_id: 'r1', active: false })).toBe(false)
    expect(userChanged(user('pending', null), { role_id: 'r1', active: true })).toBe(true)
  })
})

describe('Authelia-Gruppen', () => {
  const g = (group_name: string, role_id: string) => ({ group_name, role_id })
  it('erkennt Änderungen unabhängig von Reihenfolge und Schreibweise', () => {
    expect(groupsChanged([g('Admin', 'r1'), g('lesen', 'r2')], [g('lesen', 'r2'), g('admin', 'r1')])).toBe(false)
    expect(groupsChanged([g('admin', 'r1')], [g('admin', 'r2')])).toBe(true)
    expect(groupsChanged([g('admin', 'r1')], [g('admin', 'r1'), g('neu', 'r2')])).toBe(true)
    // leere Zeilen zählen nicht
    expect(groupsChanged([], [g('', '')])).toBe(false)
  })
  it('meldet Fehler in der Zuordnung', () => {
    expect(groupsProblem([g('admin', 'r1')])).toBeNull()
    expect(groupsProblem([g('', 'r1')])).toBe('Gruppenname fehlt')
    expect(groupsProblem([g('admin', '')])).toBe('Gruppe ohne Rolle')
    expect(groupsProblem([g('Admin', 'r1'), g('admin', 'r2')])).toBe('Jede Gruppe nur einmal')
    expect(groupsProblem([g('', '')])).toBeNull()
  })
})
