// Shop-Anbindung (pi-pos) über den FMIS-Server (backend/app/shop.py): Einstellungen, Katalog, Kunden, Lieferschein.
// Der Zugangsschlüssel geht nur zum Server und kommt nie zurück.

import { API_URL, getToken } from '@fmis/core/auth'

export interface ShopSettings {
  base_url: string
  host: string
  has_token: boolean
  variants: string[]
  poll_minutes: number
  last_poll_at: string | null
  last_ok_at: string | null
  last_error: string | null
}

export interface ShopVariant {
  product_id: string
  variant_id: string
  product_name: string
  variant_sku: string | null
  package_size: string | null
  category: string | null
  unit: string | null
  request_only: boolean
  active: boolean
}

export interface ShopCustomer {
  id: string
  company_name: string
  delivery_address: string | null
  active: boolean
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/betrieb/shop${path}`, {
      method,
      headers: { Authorization: `Bearer ${getToken()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Keine Verbindung zum Server.')
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail
    throw new Error(detail || `Fehler ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const getShopSettings = () => call<ShopSettings>('GET', '/settings')
export const saveShopSettings = (s: { base_url: string; host: string; token: string; variants: string[]; poll_minutes: number }) => call<ShopSettings>('PUT', '/settings', s)
export const deleteShopToken = () => call<void>('DELETE', '/settings/token')
export const getShopCatalog = () => call<ShopVariant[]>('GET', '/catalog')
export const searchShopCustomers = (q: string) => call<ShopCustomer[]>('GET', `/customers?q=${encodeURIComponent(q)}`)
export const pollShop = () => call<{ configured: boolean; created?: number; updated?: number; closed?: number }>('POST', '/poll')
export const createDeliveryNote = (taskId: string, body: { customer_id?: string | null; quantity?: number | null; delivered_on?: string; note?: string | null }) =>
  call<{ delivery_note_no: string | null; public_code: string | null }>('POST', `/tasks/${taskId}/delivery-note`, body)

/** Dauerhafter Verweis einer Shop-Arbeit: erste Zeile der Notiz («Anfrage CODE · Lieferung»). */
export const shopRef = (notes: string | null | undefined) => (notes ?? '').split('\n')[0].trim() || 'Shop-Anfrage'
