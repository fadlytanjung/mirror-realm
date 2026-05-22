// apps/web/src/routes/play.ts
// docs: 08-frontend-app.md#routing · 09-features.md#f4-open-shared
//
// Resolves the three "open a level someone gave me" sources into a Level:
//   inline (/p/<lz>)  · short (/l/<hash>)  · daily (#/daily)
import type { Route, PlaySource } from '../app'
import type { Level } from '../domain/level'
import { decompress } from '../services/compression'
import { getLevel, getDaily, ApiError } from '../services/api'
import { loadCache, saveCache, recordPlayed } from '../services/storage'
import { contentHash } from '../services/hash'
import { toast } from '../ui/toast'

export interface ResolvedLevel {
  level: Level
  source: PlaySource
  isFromYesterday?: boolean
}

const DAILY_CACHE_KEY = 'daily:today'
const DAILY_TTL_MS = 60 * 60 * 1000

export async function resolvePlaySource(route: Route): Promise<ResolvedLevel | null> {
  if (route.name === 'inline') {
    const level = decompress(route.payload)
    if (!level) return null
    await remember(level, 'short')
    return { level, source: 'short' }
  }

  if (route.name === 'short') {
    try {
      const { level } = await getLevel(route.payload)
      await remember(level, 'short')
      return { level, source: 'short' }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) return null
      toast('Network hiccup — try again.')
      return null
    }
  }

  // daily
  try {
    const res = await getDaily()
    await saveCache(DAILY_CACHE_KEY, res, DAILY_TTL_MS)
    await remember(res.level, 'daily')
    return { level: res.level, source: 'daily', isFromYesterday: res.isFromYesterday }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      toast("Daily World hasn't started yet — submit a level!")
      return null
    }
    // Offline fallback: last cached daily.
    const cached = await loadCache<{ level: Level; isFromYesterday: boolean }>(DAILY_CACHE_KEY)
    if (cached) return { level: cached.level, source: 'daily', isFromYesterday: true }
    toast('Could not reach the Daily World.')
    return null
  }
}

async function remember(level: Level, source: PlaySource): Promise<void> {
  await recordPlayed({ id: await contentHash(level), level, source, playedAt: Date.now() })
}
