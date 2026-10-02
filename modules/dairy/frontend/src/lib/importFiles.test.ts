import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { classifyFile, expandImportFiles } from './importFiles'

describe('classifyFile', () => {
  it('erkennt die Dateiarten', () => {
    expect(classifyFile('b9999999.K04', '').kind).toBe('herdbook')
    expect(classifyFile('export/b9999999.Y01', '').kind).toBe('herdbook')
    expect(classifyFile('AA_123.pdf', '').kind).toBe('certificate')
    expect(classifyFile('Tierbestand.xlsx', '').kind).toBe('tvd')
    expect(classifyFile('CODE.C01', '').kind).toBe('ignored')
    expect(classifyFile('__MACOSX/._b1.K04', '').kind).toBe('ignored')
    expect(classifyFile('daten.txt', 'K04 99 …\r\nK04 …').kind).toBe('herdbook')
    expect(classifyFile('notiz.txt', 'Hallo').kind).toBe('ignored')
  })
})

describe('expandImportFiles', () => {
  it('entpackt ZIP, auch verschachtelt', async () => {
    const inner = new JSZip()
    inner.file('b1.K33', 'K33 …')
    const outer = new JSZip()
    outer.file('stammdaten/b1.Y01', 'Y01 …')
    outer.file('stammdaten/CODE.C01', 'code')
    outer.file('ausweis.pdf', '%PDF-1.4')
    outer.file('nested.zip', await inner.generateAsync({ type: 'uint8array' }))
    const zipBytes = await outer.generateAsync({ type: 'arraybuffer' })
    const files = await expandImportFiles([new File([zipBytes], 'export.zip'), new File(['x'], 'Tierbestand.xlsx')])
    expect(files.map((f) => [f.name, f.kind]).sort()).toEqual(
      [
        ['Tierbestand.xlsx', 'tvd'],
        ['ausweis.pdf', 'certificate'],
        ['b1.K33', 'herdbook'],
        ['stammdaten/CODE.C01', 'ignored'],
        ['stammdaten/b1.Y01', 'herdbook'],
      ].sort(),
    )
  })
})
