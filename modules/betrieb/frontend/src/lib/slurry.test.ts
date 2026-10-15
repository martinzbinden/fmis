import { describe, expect, it } from 'vitest'
import { axisDiff, bearingDeg, calibrate, coverageRuns, emptyTank, fieldAxis, fieldShape, mainField, planSpreading, rateAt, recentSpeed, speedFor, step, type TankState } from './slurry'

// Rechteck 200 m (Ost-West) × 50 m bei 47° N
const LAT = 47
const LNG = 7.5
const mPerDegLat = 111195
const mPerDegLng = 111195 * Math.cos((LAT * Math.PI) / 180)
const at = (east: number, north: number) => ({ lat: LAT + north / mPerDegLat, lng: LNG + east / mPerDegLng })
const rect = JSON.stringify({
  type: 'Polygon',
  coordinates: [[at(0, 0), at(200, 0), at(200, 50), at(0, 50), at(0, 0)].map((p) => [p.lng, p.lat])],
})

describe('slurry', () => {
  it('Feldachse: lange Seite Ost-West, 200 × 50 m', () => {
    const a = fieldAxis(rect)!
    expect(a.lengthM).toBeCloseTo(200, -1)
    expect(a.widthM).toBeCloseTo(50, -1)
    expect(a.axisDeg).toBe(90)
  })

  it('Richtung und Abweichung von der Achse', () => {
    expect(bearingDeg(at(0, 0), at(10, 0))).toBeCloseTo(90, 0)
    expect(bearingDeg(at(0, 0), at(-10, 0))).toBeCloseTo(270, 0)
    expect(axisDiff(270, 90)).toBe(0)
    expect(axisDiff(10, 90)).toBe(80)
  })

  it('Schieber auf: nur in Feldrichtung im Feld, Wenden zählt nicht', () => {
    const field = fieldShape('p1', rect)!
    let s: TankState = emptyTank()
    let t = 0
    const go = (east: number, north: number) => {
      t += 5000
      s = step(s, { ...at(east, north), t }, [field]).state
    }
    go(10, 10)
    for (let e = 20; e <= 190; e += 10) go(e, 10) // 180 m Ost, 2 m/s
    expect(s.distM).toBeCloseTo(180, -1)
    expect(s.spreadS).toBe(90)
    go(190, 20) // Wenden quer zur Achse
    go(190, 30)
    expect(s.spreading).toBe(false)
    expect(s.distM).toBeCloseTo(180, -1)
    go(180, 30) // zurück nach West zählt wieder
    expect(s.spreading).toBe(true)
    expect(mainField(s)).toBe('p1')
  })

  it('Fass gilt als leer, wenn das Feld 2 Minuten verlassen wird', () => {
    const field = fieldShape('p1', rect)!
    let s: TankState = emptyTank()
    let t = 0
    for (let e = 10; e <= 100; e += 10) s = step(s, { ...at(e, 10), t: (t += 5000) }, [field]).state
    let auto = null
    for (let i = 0; i < 30 && !auto; i++) {
      const r = step(s, { ...at(300 + i * 10, 10), t: (t += 10000) }, [field])
      s = r.state
      auto = r.autoEmpty
    }
    expect(auto?.distM).toBeCloseTo(90, -1)
    expect(s.distM).toBe(0)
  })

  it('Geschwindigkeit der letzten Sekunden', () => {
    const pts = [0, 1, 2, 3, 4, 5].map((i) => ({ ...at(i * 2, 0), t: i * 1000 }))
    expect(recentSpeed(pts)).toBeCloseTo(2, 1)
  })

  it('Startwerte: 6.5 m³ nach 180 m bei 7 m ≈ 52 m³/ha; 25 m³/ha braucht ≈ 371 m', () => {
    // 180 m in 3.5 min ≈ 3.1 km/h → Ausfluss 1.86 m³/min
    const flow = 6.5 / 3.5
    expect(rateAt(flow, 180 / 210, 7)).toBeCloseTo(51.6, 0)
    expect(speedFor(flow, 25, 7)).toBeCloseTo(6.4, 1)
    const plan = planSpreading({ tankM3: 6.5, widthM: 7, flowM3Min: flow, targetM3Ha: 25, fieldLengthM: 150, areaHa: 1.2 })
    expect(plan.distPerTankM).toBeCloseTo(371, 0)
    expect(plan.tanks).toBeCloseTo(4.6, 1)
    // 371 m / 150 m = 2.5 Bahnen → 2 oder 3; 3 Bahnen = 20.6 m³/ha (−17 %), 2 = 31 m³/ha (+24 %)
    expect(plan.options.map((o) => o.lanes)).toEqual([3, 2])
    expect(plan.options[0].rateM3Ha).toBeCloseTo(20.6, 1)
  })

  it('Eichung: Median der letzten Knopf-Fässer, Ausreisser weg', () => {
    const e = (dist: number, s: number, source: 'knopf' | 'auto' = 'knopf') => ({ source, volume_m3: 6.5, distance_m: dist, spread_s: s, width_m: 7 })
    const c = calibrate([e(180, 210), e(185, 200), e(10, 5), e(400, 300, 'auto'), e(175, 220)], 1.9)
    expect(c.n).toBe(3)
    expect(c.flowM3Min).toBeCloseTo(6.5 / 3.5, 2)
    expect(c.rateM3Ha).toBeCloseTo(51.6, 0)
    expect(calibrate([], 1.9)).toEqual({ flowM3Min: 1.9, rateM3Ha: null, n: 0 })
  })
})

describe('coverageRuns', () => {
  it('Bahnen als Abschnitte, Wendebogen und Fahrt ausserhalb fallen weg', () => {
    const field = fieldShape('p1', rect)!
    const pts: { lat: number; lng: number; t: number }[] = []
    let t = 0
    const add = (e: number, n: number) => pts.push({ ...at(e, n), t: (t += 2000) })
    for (let e = 5; e <= 195; e += 5) add(e, 10) // Bahn 1 nach Ost
    add(198, 13) // Wendebogen
    add(199, 17)
    add(198, 21)
    for (let e = 195; e >= 5; e -= 5) add(e, 24) // Bahn 2 nach West
    for (let e = 0; e >= -100; e -= 5) add(e, 24) // hinaus
    const runs = coverageRuns(pts, [field])
    expect(runs).toHaveLength(2)
    expect(runs[0].length).toBeGreaterThan(30)
  })
})
