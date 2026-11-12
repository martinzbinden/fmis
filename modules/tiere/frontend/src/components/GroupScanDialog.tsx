import { useEffect, useMemo, useState } from 'react'
import { listAllAnimals, type AnimalRef } from '@fmis/core/animals'
import { shortEarTag } from '@fmis/core/earTag'
import { matchRead, readerTagToEarTag, useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'
import { loadScanDraft, resolveTags, saveScanDraft } from '../lib/groupScan'
import { memberAt, type HerdData } from '../lib/herds'
import type { HerdGroup } from '../types'
import Modal from './Modal'
import ScanSaveDialog from './ScanSaveDialog'

/** Gruppe live scannen: jede Lesung erscheint sofort auf der provisorischen Tierliste. Erst «Speichern»
 * macht daraus eine neue oder ersetzt eine bestehende Gruppe. Die Liste bleibt auf diesem Gerät erhalten,
 * auch wenn der Dialog geschlossen oder die Seite neu geladen wird. */
export default function GroupScanDialog({ data, date, onClose, onSaved }: { data: HerdData; date: string; onClose: () => void; onSaved: (g: HerdGroup) => void }) {
  const [tags, setTags] = useState<string[]>(loadScanDraft)
  const [animals, setAnimals] = useState<AnimalRef[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void listAllAnimals().then(setAnimals)
  }, [])
  useEffect(() => saveScanDraft(tags), [tags])

  const list = useMemo(() => animals ?? [], [animals])
  const resolved = useMemo(() => resolveTags(tags, list), [tags, list])

  const reader = useTagReader({
    moduleKey: 'tiere',
    duplicate: (read) => (tags.includes(read.tag) ? 'schon auf der Liste' : null),
    onRead: (read) => {
      setTags((t) => (t.includes(read.tag) ? t : [...t, read.tag]))
      const a = matchRead(read, list)
      if (!a) return { text: `${shortEarTag(readerTagToEarTag(read.tag))}: nicht im Bestand`, tone: 'warn' }
      return `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)} (${tags.length + 1})`
    },
  })

  const groupName = (a: AnimalRef) => {
    const m = memberAt(data, a.id, date)
    return m ? (data.groups.find((g) => g.id === m.group_id)?.name ?? '?') : null
  }
  // zuletzt gelesen zuerst
  const rows = [...resolved.matched].reverse()
  const unknown = [...resolved.unknown].reverse()
  const remove = (tag: string) => setTags((t) => t.filter((x) => x !== tag))

  return (
    <Modal title="Gruppe scannen" onClose={onClose} dirty={false}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">Lesegerät einschalten und die Tiere nacheinander lesen. Sie erscheinen sofort hier; gespeichert wird erst am Schluss.</p>
        {!reader.available && <p className="rounded-lg bg-amber-50 p-2 text-amber-900">Kein Lesegerät aktiviert (Verwaltung → Module). Gescannte Gruppen im Gerät erscheinen unter «Vom Lesegerät».</p>}
        <TagReaderButton reader={reader} hint="jede Lesung kommt auf die Liste" />

        <div className="flex items-center justify-between gap-2" aria-live="polite">
          <span className="font-semibold text-gray-900">
            {resolved.matched.length} {resolved.matched.length === 1 ? 'Tier' : 'Tiere'}
            {resolved.unknown.length > 0 && <span className="font-normal text-amber-800"> · {resolved.unknown.length} unbekannt</span>}
          </span>
          {tags.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Liste verwerfen?')) setTags([])
              }}
              className="min-h-11 px-2 text-gray-600 underline"
            >
              Liste leeren
            </button>
          )}
        </div>

        <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border border-gray-200" aria-label="Provisorische Tierliste">
          {animals == null && <li className="p-3 text-gray-500">Lädt …</li>}
          {animals != null && tags.length === 0 && <li className="p-3 text-gray-500">Noch nichts gelesen.</li>}
          {unknown.map((tag) => (
            <li key={tag} className="flex items-center justify-between gap-2 bg-amber-50 px-3 py-2">
              <span>
                <b>{shortEarTag(readerTagToEarTag(tag))}</b> <span className="text-amber-900">unbekannt – nicht im Bestand</span>
              </span>
              <RemoveButton onClick={() => remove(tag)} label={tag} />
            </li>
          ))}
          {rows.map(({ tag, animal }) => (
            <li key={animal.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <b>{animal.lauf_nr ? `${animal.lauf_nr} · ` : ''}{shortEarTag(animal.ear_tag)}</b>
                {animal.name && <span className="text-gray-700"> {animal.name}</span>}
                <span className="block text-xs text-gray-600">jetzt: {groupName(animal) ? `«${groupName(animal)}»` : 'ohne Gruppe'}</span>
              </span>
              <RemoveButton onClick={() => remove(tag)} label={animal.lauf_nr ?? animal.ear_tag} />
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <button type="button" disabled={resolved.matched.length === 0} onClick={() => setSaving(true)} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
            Speichern …
          </button>
          <button type="button" onClick={onClose} className="min-h-12 rounded-lg border border-gray-300 px-4">
            Schliessen
          </button>
        </div>
      </div>

      {saving && (
        <ScanSaveDialog
          data={data}
          resolved={resolved}
          source="Gruppe gescannt"
          onClose={() => setSaving(false)}
          onSaved={(g) => {
            // sofort leeren: der Dialog schliesst sich gleich, ein Effekt käme zu spät
            saveScanDraft([])
            setTags([])
            setSaving(false)
            onSaved(g)
          }}
        />
      )}
    </Modal>
  )
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${label} von der Liste nehmen`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-gray-300 text-lg text-gray-700 active:bg-gray-100">
      ✕
    </button>
  )
}
