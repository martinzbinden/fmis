import { useState } from 'react'
import Modal from './Modal'
import { getCurrentUserEmail } from '@fmis/core/auth'
import type { StartTrackDetails } from '../lib/tracking'
import { useQuery } from '../hooks/useQuery'
import { loadMachines, machineSummary } from '../lib/machines'

// Vorschläge für die Arbeitsart — kein CHECK in der DB (siehe schema/0012),
// darum hier nur ein <datalist>: Freitext bleibt möglich, Tippen wird schneller.
const WORK_TYPE_SUGGESTIONS = [
  'Gülle ausbringen',
  'Mist ausbringen',
  'Kunstdünger streuen',
  'Kalk streuen',
  'Pflügen',
  'Säen',
  'Striegeln',
  'Mähen',
  'Schwaden/Zetten',
  'Sonstiges',
]

const STORAGE_KEY = 'wiesenjournal_last_track_details'

function readLastDetails(): Partial<StartTrackDetails> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<StartTrackDetails>) : {}
  } catch {
    return {}
  }
}

function rememberDetails(details: StartTrackDetails): void {
  try {
    // Nur Maschine/Bediener/Breite fürs nächste Mal merken — Arbeitsart und
    // Bezeichnung sind pro Fahrt verschieden, sollen nicht vorausgefüllt werden.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ machine: details.machine, operator: details.operator, widthM: details.widthM, machineId: details.machineId }),
    )
  } catch {
    // privates Fenster o.ä. — dann eben ohne Vorbelegung beim nächsten Mal
  }
}

export default function StartTrackDialog({
  onClose,
  onStart,
}: {
  onClose: () => void
  onStart: (details: StartTrackDetails) => void
}) {
  const last = readLastDetails()
  const [workType, setWorkType] = useState('')
  const [label, setLabel] = useState('')
  const [machine, setMachine] = useState(last.machine ?? '')
  const [widthM, setWidthM] = useState(last.widthM != null ? String(last.widthM) : '')
  const [operator, setOperator] = useState(last.operator ?? getCurrentUserEmail() ?? '')
  const [machineId, setMachineId] = useState<string>(last.machineId ?? '')
  const { data: machines } = useQuery((pg) => loadMachines(pg), [])

  function pickMachine(id: string) {
    setMachineId(id)
    const m = machines?.find((x) => x.id === id)
    if (m) {
      setMachine(m.name)
      if (m.width_m != null) setWidthM(String(m.width_m))
    }
  }

  function start() {
    const details: StartTrackDetails = {
      label: label.trim() || null,
      widthM: widthM.trim() ? Number(widthM) : null,
      workType: workType.trim() || null,
      machine: machine.trim() || null,
      operator: operator.trim() || null,
      machineId: machineId || null,
    }
    rememberDetails(details)
    onStart(details)
  }

  const input = 'w-full rounded border border-gray-300 px-3 py-2 text-sm'

  return (
    <Modal title="Tracking starten" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Arbeitsart</span>
          <input
            type="text"
            list="work-type-suggestions"
            placeholder="z.B. Gülle ausbringen"
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
            className={input}
          />
          <datalist id="work-type-suggestions">
            {WORK_TYPE_SUGGESTIONS.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Maschine</span>
          {machines && machines.length > 0 && (
            <select value={machineId} onChange={(e) => pickMachine(e.target.value)} className={`${input} mb-1`}>
              <option value="">— aus der Maschinenliste wählen —</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {machineSummary(m)}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            placeholder="z.B. Fendt 313 + Güllefass"
            value={machine}
            onChange={(e) => {
              setMachine(e.target.value)
              setMachineId('')
            }}
            className={input}
          />
        </label>
        <div className="flex gap-2">
          <label className="block flex-1 text-sm">
            <span className="mb-1 block font-medium text-gray-700">Arbeitsbreite (m)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="z.B. 12"
              value={widthM}
              onChange={(e) => setWidthM(e.target.value)}
              className={input}
            />
          </label>
          <label className="block flex-1 text-sm">
            <span className="mb-1 block font-medium text-gray-700">Bediener</span>
            <input
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className={input}
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Bezeichnung (optional)</span>
          <input
            type="text"
            placeholder="z.B. Bundsacker + Ey"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={input}
          />
        </label>
        <p className="text-xs text-gray-400">
          Die Arbeitsbreite wird für den Flächenbezug einer Düngungsmassnahme über diesen Track gebraucht (falls
          nicht angegeben, gilt später ein Standardwert).
        </p>
        <div className="flex justify-end gap-2 border-t pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
            Abbrechen
          </button>
          <button
            type="button"
            onClick={start}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            Aufzeichnung starten
          </button>
        </div>
      </div>
    </Modal>
  )
}
