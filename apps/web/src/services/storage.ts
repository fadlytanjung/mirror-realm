// apps/web/src/services/storage.ts
// docs: 08-frontend-app.md#offline · 13-security.md#privacy
//
// IndexedDB-backed cache + played-level history + the anonymous device hash.
import { openDB, type IDBPDatabase } from 'idb'
import type { Level } from '../domain/level'

const DB_NAME = 'mirror-realm'
const DB_VERSION = 1
const CACHE_STORE = 'cache'
const HISTORY_STORE = 'levelHistory'
const HISTORY_CAP = 50
const DEVICE_HASH_KEY = 'mr:deviceHash'

export interface PlayedLevelRecord {
  id: string // contentHash
  level: Level
  source: 'fresh' | 'qr' | 'daily' | 'short'
  playedAt: number
  bestTimeMs?: number
}

interface CacheEntry<T> {
  value: T
  expiresAt: number | null
}

let dbPromise: Promise<IDBPDatabase> | null = null
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(CACHE_STORE)) database.createObjectStore(CACHE_STORE)
        if (!database.objectStoreNames.contains(HISTORY_STORE)) {
          database.createObjectStore(HISTORY_STORE, { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

export async function loadCache<T>(key: string): Promise<T | null> {
  const entry = (await (await db()).get(CACHE_STORE, key)) as CacheEntry<T> | undefined
  if (!entry) return null
  if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
    await (await db()).delete(CACHE_STORE, key)
    return null
  }
  return entry.value
}

export async function saveCache<T>(key: string, value: T, ttlMs?: number): Promise<void> {
  const entry: CacheEntry<T> = { value, expiresAt: ttlMs ? Date.now() + ttlMs : null }
  await (await db()).put(CACHE_STORE, entry, key)
}

export async function recordPlayed(rec: PlayedLevelRecord): Promise<void> {
  const database = await db()
  await database.put(HISTORY_STORE, rec)
  // LRU eviction by playedAt.
  const all = (await database.getAll(HISTORY_STORE)) as PlayedLevelRecord[]
  if (all.length > HISTORY_CAP) {
    all.sort((a, b) => a.playedAt - b.playedAt)
    for (const old of all.slice(0, all.length - HISTORY_CAP)) {
      await database.delete(HISTORY_STORE, old.id)
    }
  }
}

export async function listPlayed(): Promise<PlayedLevelRecord[]> {
  const all = (await (await db()).getAll(HISTORY_STORE)) as PlayedLevelRecord[]
  return all.sort((a, b) => b.playedAt - a.playedAt)
}

/** Stable random 16-byte hex id (NOT a fingerprint). Persisted in localStorage. */
export function getOrCreateDeviceHash(): string {
  let id = localStorage.getItem(DEVICE_HASH_KEY)
  if (id && /^[0-9a-f]{32}$/.test(id)) return id
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  localStorage.setItem(DEVICE_HASH_KEY, id)
  return id
}
