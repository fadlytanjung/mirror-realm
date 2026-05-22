// apps/web/src/ui/ScanOverlay.ts
// docs: 08-frontend-app.md#camera
//
// DOM overlay for the capture flow: live <video> preview, a sweeping scan line
// during analysis, shutter + back buttons. Phaser draws the rest of the app;
// the camera viewport is DOM because <video> can't live inside a canvas.
export interface ScanOverlayOptions {
  onShutter: () => void
  onClose: () => void
}

export class ScanOverlay {
  private root: HTMLDivElement
  private videoEl: HTMLVideoElement
  private statusEl: HTMLDivElement
  private shutterEl: HTMLButtonElement

  private fileMode = false

  constructor(opts: ScanOverlayOptions) {
    this.root = document.createElement('div')
    this.root.className = 'mr-scan'
    this.root.innerHTML = `
      <video class="mr-scan__video" playsinline muted autoplay></video>
      <div class="mr-scan__scanline"></div>
      <div class="mr-scan__vignette"></div>
      <button class="mr-scan__back" aria-label="Back">‹</button>
      <div class="mr-scan__status"></div>
      <button class="mr-scan__shutter" aria-label="Capture"><span></span></button>
    `
    document.body.appendChild(this.root)

    this.videoEl = this.root.querySelector('.mr-scan__video') as HTMLVideoElement
    this.statusEl = this.root.querySelector('.mr-scan__status') as HTMLDivElement
    this.shutterEl = this.root.querySelector('.mr-scan__shutter') as HTMLButtonElement
    const backEl = this.root.querySelector('.mr-scan__back') as HTMLButtonElement

    this.shutterEl.addEventListener('click', opts.onShutter)
    backEl.addEventListener('click', opts.onClose)

    // In file-picker mode, a tap ANYWHERE on the screen opens the picker — these
    // are real DOM gestures (unlike Phaser's deferred input), so the OS file/camera
    // dialog is allowed to open. The shutter has its own handler; ignore it + back
    // here to avoid firing twice. (docs/08 §camera)
    this.root.addEventListener('click', (e) => {
      if (!this.fileMode) return
      const t = e.target as HTMLElement
      if (t.closest('.mr-scan__shutter') || t.closest('.mr-scan__back')) return
      opts.onShutter()
    })
  }

  get video(): HTMLVideoElement {
    return this.videoEl
  }

  async attachStream(stream: MediaStream): Promise<void> {
    this.videoEl.srcObject = stream
    await this.videoEl.play().catch(() => undefined)
  }

  setScanning(on: boolean, message = 'reading the world…'): void {
    this.root.classList.toggle('is-scanning', on)
    this.shutterEl.disabled = on
    this.statusEl.textContent = on ? message : ''
  }

  /** No live preview (file-picker fallback): tap anywhere opens the picker. */
  setFileMode(message = 'tap anywhere to take or choose a photo'): void {
    this.fileMode = true
    this.root.classList.add('mr-scan--file')
    this.statusEl.textContent = message
  }

  destroy(): void {
    this.root.remove()
  }
}
