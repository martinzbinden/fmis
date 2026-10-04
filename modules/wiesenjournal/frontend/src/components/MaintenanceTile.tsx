import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { getDb } from '../db/pglite'
import { loadMaintenanceData } from '../lib/maintenanceData'
import { machineStatuses } from './MachineMaintenance'

/** Kachel auf der Übersicht: Maschinen und Wartung mit Anzahl fälliger
 * Aufgaben (Stand der Daten auf diesem Gerät). */
export default function MaintenanceTile() {
  const canRead = useHasPermission('wiesenjournal:tracking:read')
  const [due, setDue] = useState<{ faellig: number; bald: number; machines: number; noStart: number } | null>(null)

  useEffect(() => {
    if (!canRead) return
    let alive = true
    getDb()
      .then(loadMaintenanceData)
      .then((d) => {
        const c = { faellig: 0, bald: 0, machines: 0, noStart: 0 }
        for (const m of d.machines.filter((x) => x.active)) {
          c.machines++
          const statuses = machineStatuses(m, d.tasks, d.log, d.tracksByMachine.get(m.id) ?? [])
          if (statuses.some((s) => s.state === 'offen')) c.noStart++
          for (const s of statuses) {
            if (s.state === 'faellig') c.faellig++
            else if (s.state === 'bald') c.bald++
          }
        }
        if (alive) setDue(c)
      })
      .catch(() => alive && setDue(null))
    return () => {
      alive = false
    }
  }, [canRead])

  if (!canRead) return null
  return (
    <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl bg-white text-center text-sm shadow-sm">
      <Link to="/wiesenjournal/maschinen" className="p-4 active:bg-gray-100">
        <span className="block text-2xl">🚜</span>
        <span className="font-semibold text-gray-800">Maschinen</span>
        {due && <span className="block text-xs text-gray-500">{due.machines} aktiv</span>}
      </Link>
      <Link to="/wiesenjournal/wartung" className="border-l p-4 active:bg-gray-100">
        <span className="block text-2xl">🔧</span>
        <span className="font-semibold text-gray-800">Wartung</span>
        {due && (
          <span className="mt-0.5 flex justify-center gap-1 text-xs">
            {due.faellig > 0 && <span className="rounded bg-red-100 px-1.5 text-red-800">{due.faellig} fällig</span>}
            {due.bald > 0 && <span className="rounded bg-amber-100 px-1.5 text-amber-900">{due.bald} bald</span>}
            {due.faellig + due.bald === 0 && due.noStart === 0 && <span className="text-gray-500">nichts fällig</span>}
            {due.faellig + due.bald === 0 && due.noStart > 0 && <span className="rounded bg-sky-100 px-1.5 text-sky-800">Ausgangslage fehlt ({due.noStart})</span>}
          </span>
        )}
      </Link>
    </div>
  )
}
