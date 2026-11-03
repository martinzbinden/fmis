import { useEffect, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { getDb } from '../db/pglite'
import { loadDerivedWeide } from '../lib/journalEntry'
import { isoDate, todayIso } from '../lib/format'
import { BREAKS, classIndex, COLOR_MODE_LABEL, cultureColors, daysBetween, legendLabels, parcelMetrics, RAMP, type ColorMode, type ParcelMetric } from '../lib/parcelColor'
import type { Parcel } from '../types'

const UNIT: Record<Exclude<ColorMode, 'kultur'>, string> = { schnitte: 'Schnitte', weidetage: 'Weidetage', ruhe: 'Tage' }

/** Parzellen eingefärbt nach Kultur oder einer Kennzahl aus dem Wiesenjournal des
 * Jahres (Schnitte, Weidetage inkl. Herden, Tage seit der letzten Nutzung). */
export default function ParcelColorLayer({ parcels, mode, seasonYear }: { parcels: Parcel[]; mode: ColorMode; seasonYear: number }) {
  const map = useMap()
  const [metrics, setMetrics] = useState<Map<string, ParcelMetric> | null>(null)

  useEffect(() => {
    if (mode === 'kultur') return
    let active = true
    const from = `${seasonYear}-01-01`
    const to = `${seasonYear}-12-31`
    void getDb()
      .then(async (pg) => {
        const [stored, derived] = await Promise.all([
          pg.query<{ parcel_id: string; entry_date: unknown; usage_type: string }>(
            `select parcel_id, entry_date, usage_type from usage_entries
             where deleted_at is null and not coalesce(is_planned, false) and entry_date between $1 and $2`,
            [from, to],
          ),
          loadDerivedWeide(pg, from, to),
        ])
        return parcelMetrics(
          [...stored.rows.map((r) => ({ ...r, entry_date: isoDate(r.entry_date) ?? '' })), ...derived.map((d) => ({ parcel_id: d.parcel_id, entry_date: d.entry_date, usage_type: 'weide' }))],
          todayIso(),
        )
      })
      .then((m) => active && setMetrics(m))
    return () => {
      active = false
    }
  }, [mode, seasonYear])

  useEffect(() => {
    if (mode !== 'kultur' && !metrics) return
    const today = todayIso()
    const valueOf = (p: Parcel): number | null => {
      const m = metrics?.get(p.id)
      if (mode === 'schnitte') return m?.cuts ?? 0
      if (mode === 'weidetage') return m?.grazingDays ?? 0
      if (mode === 'ruhe') return m?.lastUse ? daysBetween(m.lastUse, today) : null
      return null
    }
    const features = parcels
      .filter((p) => p.base_geometry)
      .map((p) => ({ type: 'Feature' as const, properties: { id: p.id }, geometry: JSON.parse(p.base_geometry!) }))
    const byId = new Map(parcels.map((p) => [p.id, p]))
    const cultures = cultureColors(parcels)
    const fillOf = (p: Parcel): string | null => {
      if (mode === 'kultur') return p.kultur_name_de ? (cultures.color.get(p.kultur_name_de) ?? null) : null
      const v = valueOf(p)
      if (v == null) return null
      const i = classIndex(v, BREAKS[mode])
      return i < 0 ? null : RAMP[i]
    }
    const layer = L.geoJSON({ type: 'FeatureCollection', features } as never, {
      style: (f) => {
        const p = byId.get((f?.properties as { id: string }).id)!
        const fill = fillOf(p)
        return fill ? { color: '#1f2937', weight: 0.6, fillColor: fill, fillOpacity: 0.65 } : { color: '#6b7280', weight: 0.6, fillOpacity: 0 }
      },
      onEachFeature: (f, l) => {
        const p = byId.get((f.properties as { id: string }).id)!
        const m = metrics?.get(p.id)
        const text =
          mode === 'kultur'
            ? p.kultur_name_de ?? p.kultur_code ?? ''
            : mode === 'ruhe'
              ? m?.lastUse
                ? `${valueOf(p)} Tage seit ${new Date(`${m.lastUse}T12:00:00`).toLocaleDateString('de-CH')}`
                : `keine Nutzung ${seasonYear}`
              : `${valueOf(p)} ${UNIT[mode]}`
        l.bindTooltip(`${p.name} · ${text}`, { sticky: true })
      },
    })
    layer.addTo(map)

    const Legend = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'rounded bg-white/90 p-2 text-[10px] leading-tight shadow max-w-[11rem]')
        const swatch = (c: string) => `<span style="background:${c};width:14px;height:10px;display:inline-block;border:1px solid #1f2937;flex:none"></span>`
        if (mode === 'kultur') {
          div.innerHTML =
            `<div class="mb-1 font-semibold">${COLOR_MODE_LABEL.kultur} (nach Fläche)</div>` +
            cultures.legend.map(([name, c]) => `<div class="flex items-center gap-1">${swatch(c)}<span class="truncate">${name}</span></div>`).join('')
        } else {
          div.innerHTML =
            `<div class="mb-1 font-semibold">${COLOR_MODE_LABEL[mode]} ${seasonYear}</div>` +
            legendLabels(BREAKS[mode])
              .map((l, i) => `<div class="flex items-center gap-1">${swatch(RAMP[i])}${l}</div>`)
              .join('') +
            `<div class="mt-0.5 flex items-center gap-1"><span style="width:14px;height:10px;display:inline-block;border:1px solid #6b7280"></span>${mode === 'ruhe' ? 'nicht genutzt' : '0'}</div>`
        }
        return div
      },
    })
    const legend = new Legend({ position: 'bottomleft' })
    legend.addTo(map)
    return () => {
      map.removeLayer(layer)
      map.removeControl(legend)
    }
  }, [map, parcels, mode, metrics, seasonYear])

  return null
}
