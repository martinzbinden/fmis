import { describe, expect, it } from 'vitest'
import { suggestMeta, titleFromFilename, type PdfFacts } from './docMeta'

const facts = (p: Partial<PdfFacts>): PdfFacts => ({ filename: 'x.pdf', info: {}, lines: [], text: '', fields: [], ...p })

describe('Angaben aus dem PDF vorschlagen', () => {
  it('BLV-Formular Begleitdokument: grösste Schrift ohne «ORIGINAL», neueste Auflage, erkannt am Feldmuster', () => {
    const m = suggestMeta(
      facts({
        filename: 'begleitdokument-klauentiere-de.pdf',
        lines: [
          { text: 'ORIGINAL', size: 28 },
          { text: 'Schweizerische Eidgenossenschaft', size: 7 },
          { text: 'Begleitdokument für Klauentiere', size: 16 },
          { text: '1. Herkunftsbetrieb', size: 9 },
        ],
        text: 'Schweizerische Eidgenossenschaft Begleitdokument für Klauentiere Auflage 2018 Auflage 2023 Fahrzeit',
        fields: ['TVD-Nr', 'Total Tiere', 'Name in Blockschrift', 'Check Box14'],
      }),
    )
    expect(m).toEqual({ title: 'Begleitdokument für Klauentiere', source: 'Bund', edition: 'Auflage 2023', topic: 'transport', kind: 'formular', form_key: 'begleitdokument_klauentiere' })
  })

  it('Tierliste erkannt; unbekanntes Formular nur «ausfüllbar»', () => {
    expect(suggestMeta(facts({ fields: ['Tierliste_Erstellungsdatum', 'Anzahl Tiere'] })).form_key).toBe('tierliste_klauentiere')
    expect(suggestMeta(facts({ fields: ['Feld 1'] }))).toMatchObject({ kind: 'formular', form_key: null })
  })

  it('Merkblatt: Titel aus der Dokumentinfo, Herausgeber aus dem Text, sonst Erstellungsjahr', () => {
    const m = suggestMeta(
      facts({
        info: { Title: 'Merkblatt Nutztiertransporte', Author: 'mmuster', CreationDate: 'D:20180312101500' },
        text: 'INFORAMA Rütti … Tiere verladen',
      }),
    )
    expect(m).toMatchObject({ title: 'Merkblatt Nutztiertransporte', source: 'INFORAMA', edition: '2018', topic: 'transport', kind: 'merkblatt' })
  })

  it('unbrauchbarer Titel in der Dokumentinfo → Text oder Dateiname', () => {
    expect(suggestMeta(facts({ info: { Title: 'Microsoft Word - entwurf3.docx' }, lines: [{ text: 'Weidehaltung im Winter', size: 20 }] })).title).toBe('Weidehaltung im Winter')
    expect(suggestMeta(facts({ filename: 'Flyer_Merkblatt_Nutztiertransport_ES.pdf' })).title).toBe('Flyer Merkblatt Nutztiertransport ES')
    expect(titleFromFilename('tierliste_zu_begleitdokument-de.pdf')).toBe('Tierliste zu begleitdokument')
  })
})
