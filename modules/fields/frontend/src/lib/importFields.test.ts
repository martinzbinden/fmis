import { describe, expect, it } from 'vitest'
import { sameGeometry } from './importFields'

describe('sameGeometry', () => {
  const full = JSON.stringify({ type: 'Polygon', coordinates: [[[7.123456789012345, 46.87654321098765], [7.2, 46.9], [7.123456789012345, 46.87654321098765]]] })
  const rounded = '{"type":"Polygon","coordinates":[[[7.123456789,46.876543211],[7.2,46.9],[7.123456789,46.876543211]]]}'

  it('erkennt dieselbe Fläche trotz gerundeter Koordinaten', () => {
    expect(sameGeometry(full, rounded)).toBe(true)
  })

  it('erkennt echte Änderungen', () => {
    expect(sameGeometry(full, rounded.replace('7.2,', '7.2001,'))).toBe(false)
    expect(sameGeometry(full, rounded.replace('Polygon', 'MultiPolygon'))).toBe(false)
    expect(sameGeometry(full, null)).toBe(false)
  })
})
