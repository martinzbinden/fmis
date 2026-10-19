// Testdaten (synthetisch): eine Leitung, ein Schacht, ein Gebäude, zwei Messpunkte.
import { lv95ToWgs84 } from '@fmis/core/lv95'
import type { BauFeature, SurveyPoint } from '../types'

const ll = (e: number, n: number) => lv95ToWgs84([e, n])

export const base = {
  project_id: 'p1',
  notes: null,
  material: null,
  diameter_mm: null,
  depth_cm: null,
  sort_order: 0,
  created_by: null,
  updated_at: '2026-10-19T10:00:00Z',
  deleted_at: null,
  plan_geometry: null,
}

export const lineGeom = { type: 'LineString', coordinates: [ll(2597000, 1182000), ll(2597100, 1182000), ll(2597100, 1182050)] }

export const FEATURES: BauFeature[] = [
  { ...base, id: 'f1', category: 'guelle', status: 'geplant', label: 'Gülleleitung', material: 'PE 100 ND16', diameter_mm: 90, depth_cm: 120, notes: 'Einpflügen & "Test" <1>', geometry: JSON.stringify(lineGeom) },
  { ...base, id: 'f2', category: 'schacht', status: 'eingemessen', label: 'Schacht 1', geometry: JSON.stringify({ type: 'Point', coordinates: ll(2597050, 1182010) }) },
  { ...base, id: 'f3', category: 'gebaeude', status: 'geplant', label: 'Hof', geometry: JSON.stringify({ type: 'Polygon', coordinates: [[ll(2597200, 1182000), ll(2597210, 1182000), ll(2597210, 1182010), ll(2597200, 1182010), ll(2597200, 1182000)]] }) },
  { ...base, id: 'f4', category: 'leerrohr', status: 'verworfen', label: 'Alt', geometry: JSON.stringify({ type: 'LineString', coordinates: [ll(2597000, 1182100), ll(2597010, 1182100)] }) },
]

const [lng1, lat1] = ll(2597010, 1182001)
const [lng2, lat2] = ll(2597030, 1182002)
export const POINTS: SurveyPoint[] = [
  { id: 's1', project_id: 'p1', feature_id: 'f1', point_no: 1, seq: 1, lat: lat1, lng: lng1, accuracy_m: 1.4, altitude_m: 523.46, depth_cm: 110, note: 'Anfang; "Bogen"', measured_at: '2026-11-05T08:15:30Z', measured_by: 'martin@x.ch', updated_at: '2026-11-05T08:15:30Z', deleted_at: null },
  { id: 's2', project_id: 'p1', feature_id: 'f1', point_no: 2, seq: 2, lat: lat2, lng: lng2, accuracy_m: null, altitude_m: null, depth_cm: null, note: null, measured_at: '2026-11-05T08:20:00Z', measured_by: null, updated_at: '2026-11-05T08:20:00Z', deleted_at: null },
]
