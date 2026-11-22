import { useEffect, useState } from 'react'
import AppIcon from '@fmis/core/AppIcon'
import { getCurrentUserEmail } from '@fmis/core/auth'
import Modal from './Modal'
import PhotoInput from '@fmis/core/PhotoInput'
import PhotoStrip from '@fmis/core/PhotoStrip'
import type { PreparedPhoto } from '@fmis/core/photos'
import { addPhotos, PHOTO_MODULE } from '../lib/photoRefs'
import { createDeliveryNote, createDirectDeliveryNote, getShopProducts, searchShopCustomers, variantLabel, type ShopCustomer, type ShopVariant } from '../lib/shop'
import { fmtDate, todayIso } from '../lib/format'
import { activityByTitle, AREA_ICON, AREA_LABEL, cancelWorkTask, completeWorkTask, STABLE_CATEGORIES, targetIcon, type FarmJournalEntry, type FollowUpOrigin, type TaskArea, type WorkTask } from '../lib/workTasks'

const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-base'

/** Karte einer Arbeit (Tiere, Gebäude, Maschinen, Brennholz, frei) im Arbeitsplan. */
export function WorkTaskCard({
  task,
  personName,
  photoIds = [],
  originTitle,
  canWrite,
  onComplete,
  onChanged,
  onFollowUp,
}: {
  task: WorkTask
  personName: string | null
  /** Fotos der Arbeit und (bei einer Pendenz) ihrer Herkunft */
  photoIds?: string[]
  /** Pendenz: woraus sie entstand */
  originTitle?: string | null
  canWrite: boolean
  onComplete: () => void
  onChanged: () => void
  onFollowUp?: (origin: FollowUpOrigin) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const overdue = task.due_date && task.due_date < todayIso()
  return (
    <div className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <AppIcon icon={AREA_ICON[task.area]} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-gray-800">{task.title}</div>
          <div className="text-sm text-gray-600">
            {AREA_LABEL[task.area]}
            {personName ? ` · ${personName}` : ''}
            {task.quantity != null ? ` · ${task.quantity.toLocaleString('de-CH')} ${task.unit ?? ''}` : ''}
            {task.due_date ? <span className={overdue ? 'font-semibold text-red-700' : ''}> · bis {fmtDate(task.due_date)}</span> : null}
            {task.source === 'shop' ? ' · aus dem Shop' : ''}
          </div>
          {task.source === 'nachfolge' && <div className="text-sm font-medium text-amber-800">Pendenz{originTitle ? ` aus «${originTitle}»` : ''}</div>}
          {task.customer && <div className="text-sm text-gray-700">für {task.customer}</div>}
          {task.notes && <div className="whitespace-pre-line text-sm text-gray-600">{task.notes}</div>}
        </div>
      </div>
      {task.targets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-sm">
          {task.targets.map((t) => (
            <li key={`${t.kind}${'id' in t ? t.id : t.label}`} className="flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-2">
              <AppIcon icon={targetIcon[t.kind]} size={20} />
              {t.label}
            </li>
          ))}
        </ul>
      )}
      <PhotoStrip moduleKey={PHOTO_MODULE} ids={photoIds} onFollowUp={canWrite && onFollowUp ? () => onFollowUp({ kind: 'work_task', id: task.id, title: task.title, area: task.area, targets: task.targets }) : undefined} />
      {canWrite && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <button type="button" onClick={onComplete} className="min-h-11 flex-1 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700">
            ✓ Erledigt erfassen
          </button>
          {confirm ? (
            <button type="button" onClick={() => void cancelWorkTask(task).then(onChanged)} className="min-h-11 rounded-lg bg-red-600 px-3 py-2 text-sm text-white">
              Wirklich absagen?
            </button>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">
              Absagen
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Arbeit abschliessen: Datum, was gemacht wurde; bei Tieren Kategorie im Stalljournal und allenfalls Medikament. */
export function CompleteTaskDialog({ task, onClose, onDone }: { task: WorkTask; onClose: () => void; onDone: (refs: string[], followUp: boolean) => void }) {
  const animals = task.targets.some((t) => t.kind === 'tier' || t.kind === 'gruppe')
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState(activityByTitle(task.title, 'tiere')?.category ?? 'notiz')
  const [medication, setMedication] = useState('')
  const [dose, setDose] = useState('')
  const [quantity, setQuantity] = useState(task.quantity != null ? String(task.quantity) : '')
  const [doneBy, setDoneBy] = useState(getCurrentUserEmail() ?? '')
  const [photos, setPhotos] = useState<PreparedPhoto[]>([])
  const [followUp, setFollowUp] = useState(false)
  // Arbeit aus einer Shop-Anfrage: Lieferschein im Shop erstellen (auf einen Shop-Kunden, sonst den Sammelkunden)
  const fromShop = task.source === 'shop'
  // von Hand geplant (Brennholz u.ä.): Lieferschein ohne Anfrage, Produkt aus dem Shop-Katalog wählen
  const canDirect = !fromShop && (task.area === 'brennholz' || task.quantity != null)
  const [withNote, setWithNote] = useState(fromShop)
  const direct = canDirect && withNote
  const [products, setProducts] = useState<(ShopVariant & { chosen: boolean })[] | null>(null)
  const [variantId, setVariantId] = useState('')
  const [recipient, setRecipient] = useState({ name: task.customer ?? '', address: '', phone: '' })
  useEffect(() => {
    if (!direct || products) return
    getShopProducts()
      .then((list) => {
        const sorted = [...list].sort((a, b) => Number(b.chosen) - Number(a.chosen) || variantLabel(a).localeCompare(variantLabel(b), 'de'))
        setProducts(sorted)
        // Vorschlag: angekreuztes Produkt, dessen Name im Titel der Arbeit vorkommt, sonst das erste angekreuzte
        const title = task.title.toLowerCase()
        const hit = sorted.find((v) => v.chosen && v.product_name.toLowerCase().split(/[\s,]+/).some((w) => w.length > 3 && title.includes(w))) ?? sorted.find((v) => v.chosen)
        if (hit) setVariantId(hit.variant_id)
      })
      .catch((e: unknown) => {
        setProducts([])
        setErr(e instanceof Error ? e.message : String(e))
      })
  }, [direct, products, task.title])
  const [custQ, setCustQ] = useState('')
  const [custHits, setCustHits] = useState<ShopCustomer[] | null>(null)
  const [cust, setCust] = useState<ShopCustomer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const q = quantity.trim() ? Number(quantity.replace(',', '.')) : null
      // zuerst der Lieferschein (braucht Verbindung): schlägt er fehl, bleibt die Arbeit offen
      let deliveryNoteNo: string | null = null
      if (fromShop && withNote) {
        const r = await createDeliveryNote(task.id, { customer_id: cust?.id ?? null, quantity: q != null && Number.isFinite(q) && q !== task.quantity ? q : null, delivered_on: date, note: notes.trim() || null })
        deliveryNoteNo = r.delivery_note_no
      } else if (direct) {
        if (!variantId) throw new Error('Produkt für den Lieferschein wählen.')
        if (q == null || !Number.isFinite(q) || q <= 0) throw new Error('Menge für den Lieferschein angeben.')
        const r = await createDirectDeliveryNote(task.id, {
          customer_id: cust?.id ?? null,
          recipient: cust ? null : { name: recipient.name.trim(), address: recipient.address.trim(), phone: recipient.phone.trim() },
          lines: [{ variant_id: variantId, quantity: q }],
          delivered_on: date,
          note: notes.trim() || null,
        })
        deliveryNoteNo = r.delivery_note_no
      }
      // Fotos gehören zur Arbeit: Betriebs- und Stalljournal zeigen sie über die Arbeit (task_id bzw. ref_id)
      if (photos.length) await addPhotos('work_task', task.id, photos)
      const refs = await completeWorkTask(task, { date, notes, category, medication, dose, doneBy, quantity: q != null && Number.isFinite(q) ? q : null, deliveryNoteNo })
      onDone(photos.length ? [...refs, `${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'}`] : refs, followUp)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <Modal title={`Erledigt: ${task.title}`} onClose={onClose} onSubmit={() => void save()}>
      <div className="space-y-2 text-sm">
        <label className="block">
          <span className="text-gray-600">Datum</span>
          <input type="date" className={`${field} w-full`} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
        {animals && (
          <>
            <label className="block">
              <span className="text-gray-600">Stalljournal als</span>
              <select className={`${field} w-full`} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(STABLE_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {category === 'behandlung' && (
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="text-gray-600">Medikament</span>
                  <input className={`${field} w-full`} value={medication} onChange={(e) => setMedication(e.target.value)} />
                </label>
                <label>
                  <span className="text-gray-600">Dosis</span>
                  <input className={`${field} w-full`} value={dose} onChange={(e) => setDose(e.target.value)} />
                </label>
                <p className="col-span-2 text-xs text-gray-600">Für das Behandlungsjournal mit Absetzfristen besser «Beobachtung / Behandlung» im Tiermodul verwenden; hier ohne Absetzfrist.</p>
              </div>
            )}
          </>
        )}
        {(task.quantity != null || task.area === 'brennholz' || direct) && (
          <label className="block">
            <span className="text-gray-600">Menge {task.unit ? `(${task.unit})` : ''}</span>
            <input inputMode="decimal" className={`${field} w-full`} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="text-gray-600">Was gemacht, Befund</span>
          <textarea className={`${field} w-full`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {(fromShop || canDirect) && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
            <label className="flex min-h-11 items-center gap-2 font-medium text-gray-900">
              <input type="checkbox" className="h-5 w-5" checked={withNote} onChange={(e) => (setWithNote(e.target.checked), setErr(null))} />
              Lieferschein im Shop erstellen
            </label>
            {withNote && (
              <>
                {direct && (
                  <label className="block">
                    <span className="text-gray-600">Produkt</span>
                    <select className={`${field} w-full`} value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={!products?.length}>
                      <option value="">{products ? (products.length ? 'wählen…' : 'Katalog nicht verfügbar') : 'Lädt Katalog…'}</option>
                      {products?.map((v) => (
                        <option key={v.variant_id} value={v.variant_id}>
                          {variantLabel(v)}
                          {v.unit ? ` (${v.unit})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="text-xs text-gray-700">
                  Auf: <b>{cust ? cust.company_name : fromShop ? 'Sammelkunde (Name und Adresse der Anfrage als Notiz)' : 'Sammelkunde (Empfänger als Notiz)'}</b>
                  {cust && (
                    <button type="button" className="ml-2 underline" onClick={() => setCust(null)}>
                      Sammelkunde
                    </button>
                  )}
                </p>
                <div className="flex gap-2">
                  <input className={`${field} min-w-0 flex-1`} value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Shop-Kunde suchen (optional)" />
                  <button
                    type="button"
                    className="min-h-11 rounded-lg border border-gray-300 bg-white px-3"
                    disabled={!custQ.trim()}
                    onClick={() =>
                      void searchShopCustomers(custQ.trim())
                        .then(setCustHits)
                        .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
                    }
                  >
                    Suchen
                  </button>
                </div>
                {direct && !cust && (
                  <div className="grid grid-cols-2 gap-2">
                    <input className={`${field} col-span-2`} value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} placeholder="Empfänger: Name" aria-label="Empfänger Name" />
                    <textarea className={`${field} col-span-2`} rows={2} value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} placeholder="Adresse (optional)" aria-label="Empfänger Adresse" />
                    <input className={field} inputMode="tel" value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} placeholder="Telefon (optional)" aria-label="Empfänger Telefon" />
                  </div>
                )}
                {custHits && (
                  <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border bg-white">
                    {custHits.length === 0 && <li className="px-2 py-2 text-gray-600">Kein Kunde gefunden.</li>}
                    {custHits.filter((c) => c.active).map((c) => (
                      <li key={c.id}>
                        <button type="button" className="flex min-h-11 w-full flex-col justify-center px-2 text-left active:bg-gray-50" onClick={() => (setCust(c), setCustHits(null))}>
                          <span className="font-medium">{c.company_name}</span>
                          {c.delivery_address && <span className="truncate text-xs text-gray-600">{c.delivery_address.replace(/\n/g, ', ')}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-600">Braucht Verbindung. Ohne Empfang: Häkchen entfernen und den Lieferschein später im Shop-Backoffice erstellen.</p>
              </>
            )}
          </div>
        )}
        <PhotoInput photos={photos} onChange={setPhotos} />
        <label className="block">
          <span className="text-gray-600">Ausgeführt von</span>
          <input className={`${field} w-full`} value={doneBy} onChange={(e) => setDoneBy(e.target.value)} />
        </label>
        <p className="text-xs text-gray-600">Kommt ins {animals ? 'Stalljournal der Tiere (Gruppen: alle Tiere am Datum)' : 'Betriebsjournal'}{task.targets.some((t) => t.kind === 'maschine') ? ' und ins Maschinenjournal' : ''}.</p>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="h-5 w-5" />
          Danach Pendenz erfassen (z.B. Nachkontrolle)
        </label>
        {err && <p className="text-red-700">{err}</p>}
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-green-700 font-semibold text-white disabled:opacity-40">
          Eintragen
        </button>
      </div>
    </Modal>
  )
}

/** Betriebsjournal: erledigte Arbeiten an Gebäuden, Maschinen, Brennholz und weitere. */
export function FarmJournalList({ entries, photos, onFollowUp }: { entries: FarmJournalEntry[]; photos?: Map<string, string[]>; onFollowUp?: (origin: FollowUpOrigin) => void }) {
  if (entries.length === 0) return <p className="rounded-lg bg-white p-4 text-sm text-gray-600 shadow-sm">Noch keine Einträge. Erledigte Arbeiten (ausser Parzellen und Tiere mit Stalljournal) erscheinen hier.</p>
  return (
    <ul className="divide-y rounded-lg bg-white text-sm shadow-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3 px-3 py-2">
          <AppIcon icon={AREA_ICON[e.area as keyof typeof AREA_ICON] ?? 'erfassen'} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-semibold text-gray-900">{e.title}</span>
              <span className="text-xs tabular-nums text-gray-600">{fmtDate(e.entry_date)}</span>
            </div>
            <div className="text-gray-700">
              {e.targets.map((t) => t.label).join(', ')}
              {e.quantity != null ? `${e.targets.length ? ' · ' : ''}${e.quantity.toLocaleString('de-CH')} ${e.unit ?? ''}` : ''}
              {e.customer ? ` · für ${e.customer}` : ''}
            </div>
            {e.notes && <div className="text-gray-600">{e.notes}</div>}
            {e.done_by && <div className="text-xs text-gray-500">{e.done_by}</div>}
            {(() => {
              const origin: FollowUpOrigin = { kind: 'farm_journal', id: e.id, title: e.title, area: e.area as TaskArea, targets: e.targets }
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <PhotoStrip moduleKey={PHOTO_MODULE} ids={[...(photos?.get(e.id) ?? []), ...(e.task_id ? (photos?.get(e.task_id) ?? []) : [])]} onFollowUp={onFollowUp ? () => onFollowUp(origin) : undefined} />
                  {onFollowUp && (
                    <button type="button" onClick={() => onFollowUp(origin)} className="min-h-11 rounded-lg px-2 text-sm font-medium text-amber-800 active:bg-amber-50">
                      ＋ Pendenz
                    </button>
                  )}
                </div>
              )
            })()}
          </div>
        </li>
      ))}
    </ul>
  )
}
