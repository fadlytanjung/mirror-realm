// apps/web/src/ui/ShareSheet.ts
// docs: 08-frontend-app.md#sharing · 09-features.md#f3-share · #f6-submit
//
// Win card: QR + short URL + Copy / Share / Replay / Submit-to-Daily.
import type { Level } from '../domain/level'
import { compress } from '../services/compression'
import { encode as qrEncode } from '../services/qr'
import { saveLevel, submit, ApiError } from '../services/api'
import { toast } from './toast'

export interface ShareSheetOptions {
  level: Level
  deviceHash: string
  timeMs?: number // omitted when sharing before a play (e.g. from a reveal scene)
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
  // Prefer a SHORT server link (/l/<hash>) minted on the CURRENT origin: it makes a
  // clean, scannable QR and works on this host (local or prod). Fall back to the long
  // inline (/p/<base64>) link only if the server save fails (offline).
  try {
    const { hash } = await saveLevel(level, deviceHash)
    return `${location.origin}/l/${hash}`
  } catch {
    return `${location.origin}/p/${compress(level)}`
  }
}

/** Copy that also works in insecure contexts (LAN http), where navigator.clipboard is unavailable. */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to the legacy path */
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export class ShareSheet {
  private root: HTMLDivElement

  constructor(private opts: ShareSheetOptions) {
    this.root = document.createElement('div')
    this.root.className = 'mr-sheet'
    const title = opts.timeMs != null ? `CLEARED in ${formatTime(opts.timeMs)}` : 'SHARE THIS REALM'
    this.root.innerHTML = `
      <div class="mr-sheet__card">
        <div class="mr-sheet__title">${title}</div>
        <div class="mr-sheet__qr"><div class="mr-sheet__spinner"></div></div>
        <a class="mr-sheet__url" target="_blank" rel="noopener">building share link…</a>
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
    const link = this.el<HTMLAnchorElement>('.mr-sheet__url')
    link.href = this.shareUrl // clickable; CSS ellipsises the long inline payload
    link.textContent = this.shareUrl
  }

  private async onCopy(): Promise<void> {
    if (!this.shareUrl) return
    toast((await copyText(this.shareUrl)) ? 'Link copied!' : 'Copy failed — long-press the link.')
  }

  private async onShare(): Promise<void> {
    if (!this.shareUrl) return
    if (navigator.share && window.isSecureContext) {
      await navigator.share({ title: 'Mirror Realm', url: this.shareUrl }).catch(() => undefined)
    } else {
      void this.onCopy() // Web Share needs HTTPS; on LAN http fall back to copy
    }
  }

  private async onSubmit(): Promise<void> {
    const btn = this.el<HTMLButtonElement>('[data-act="submit"]')
    btn.disabled = true
    try {
      const res = await submit(this.opts.level, this.opts.deviceHash)
      btn.textContent = res.status === 'queued' ? 'Submitted' : 'Already submitted'
      toast(res.status === 'queued' ? 'In the pool!' : 'Already in the pool!')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal'
      const msg =
        code === 'submission_rate_limited'
          ? "That's plenty for today — try again tomorrow."
          : code === 'unreachable_level'
            ? "This level can't be finished, so it can't join Daily — try another."
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
