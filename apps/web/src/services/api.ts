// apps/web/src/services/api.ts
// docs: 08-frontend-app.md#services · 07-api-contracts.md
//
// The ONLY network surface the PWA has to apps/api. No service imports another.
import type { Level } from '../domain/level'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

export interface AnalyzeResponse {
  level: Level
  wasUnreachableOnFirstAttempt: boolean
  tracingId: string
}
export interface SaveLevelResponse {
  hash: string
  url: string
  expiresAt: string
}
export interface GetLevelResponse {
  level: Level
  savedAt: string
}
export interface SubmitResponse {
  status: 'queued' | 'already_queued'
  contentHash: string
}
export interface DailyResponse {
  forDate: string
  level: Level
  isFromYesterday: boolean
}

/** Typed error matching the docs/07 §10 envelope. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly tracingId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; tracingId?: string } }
    const e = body.error
    return new ApiError(e?.code ?? 'internal', e?.message ?? res.statusText, res.status, e?.tracingId)
  } catch {
    return new ApiError('internal', res.statusText || 'Request failed', res.status)
  }
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

export function analyze(photoB64: string, deviceHash: string): Promise<AnalyzeResponse> {
  // server budget is 25s; client adds 2s margin (docs/07 §3).
  return postJson<AnalyzeResponse>('/api/analyze', { photo: photoB64, deviceHash }, 27_000)
}

export function saveLevel(level: Level, deviceHash: string): Promise<SaveLevelResponse> {
  return postJson<SaveLevelResponse>('/api/level/save', { level, deviceHash }, 7_000)
}

export function getLevel(hash: string): Promise<GetLevelResponse> {
  return getJson<GetLevelResponse>(`/api/level/${encodeURIComponent(hash)}`, 5_000)
}

export function submit(level: Level, deviceHash: string): Promise<SubmitResponse> {
  return postJson<SubmitResponse>('/api/submit', { level, deviceHash }, 5_000)
}

export function getDaily(): Promise<DailyResponse> {
  return getJson<DailyResponse>('/api/daily', 5_000)
}
