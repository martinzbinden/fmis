import { useEffect, useState } from 'react'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import SelectAllBox from '@fmis/core/SelectAllBox'
import { deleteShopToken, getShopCatalog, getShopSettings, pollShop, saveShopSettings, type ShopSettings as Settings, type ShopVariant } from '../lib/shop'

const field = 'min-h-11 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-base'
const btn = 'min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm active:bg-gray-100 disabled:opacity-40'
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-CH', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'noch nie')

/** Shop-Anbindung (Verwaltung): Adresse, Host, Zugangsschlüssel und die Produkte, deren bestätigte Anfragen eine
 * Arbeit auslösen. Ändern erst nach ✎, abschliessen mit ✕/✓. Der Schlüssel wird nie angezeigt. */
export default function ShopSettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [edit, setEdit] = useState<{ base_url: string; host: string; token: string; variants: Set<string>; poll_minutes: number } | null>(null)
  const [catalog, setCatalog] = useState<ShopVariant[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () =>
    getShopSettings()
      .then(setS)
      .catch((e) => notifyError(errorText(e)))
  useEffect(() => void load(), [])
  const loadCatalog = () => {
    setCatalogError(null)
    getShopCatalog()
      .then(setCatalog)
      .catch((e) => setCatalogError(errorText(e)))
  }
  useEffect(() => {
    if (s?.has_token && s.base_url) loadCatalog()
  }, [s?.has_token, s?.base_url])

  if (!s) return null
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const chosen = (catalog ?? []).filter((v) => s.variants.includes(v.variant_id))
  const label = (v: ShopVariant) => [v.product_name, v.package_size].filter(Boolean).join(' · ')
  // zuerst «nur auf Anfrage», dann der Rest
  const sorted = [...(catalog ?? [])].filter((v) => v.active).sort((a, b) => Number(b.request_only) - Number(a.request_only) || label(a).localeCompare(label(b), 'de'))

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Shop-Anbindung</h2>
        {!edit ? (
          <button type="button" className={btn} onClick={() => setEdit({ base_url: s.base_url, host: s.host, token: '', variants: new Set(s.variants), poll_minutes: s.poll_minutes })} aria-label="Shop-Anbindung bearbeiten">
            ✎
          </button>
        ) : (
          <span className="flex gap-2">
            <button type="button" className={btn} onClick={() => setEdit(null)} aria-label="Verwerfen">
              ✕
            </button>
            <button
              type="button"
              disabled={busy}
              className={`${btn} border-brand-700 bg-brand-700 text-white`}
              aria-label="Speichern"
              onClick={() =>
                void run(async () => {
                  setS(await saveShopSettings({ ...edit, variants: [...edit.variants] }))
                  setEdit(null)
                  notifySuccess('Shop-Anbindung gespeichert')
                })
              }
            >
              ✓
            </button>
          </span>
        )}
      </div>
      <div className="space-y-2 rounded-lg bg-white p-4 text-sm shadow-sm">
        <p className="text-gray-600">Bestätigte Anfragen aus dem Shop (Produkte «nur auf Anfrage») werden Arbeiten im Arbeitsplan mit «bis spätestens». Erledigt erstellt im Shop den Lieferschein.</p>
        {edit ? (
          <>
            <label className="block">
              <span className="text-gray-600">Adresse des Shop-Servers</span>
              <input className={field} value={edit.base_url} onChange={(e) => setEdit({ ...edit, base_url: e.target.value })} placeholder="http://…:8000" autoCapitalize="off" />
            </label>
            <label className="block">
              <span className="text-gray-600">Host (Backoffice-Adresse)</span>
              <input className={field} value={edit.host} onChange={(e) => setEdit({ ...edit, host: e.target.value })} placeholder="backoffice.…" autoCapitalize="off" />
            </label>
            <label className="block">
              <span className="text-gray-600">Zugangsschlüssel {s.has_token ? '(leer lassen = bisherigen behalten)' : ''}</span>
              <input type="password" className={field} value={edit.token} onChange={(e) => setEdit({ ...edit, token: e.target.value })} autoComplete="off" placeholder={s.has_token ? '••••••••' : 'aus dem Shop-Backoffice › Benutzer › Zugangsschlüssel'} />
            </label>
            <label className="block">
              <span className="text-gray-600">Abfragen alle … Minuten</span>
              <input type="number" min={2} max={1440} className={`${field} w-24`} value={edit.poll_minutes} onChange={(e) => setEdit({ ...edit, poll_minutes: Number(e.target.value) || 10 })} />
            </label>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-gray-800">Produkte, die Arbeit auslösen</span>
                {sorted.length > 0 && <SelectAllBox total={sorted.length} selected={sorted.filter((v) => edit.variants.has(v.variant_id)).length} onChange={(all) => setEdit({ ...edit, variants: new Set(all ? sorted.map((v) => v.variant_id) : []) })} />}
              </div>
              {catalogError && <p className="text-amber-800">Katalog nicht lesbar: {catalogError}</p>}
              {!catalog && !catalogError && <p className="text-gray-600">{s.has_token ? 'Lädt Katalog…' : 'Zuerst Adresse und Schlüssel speichern, dann erscheint hier der Katalog.'}</p>}
              <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {sorted.map((v) => (
                  <li key={v.variant_id}>
                    <label className="flex min-h-11 items-center gap-2 px-2">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={edit.variants.has(v.variant_id)}
                        onChange={(e) => {
                          const n = new Set(edit.variants)
                          if (e.target.checked) n.add(v.variant_id)
                          else n.delete(v.variant_id)
                          setEdit({ ...edit, variants: n })
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        {label(v)}
                        {v.category ? <span className="text-gray-500"> · {v.category}</span> : null}
                      </span>
                      {v.request_only && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">nur auf Anfrage</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <>
            <dl className="space-y-0.5">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-600">Shop-Server</dt>
                <dd className="truncate text-gray-900">{s.base_url || '– nicht eingerichtet –'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-600">Host</dt>
                <dd className="truncate text-gray-900">{s.host || '–'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-600">Zugangsschlüssel</dt>
                <dd className="text-gray-900">{s.has_token ? 'hinterlegt' : 'fehlt'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-600">Letzte Abfrage</dt>
                <dd className={s.last_error ? 'text-red-700' : 'text-gray-900'}>{s.last_error ? `${dt(s.last_poll_at)}: ${s.last_error}` : dt(s.last_ok_at)}</dd>
              </div>
            </dl>
            <p className="text-gray-800">
              <span className="text-gray-600">Lösen Arbeit aus: </span>
              {s.variants.length === 0 ? 'noch keine Produkte gewählt' : catalog ? chosen.map(label).join(', ') || `${s.variants.length} Produkte` : `${s.variants.length} Produkte`}
            </p>
            {catalogError && <p className="text-amber-800">Katalog nicht lesbar: {catalogError}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !s.has_token}
                className={btn}
                onClick={() =>
                  void run(async () => {
                    const r = await pollShop()
                    notifySuccess(r.configured ? `Abgefragt: ${r.created ?? 0} neue Arbeiten, ${r.closed ?? 0} abgeschlossen` : 'Nicht eingerichtet')
                    await load()
                  })
                }
              >
                Jetzt abfragen
              </button>
              {s.has_token && (
                <button
                  type="button"
                  disabled={busy}
                  className={`${btn} text-red-700`}
                  onClick={() =>
                    void run(async () => {
                      await deleteShopToken()
                      await load()
                      notifySuccess('Schlüssel entfernt')
                    })
                  }
                >
                  Schlüssel entfernen
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
