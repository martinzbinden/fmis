// Druck «Wiesenjournal» im Format der AGFF (Etappe 5, E6; Muster aus der AGFF-Anleitung): A4 quer, drei Monate je Seite,
// je Parzelle oben Nutzung und unten Düngung, hinten die Stickstoffdüngung je Gabe, unten Laufhof, Wetter, Niederschlag,
// Mond. Keine PDF-Bibliothek: @page und @media print (index.css); «Als PDF sichern» kann jeder Browser.
import { Fragment, useMemo, useState } from 'react'
import { Link } from '../fmis/router'
import { useQuery } from '../hooks/useQuery'
import { useYear } from '../hooks/useYear'
import { useRegen } from '../hooks/useRegen'
import { regenAm, regenStand } from '../lib/regen'
import { druckSeite, MAX_GABEN, ZEITRAEUME, type DruckSeite, type ZeitraumKey } from '../lib/druck'
import { ANIMAL_CATEGORY_LABEL, ANIMAL_CATEGORY_LETTER, fmtDate, fmtNum, todayIso, UNIT_LABEL } from '../lib/format'
import { loadFertilizerTypes } from '../lib/fertilization'

const MONAT = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/** Zeitraum mit dem heutigen Tag (für die Vorwahl) */
function aktuellerZeitraum(): ZeitraumKey {
  const m = Number(todayIso().slice(5, 7))
  return m >= 3 && m <= 5 ? 'fruehling' : m >= 6 && m <= 8 ? 'sommer' : m >= 9 && m <= 11 ? 'herbst' : 'winter'
}

export default function DruckPage() {
  const [year] = useYear()
  const [wahl, setWahl] = useState<ZeitraumKey[]>(() => [aktuellerZeitraum()])
  const [leer, setLeer] = useState(3)
  const regen = useRegen(year)
  const { data } = useQuery(
    (s) => {
      const seiten = ZEITRAEUME.filter((z) => wahl.includes(z.key)).map((z) => ({ key: z.key, seite: druckSeite(s, year, z.key, (d) => regenAm(regen, d)) }))
      const betrieb = [...new Set(s.rows('parcels').filter((p) => p.season_year === year).map((p) => p.farm_name).filter(Boolean))].join(', ')
      // Düngerarten, die auf den Seiten vorkommen (Legende unten wie im Original)
      const codes = new Set(seiten.flatMap((x) => x.seite.zeilen.flatMap((z) => [...z.duengung.values()].flatMap((t) => t.split(' + ').map((u) => u.split(' ').pop()!)))))
      const typen = loadFertilizerTypes(s, false).filter((t) => codes.has(t.code))
      return { seiten, betrieb, typen, regenBis: regenStand(regen[year]) }
    },
    [year, wahl, regen],
  )
  const tierLegende = useMemo(() => {
    const k = new Set(data.seiten.flatMap((x) => x.seite.laufhof.map((l) => l.kategorie)))
    return [...k].map((c) => `${ANIMAL_CATEGORY_LETTER[c]} = ${ANIMAL_CATEGORY_LABEL[c]}`).join(', ')
  }, [data])

  return (
    <div className="space-y-3 p-3 print:p-0" data-testid="druck">
      <div className="space-y-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-gray-800">Wiesenjournal drucken</h1>
          <Link to="/jahr" className="ml-auto text-sm text-brand-700 underline">
            ← zum Jahr
          </Link>
        </div>
        <p className="text-sm text-gray-700">
          Im Format des AGFF-Wiesenjournals: A4 quer, drei Monate je Seite. Im Druckdialog «Als PDF sichern» wählen, wer eine Datei
          will. Hintergrundgrafiken müssen nicht eingeschaltet sein.
        </p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Seiten">
          {ZEITRAEUME.map((z) => (
            <label key={z.key} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-400 bg-white px-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={wahl.includes(z.key)}
                onChange={(e) => setWahl((w) => (e.target.checked ? [...w, z.key] : w.filter((x) => x !== z.key)))}
              />
              {z.text}
            </label>
          ))}
          <label className="flex items-center gap-1 text-sm text-gray-700">
            leere Zeilen
            <select className="inp min-h-10 py-1 text-sm" value={leer} onChange={(e) => setLeer(Number(e.target.value))}>
              {[0, 3, 6, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary ml-auto" onClick={() => window.print()} disabled={!data.seiten.length} data-testid="drucken">
            🖨 Drucken
          </button>
        </div>
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        {data.seiten.map(({ key, seite }) => (
          <Seite key={key} seite={seite} jahr={year} betrieb={data.betrieb} leer={leer} typen={data.typen} tierLegende={tierLegende} regenBis={data.regenBis} />
        ))}
      </div>
    </div>
  )
}

type Typ = ReturnType<typeof loadFertilizerTypes>[number]

function Seite({
  seite,
  jahr,
  betrieb,
  leer,
  typen,
  tierLegende,
  regenBis,
}: {
  seite: DruckSeite
  jahr: number
  betrieb: string
  leer: number
  typen: Typ[]
  tierLegende: string
  /** letzter Tag mit automatischem Wert */
  regenBis: string | null
}) {
  const monate: { m: number; n: number }[] = []
  for (const d of seite.tage) {
    const m = Number(d.slice(5, 7)) - 1
    if (monate[monate.length - 1]?.m === m) monate[monate.length - 1].n++
    else monate.push({ m, n: 1 })
  }
  const tagKlasse = (d: string) => {
    const t = Number(d.slice(8, 10))
    return `dr-tag${t === 1 ? ' dr-monat' : t % 5 === 0 ? ' dr-fuenf' : ''}`
  }
  const tagZellen = (werte: Map<string, string>, klasse: string | ((d: string) => string) = '') =>
    seite.tage.map((d) => (
      <td key={d} className={`${tagKlasse(d)} ${typeof klasse === 'function' ? klasse(d) : klasse}`}>
        {werte.get(d) ?? ''}
      </td>
    ))
  const nLeer = Array.from({ length: MAX_GABEN + 2 })

  return (
    <section className="druck-seite" aria-label={`Wiesenjournal ${jahr}, ${MONAT[monate[0].m]}–${MONAT[monate[monate.length - 1].m]}`}>
      <header className="dr-kopf">
        <div>
          <div className="dr-titel">Wiesenjournal {jahr}</div>
          <div>– Nutzung, Düngung und Pflege der Wiesen</div>
          <div>– Weide und Auslauf der Tiere</div>
          {betrieb && <div className="dr-betrieb">{betrieb}</div>}
        </div>
        <div className="dr-legende">
          <b>Nutzung</b> (obere Zeile): / Eingrasen · {tierLegende || 'X = Kühe'}: Weide · S Silage · DB Dürrfutter belüftet · DU Dürrfutter unbelüftet · P Weide putzen · B Blacken · Ü
          Übersaat
          <br />
          <b>Düngung</b> (untere Zeile, Menge Mist, Gülle oder Dünger; hinterste Spalten N verfügbar je ha und Gabe):{' '}
          {typen.length ? typen.map((t) => `${t.code} ${t.name} in ${UNIT_LABEL[t.unit] ?? t.unit}`).join(' · ') : 'keine Gaben auf diesen Seiten'}
          <br />
          <b>Gülleverdünnung beachten!</b>
        </div>
      </header>
      <table className="dr-tabelle">
        <colgroup>
          <col className="dr-c-name" />
          <col className="dr-c-no" />
          <col className="dr-c-aren" />
          <col className="dr-c-typ" />
          <col className="dr-c-int" />
          {seite.tage.map((d) => (
            <col key={d} />
          ))}
          {nLeer.map((_, i) => (
            <col key={i} className="dr-c-n" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>Parzelle/Schlag</th>
            <th rowSpan={2}>No</th>
            <th rowSpan={2}>Aren</th>
            <th rowSpan={2}>Wiesentyp Leitgras Mischung</th>
            <th rowSpan={2} title="Intensität">
              Int.
            </th>
            {monate.map((x) => (
              <th key={x.m} colSpan={x.n} className="dr-monat">
                {MONAT[x.m]}
              </th>
            ))}
            <th colSpan={MAX_GABEN + 2}>Stickstoffdüngung (N verf.)</th>
          </tr>
          <tr>
            {seite.tage.map((d) => {
              const t = Number(d.slice(8, 10))
              return (
                <th key={d} className={`${tagKlasse(d)} dr-tagnr`}>
                  {t % 5 === 0 ? t : ''}
                </th>
              )
            })}
            <th>geplant</th>
            {Array.from({ length: MAX_GABEN }).map((_, i) => (
              <th key={i}>{i + 1}. Gabe</th>
            ))}
            <th>total</th>
          </tr>
        </thead>
        <tbody>
          {seite.zeilen.map((z) => (
            <Fragment key={z.parcel.id}>
              <tr className="dr-oben" data-druck-parzelle={z.parcel.name}>
                <td rowSpan={2} className="dr-name">
                  {z.parcel.name}
                </td>
                <td rowSpan={2} className="dr-zahl">
                  {z.no}
                </td>
                <td rowSpan={2} className="dr-zahl">
                  {z.parcel.area_a != null ? fmtNum(z.parcel.area_a, 0) : ''}
                </td>
                <td rowSpan={2} className="dr-typ">
                  {z.parcel.wiesentyp ?? z.parcel.kultur_name_de?.replace(/\s*\(.*\)$/, '') ?? ''}
                </td>
                <td rowSpan={2} className="dr-zahl">
                  {z.parcel.intensitaet ?? ''}
                </td>
                {tagZellen(z.nutzung, 'dr-nutzung')}
                <td rowSpan={2} className="dr-n" />
                {Array.from({ length: MAX_GABEN }).map((_, i) => (
                  <td key={i} rowSpan={2} className="dr-n">
                    {z.gaben[i] ?? ''}
                  </td>
                ))}
                <td rowSpan={2} className="dr-n dr-total">
                  {z.total ?? ''}
                </td>
              </tr>
              <tr className="dr-unten">
                {seite.tage.map((d) => (
                  <td key={d} className={tagKlasse(d)}>
                    {z.duengung.has(d) && <span className="dr-gabe">{z.duengung.get(d)}</span>}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
          {Array.from({ length: leer }).map((_, i) => (
            <Fragment key={`leer${i}`}>
              <tr className="dr-oben">
                <td rowSpan={2} />
                <td rowSpan={2} />
                <td rowSpan={2} />
                <td rowSpan={2} />
                <td rowSpan={2} />
                {seite.tage.map((d) => (
                  <td key={d} className={tagKlasse(d)} />
                ))}
                {nLeer.map((_, j) => (
                  <td key={j} rowSpan={2} className="dr-n" />
                ))}
              </tr>
              <tr className="dr-unten">
                {seite.tage.map((d) => (
                  <td key={d} className={tagKlasse(d)} />
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
        {/* im Fuss der Tabelle: der Browser wiederholt ihn unten auf jeder gedruckten Seite, wie im Original */}
        <tfoot>
          {seite.laufhof.map((l) => (
            <tr key={l.kategorie} className="dr-hof">
              <td colSpan={5}>
                Laufhof {ANIMAL_CATEGORY_LABEL[l.kategorie]} (X Weide, L Laufhof, 0 kein Auslauf)
              </td>
              {tagZellen(l.werte)}
              <td colSpan={MAX_GABEN + 2} />
            </tr>
          ))}
          <tr className="dr-hof">
            <td colSpan={5}>Wetter (O = Sonne, / = Regen)</td>
            {tagZellen(seite.wetter)}
            <td colSpan={MAX_GABEN + 2} />
          </tr>
          <tr className="dr-hof">
            <td colSpan={5}>Niederschlag (mm; gerade = von Hand, kursiv = automatisch)</td>
            {tagZellen(seite.regen, (d) => (seite.regenHand.has(d) ? 'dr-mm dr-mm-hand' : 'dr-mm'))}
            <td colSpan={MAX_GABEN + 2} className="dr-mm-summe" data-druck-regen-summe>
              {seite.regenSumme != null ? `Σ ${seite.regenSumme} mm` : ''}
            </td>
          </tr>
          <tr className="dr-hof">
            <td colSpan={5}>Mond</td>
            {tagZellen(seite.mond)}
            <td colSpan={MAX_GABEN + 2} />
          </tr>
        </tfoot>
      </table>
      <footer className="dr-fuss">
        AGFF Wiesenjournal · gedruckt {new Date().toLocaleDateString('de-CH')} · N verf. = verfügbarer Stickstoff in kg je ha und Gabe, aus Menge und Gehalt der
        Düngerart · Niederschlag von Hand eingetragen, sonst automatisch (MeteoSchweiz über graswachstum.ch{regenBis ? `, bis ${fmtDate(regenBis)}` : ''})
      </footer>
    </section>
  )
}
