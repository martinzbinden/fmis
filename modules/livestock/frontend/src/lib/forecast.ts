// Reine Berechnungsfunktionen für die Ampel-Logik im Dashboard.
// Bewusst von der DB-Abfrage getrennt, damit die Regeln an einer Stelle stehen.

export type AmpelStatus = 'bald_schlachtreif' | 'im_plan' | 'achtung'

export interface AnimalForecastInput {
  lastWeighDate: string | null
  lastWeight: number | null
  prevWeighDate: string | null
  prevWeight: number | null
  targetMinKg: number
  targetMaxKg: number
  withdrawalUntil: string | null // date + withdrawal_days der letzten Medikamentengabe
  today?: string // ISO date, default = heute (für Tests überschreibbar)
}

export interface AnimalForecast {
  adgKgPerDay: number | null // Tageszunahme
  forecastDate: string | null // Prognosedatum bis target_weight_min_kg
  daysToTarget: number | null
  withdrawalOpen: boolean
  status: AmpelStatus
  reason: string
}

const LOW_ADG_THRESHOLD_KG = 0.15 // < 150 g/Tag gilt als zu niedrig für Lämmermast
const SOON_DAYS_THRESHOLD = 14

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay)
}

export function computeForecast(input: AnimalForecastInput): AnimalForecast {
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const withdrawalOpen = !!input.withdrawalUntil && input.withdrawalUntil >= today

  let adgKgPerDay: number | null = null
  if (
    input.lastWeighDate &&
    input.prevWeighDate &&
    input.lastWeight != null &&
    input.prevWeight != null &&
    input.lastWeighDate !== input.prevWeighDate
  ) {
    const days = daysBetween(input.prevWeighDate, input.lastWeighDate)
    if (days > 0) {
      adgKgPerDay = (input.lastWeight - input.prevWeight) / days
    }
  }

  let forecastDate: string | null = null
  let daysToTarget: number | null = null
  if (adgKgPerDay != null && adgKgPerDay > 0 && input.lastWeight != null && input.lastWeighDate) {
    const remainingKg = input.targetMinKg - input.lastWeight
    daysToTarget = remainingKg <= 0 ? 0 : Math.ceil(remainingKg / adgKgPerDay)
    const d = new Date(input.lastWeighDate)
    d.setDate(d.getDate() + daysToTarget)
    forecastDate = d.toISOString().slice(0, 10)
  }

  const alreadyInRange =
    input.lastWeight != null &&
    input.lastWeight >= input.targetMinKg &&
    input.lastWeight <= input.targetMaxKg

  let status: AmpelStatus
  let reason: string

  if (withdrawalOpen) {
    status = 'achtung'
    reason = `Absetzfrist offen bis ${input.withdrawalUntil}`
  } else if (adgKgPerDay != null && adgKgPerDay <= 0.02) {
    status = 'achtung'
    reason = 'Tageszunahme stagniert oder rückläufig'
  } else if (adgKgPerDay != null && adgKgPerDay < LOW_ADG_THRESHOLD_KG) {
    status = 'achtung'
    reason = `Tageszunahme zu niedrig (${Math.round(adgKgPerDay * 1000)} g/Tag)`
  } else if (alreadyInRange || (daysToTarget != null && daysToTarget <= SOON_DAYS_THRESHOLD)) {
    status = 'bald_schlachtreif'
    reason = alreadyInRange
      ? 'Zielgewicht erreicht'
      : `Zielgewicht in ca. ${daysToTarget} Tagen`
  } else {
    status = 'im_plan'
    reason = adgKgPerDay != null ? `${Math.round(adgKgPerDay * 1000)} g/Tag` : 'Zu wenig Wägungen für Prognose'
  }

  return { adgKgPerDay, forecastDate, daysToTarget, withdrawalOpen, status, reason }
}
