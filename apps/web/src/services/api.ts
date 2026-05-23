// apps/web/src/services/api.ts
// docs: 08-frontend-app.md#services · 07-api-contracts.md
//
// The ONLY network surface the PWA has to apps/api. No service imports another.
import type { Level } from '../domain/level'

// Default the API base to the page's own host on :8080 so LAN testing works with no
// config: open http://<laptop-ip>:5173 on a phone and it calls http://<laptop-ip>:8080
// (not the phone's own localhost). Set VITE_API_BASE_URL explicitly for prod (Cloud Run).
const BASE =
  import.meta.env.VITE_API_BASE_URL ?? `${window.location.protocol}//${window.location.hostname}:8080`

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
  // Up to two model calls (attempt + retry); gemini-3.5-flash is slower, so allow
  // headroom under Cloud Run's 60s request timeout (docs/07 §3).
  return postJson<AnalyzeResponse>('/api/analyze', { photo: photoB64, deviceHash }, 45_000)
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
