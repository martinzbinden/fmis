// CSV der Messpunkte — das übliche Austauschformat mit dem Geometer.
// Trennzeichen «;» (Schweizer Excel), UTF-8 mit BOM, Punkt als Dezimalzeichen.

import { wgs84ToLv95 } from '@fmis/core/lv95'
import { csvField } from './text'
import type { BauFeature, SurveyPoint } from '../types'

export const SURVEY_CSV_HEADER = [
  'Punktnummer',
  'Objekt',
  'E (LV95)',
  'N (LV95)',
  'Höhe GPS (m)',
  'Tiefe (cm)',
  'Genauigkeit (m)',
  'Datum',
  'Erfasser',
  'Notiz',
]

const zurich = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Zurich',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/** Messzeit in Schweizer Ortszeit («2026-11-05 09:15:30»), unabhängig von der Zeitzone des Geräts. */
export const localDateTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 19).replace('T', ' ') : zurich.format(d)
}

export const pointLabel = (no: number) => `P${String(no).padStart(3, '0')}`

export function buildSurveyCsv(points: SurveyPoint[], features: BauFeature[]): string {
  const names = new Map(features.map((f) => [f.id, f.label ?? '']))
  const rows = [...points]
    .sort((a, b) => a.point_no - b.point_no)
    .map((p) => {
      const [e, n] = wgs84ToLv95([p.lng, p.lat])
      return [
        pointLabel(p.point_no),
        p.feature_id ? (names.get(p.feature_id) ?? '') : '',
        e.toFixed(2),
        n.toFixed(2),
        p.altitude_m != null ? p.altitude_m.toFixed(1) : '',
        p.depth_cm != null ? String(p.depth_cm) : '',
        p.accuracy_m != null ? p.accuracy_m.toFixed(1) : '',
        localDateTime(p.measured_at),
        p.measured_by ?? '',
        p.note ?? '',
      ]
        .map(csvField)
        .join(';')
    })
  return '﻿' + [SURVEY_CSV_HEADER.join(';'), ...rows].join('\r\n') + '\r\n'
}
