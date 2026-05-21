// apps/web/src/ui/ShareSheet.ts
// docs: 08-frontend-app.md#sharing · 09-features.md#f3-share · #f6-submit
//
// Win card: QR + short URL + Copy / Share / Replay / Submit-to-Daily.
import type { Level } from '../domain/level'
import { compress } from '../services/compression'
import { encode as qrEncode } from '../services/qr'
import { saveLevel, submit, ApiError } from '../services/api'
import { toast } from './toast'

const INLINE_LIMIT = 600

export interface ShareSheetOptions {
  level: Level
  deviceHash: string
  timeMs: number
  onReplay: () => void
  onHome: () => void
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

async function buildShareUrl(level: Level, deviceHash: string): Promise<string> {
  const inline = compress(level)
  if (inline.length <= INLINE_LIMIT) return `${location.origin}/p/${inline}`
  const { url } = await saveLevel(level, deviceHash)
  return url
}

export class ShareSheet {
  private root: HTMLDivElement

  constructor(private opts: ShareSheetOptions) {
    this.root = document.createElement('div')
    this.root.className = 'mr-sheet'
    this.root.innerHTML = `
      <div class="mr-sheet__card">
        <div class="mr-sheet__title">CLEARED in ${formatTime(opts.timeMs)}</div>
        <div class="mr-sheet__qr"><div class="mr-sheet__spinner"></div></div>
        <div class="mr-sheet__url">building share link…</div>
        <div class="mr-sheet__row">
          <button class="mr-btn" data-act="copy">Copy URL</button>
          <button class="mr-btn" data-act="share">Share</button>
        </div>
        <div class="mr-sheet__row">
          <button class="mr-btn mr-btn--ghost" data-act="replay">Replay</button>
          <button class="mr-btn mr-btn--accent" data-act="submit">Submit to Daily</button>
        </div>
        <button class="mr-sheet__home" data-act="home">‹ home</button>
      </div>
    `
    document.body.appendChild(this.root)
    this.wire()
    void this.renderShare()
  }

  private el<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T
  }

  private wire(): void {
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act')
      if (!act) return
      if (act === 'replay') return this.close(this.opts.onReplay)
      if (act === 'home') return this.close(this.opts.onHome)
      if (act === 'submit') return void this.onSubmit()
      if (act === 'copy') return void this.onCopy()
      if (act === 'share') return void this.onShare()
    })
  }

  private shareUrl = ''

  private async renderShare(): Promise<void> {
    try {
      this.shareUrl = await buildShareUrl(this.opts.level, this.opts.deviceHash)
    } catch {
      this.el('.mr-sheet__url').textContent = 'Could not build a server link — share is offline-only.'
      return
    }
    const qrBox = this.el('.mr-sheet__qr')
    qrBox.innerHTML = ''
    qrBox.appendChild(qrEncode(this.shareUrl))
    this.el('.mr-sheet__url').textContent = this.shareUrl
  }

  private async onCopy(): Promise<void> {
    if (!this.shareUrl) return
    try {
      await navigator.clipboard.writeText(this.shareUrl)
      toast('Link copied!')
    } catch {
      toast('Copy failed — long-press the URL.')
    }
  }

  private async onShare(): Promise<void> {
    if (!this.shareUrl) return
    if (navigator.share) {
      await navigator.share({ title: 'Mirror Realm', url: this.shareUrl }).catch(() => undefined)
    } else {
      void this.onCopy()
    }
  }

  private async onSubmit(): Promise<void> {
    const btn = this.el<HTMLButtonElement>('[data-act="submit"]')
    btn.disabled = true
    try {
      const res = await submit(this.opts.level, this.opts.deviceHash)
      toast(res.status === 'queued' ? 'In the pool!' : 'Already in the pool!')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal'
      const msg =
        code === 'submission_rate_limited'
          ? "That's plenty for today — try again tomorrow."
          : 'Could not submit — try again.'
      toast(msg)
      btn.disabled = false
    }
  }

  private close(then: () => void): void {
    this.root.remove()
    then()
  }

  destroy(): void {
    this.root.remove()
  }
}
