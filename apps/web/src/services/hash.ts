// apps/web/src/services/hash.ts
// docs: 04-domain-model.md#submission
//
// Client-side content hash. Mirrors the server: sha256(canonical_json(level))[:12].
// Canonical JSON = keys sorted, no insignificant whitespace.
import type { Level } from '../domain/level'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

export async function contentHash(level: Level): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(level))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}
