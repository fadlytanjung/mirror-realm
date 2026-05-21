// apps/web/tests/unit/compression.test.ts
// docs: 09-features.md#f3-share AC3.1
import { describe, it, expect } from 'vitest'
import { compress, decompress } from '../../src/services/compression'
import type { Level } from '../../src/domain/level'

const sample: Level = {
  schemaVersion: '1.0.0',
  vibe: 'cozy',
  platforms: [
    { x: 0, y: 480, w: 320, h: 48 },
    { x: 480, y: 420, w: 160, h: 32 },
    { x: 820, y: 360, w: 160, h: 32 },
    { x: 1700, y: 480, w: 220, h: 48 },
  ],
  hazards: [],
  decorations: [],
  spawn: { x: 50, y: 50 },
  goal: { x: 1860, y: 440 },
}

describe('compression', () => {
  it('round-trips a Level losslessly (AC3.1)', () => {
    const out = decompress(compress(sample))
    expect(out).toEqual(sample)
  })

  it('rejects garbage', () => {
    expect(decompress('not-a-real-payload')).toBeNull()
  })

  it('rejects a structurally-invalid level', () => {
    const bad = { ...sample, platforms: [] }
    const encoded = compress(bad as unknown as Level)
    expect(decompress(encoded)).toBeNull()
  })
})
