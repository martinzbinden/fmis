import { describe, expect, it } from 'vitest'
import { isIconName } from '@fmis/core/AppIcon'
import { captureInfo, CAPTURE_PATHS } from './lastCapture'
import { menuItems } from './menuItems'

describe('Symbole im Menü «Mehr» und in der Fussleiste', () => {
  it('jede Funktion hat ein gezeichnetes Symbol (kein Emoji)', () => {
    for (const sheep of [true, false]) for (const m of menuItems(sheep, 40)) expect(isIconName(m.icon), `${m.label}: ${m.icon}`).toBe(true)
    for (const p of CAPTURE_PATHS) expect(isIconName(captureInfo(p, true)!.icon), p).toBe(true)
  })
})
