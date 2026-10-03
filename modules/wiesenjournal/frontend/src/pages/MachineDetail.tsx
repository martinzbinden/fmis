import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow } from '../db/write'
import { isTractor, loadMachines, MACHINE_KIND_LABEL } from '../lib/machines'
import { fmtBytes, loadMachineFiles, MACHINE_FILE_KIND_LABEL, machineFileUrl, uploadMachineFile } from '../lib/machineFiles'
import MachineForm from '../components/MachineForm'
import MachineImage from '../components/MachineImage'
import Modal from '../components/Modal'
import type { MachineFile, MachineFileKind } from '../types'

const UNIT_LABEL = { m3: 'm³', t: 't', kg: 'kg' } as const

async function load(pg: PGlite, id: string) {
  const [machines, files] = await Promise.all([loadMachines(pg, false), loadMachineFiles(pg, id)])
  return { machines, files }
}

/** Datei in neuem Tab öffnen. Das Fenster sofort öffnen (sonst blockiert der
 * Browser das Popup nach dem Laden), dann die geladene Datei hineinsetzen. */
async function openFile(file: MachineFile) {
  const win = window.open('', '_blank')
  try {
    const url = await machineFileUrl(file.id)
    if (win) win.location.href = url
    else window.location.href = url
  } catch (e) {
    win?.close()
    alert(e instanceof Error ? e.message : String(e))
  }
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-800">{value}</dd>
    </div>
  )
}

/** Eine Maschine: Bilder, Typenschild, Traktor-Zuordnung, Anleitungen. */
export default function MachineDetail() {
  const { id = '' } = useParams()
  const { data, loading, refresh } = useQuery((pg) => load(pg, id), [id])
  const canWrite = useHasPermission('wiesenjournal:tracking:write')
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<MachineFile | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const machines = data?.machines ?? []
  const m = machines.find((x) => x.id === id)
  const files = data?.files ?? []
  const images = files.filter((f) => f.kind === 'bild')
  const docs = files.filter((f) => f.kind !== 'bild')

  if (loading && !data) return <p className="p-4 text-center text-gray-400">Lädt…</p>
  if (!m) {
    return (
      <div className="p-4 text-sm">
        Maschine nicht gefunden.{' '}
        <Link to="../maschinen" className="text-brand-700">
          Zur Liste
        </Link>
      </div>
    )
  }

  const tractor = m.tractor_id ? machines.find((t) => t.id === m.tractor_id) : null
  const usedBy = isTractor(m) ? machines.filter((x) => x.tractor_id === m.id && x.deleted_at == null) : []

  async function upload(list: FileList | null) {
    // FileList vor dem ersten await kopieren — das Input wird danach geleert.
    const chosen = Array.from(list ?? [])
    if (input.current) input.current.value = ''
    setError(null)
    try {
      for (const [i, file] of chosen.entries()) {
        setUploading(`${i + 1}/${chosen.length}: ${file.name}`)
        const kind: MachineFileKind = file.type.startsWith('image/') ? 'bild' : 'anleitung'
        await uploadMachineFile(m!.id, file, kind)
      }
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(null)
    }
  }

  async function removeFile(f: MachineFile) {
    if (!confirm(`«${f.title ?? f.filename}» entfernen?`)) return
    await softDeleteRow('machine_files', f.id)
    setViewing(null)
    refresh()
  }

  async function removeMachine() {
    if (!confirm(`Maschine «${m!.name}» löschen? Bisherige Spuren behalten den Namen.`)) return
    await softDeleteRow('machines', m!.id)
    navigate('../maschinen')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div>
        <Link to="../maschinen" className="text-sm text-brand-700">
          ← Maschinen
        </Link>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-gray-800">{m.name}</h1>
            <p className="text-sm text-gray-500">
              {MACHINE_KIND_LABEL[m.kind] ?? m.kind}
              {!m.active && ' · nicht aktiv'}
            </p>
          </div>
          {canWrite && (
            <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-sm">
              Bearbeiten
            </button>
          )}
        </div>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((f) => (
            <button key={f.id} type="button" onClick={() => setViewing(f)} className="overflow-hidden rounded-lg bg-white shadow-sm">
              <MachineImage fileId={f.id} alt={f.title ?? f.filename} className="aspect-[4/3] w-full" />
            </button>
          ))}
        </div>
      )}

      <dl className="divide-y rounded-lg bg-white px-4 py-2 text-sm shadow-sm">
        <Fact label="Leistung" value={m.power_hp != null ? `${m.power_hp} PS` : null} />
        <Fact label="Frontzapfwelle" value={isTractor(m) ? (m.front_pto ? 'ja' : 'nein') : null} />
        <Fact label="Fass / Ladevolumen" value={m.capacity != null && m.capacity_unit ? `${m.capacity} ${UNIT_LABEL[m.capacity_unit]}` : null} />
        <Fact label="Arbeitsbreite" value={m.width_m != null ? `${m.width_m} m` : null} />
        <Fact label="Hersteller" value={m.manufacturer} />
        <Fact label="Modell" value={m.model} />
        <Fact label="Typen-Nr." value={m.type_no} />
        <Fact label="Fabrikations-/Serie-Nr." value={m.serial_no} />
        <Fact label="Baujahr" value={m.year_built} />
        <Fact label="Gewicht" value={m.weight_kg != null ? `${m.weight_kg.toLocaleString('de-CH')} kg` : null} />
        {!isTractor(m) && (
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-gray-500">Standard-Traktor</dt>
            <dd className="text-right font-medium text-gray-800">
              {tractor ? (
                <Link to={`../maschinen/${tractor.id}`} className="text-brand-700">
                  {tractor.name}
                </Link>
              ) : (
                'erster in der Liste'
              )}
            </dd>
          </div>
        )}
        {usedBy.length > 0 && <Fact label="Standard für" value={usedBy.map((x) => x.name).join(', ')} />}
      </dl>
      {m.notes && <p className="whitespace-pre-line rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">{m.notes}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Anleitungen &amp; Dokumente</h2>
        {docs.length === 0 && <p className="text-sm text-gray-500">Keine hinterlegt.</p>}
        <ul className="space-y-2">
          {docs.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-lg bg-white p-3 shadow-sm">
              <button type="button" onClick={() => void openFile(f)} className="min-w-0 flex-1 text-left">
                <div className="font-medium text-brand-700">📄 {f.title ?? f.filename}</div>
                <div className="text-xs text-gray-500">
                  {MACHINE_FILE_KIND_LABEL[f.kind]} · {fmtBytes(f.size_bytes)}
                  {f.source_url && (
                    <>
                      {' · Quelle: '}
                      <span className="break-all">{new URL(f.source_url).hostname}</span>
                    </>
                  )}
                </div>
              </button>
              {canWrite && (
                <button type="button" onClick={() => void removeFile(f)} className="shrink-0 rounded px-2 py-1 text-xs text-red-700">
                  Entfernen
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canWrite && (
        <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3 text-sm">
          <label className="block cursor-pointer text-center font-medium text-brand-700">
            + Bilder oder Anleitungen (PDF) hinzufügen
            <input
              ref={input}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              disabled={uploading != null}
              onChange={(e) => void upload(e.target.files)}
            />
          </label>
          {uploading && <p className="text-center text-xs text-gray-500">Lädt hoch… {uploading}</p>}
          {error && <p className="text-center text-xs text-red-700">{error}</p>}
          <p className="text-center text-xs text-gray-400">Braucht Internet. Grosse Fotos werden verkleinert.</p>
        </div>
      )}

      {canWrite && (
        <button type="button" onClick={() => void removeMachine()} className="text-sm text-red-700">
          Maschine löschen
        </button>
      )}

      {editing && (
        <MachineForm
          machine={m}
          machines={machines}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            refresh()
          }}
        />
      )}

      {viewing && (
        <Modal title={viewing.title ?? m.name} onClose={() => setViewing(null)}>
          <MachineImage fileId={viewing.id} alt={viewing.title ?? viewing.filename} className="w-full !object-contain" />
          <div className="mt-3 flex justify-between text-sm">
            <button type="button" onClick={() => void openFile(viewing)} className="text-brand-700">
              In voller Grösse öffnen
            </button>
            {canWrite && (
              <button type="button" onClick={() => void removeFile(viewing)} className="text-red-700">
                Bild entfernen
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
