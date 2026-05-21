// apps/web/src/services/validate.ts
// docs: 13-security.md#input · 04-domain-model.md#level
//
// Hand-written runtime guard for untrusted Level input (QR scans, /p/ URLs).
// Mirrors the JSON Schema constraints loosely — enough to reject garbage before
// Phaser tries to render it. The server re-validates authoritatively.
import type { Level, Vibe } from '../domain/level'
import { VIBE_IDS } from '../domain/vibes'

const inWorld = (n: unknown, max: number): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max

function isRect(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return inWorld(r.x, 1920) && inWorld(r.y, 540) && inWorld(r.w, 1920) && inWorld(r.h, 540)
}

function isPoint(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return inWorld(p.x, 1920) && inWorld(p.y, 540)
}

export function isLevel(v: unknown): v is Level {
  if (typeof v !== 'object' || v === null) return false
  const l = v as Record<string, unknown>
  if (l.schemaVersion !== '1.0.0') return false
  if (!VIBE_IDS.includes(l.vibe as Vibe)) return false
  if (!Array.isArray(l.platforms) || l.platforms.length < 4 || l.platforms.length > 12) return false
  if (!l.platforms.every(isRect)) return false
  if (l.hazards !== undefined && (!Array.isArray(l.hazards) || !l.hazards.every(isRect))) return false
  if (!isPoint(l.spawn) || !isPoint(l.goal)) return false
  return true
}
