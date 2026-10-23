import { describe, expect, it } from 'vitest'
import { moduleChanges, userChanged } from './Admin'
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
const user = (status: AdminUser['status'], role_id: string | null): AdminUser => ({ id: 'u1', email: 'a@b.ch', status, role_id, role_name: role_id ? 'R' : null })

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
