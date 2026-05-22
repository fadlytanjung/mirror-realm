// apps/web/src/services/compression.ts
// docs: 08-frontend-app.md#sharing · 13-security.md#input
//
// lz-string Base64URL round-trip for sharing a Level inline in a URL.
// Decompression is untrusted input — validated before returning.
import LZString from 'lz-string'
import type { Level } from '../domain/level'
import { isLevel } from './validate'

export function compress(level: Level): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(level))
}

export function decompress(s: string): Level | null {
  let parsed: unknown
  try {
    const json = LZString.decompressFromEncodedURIComponent(s)
    if (!json) return null
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  return isLevel(parsed) ? parsed : null
}
