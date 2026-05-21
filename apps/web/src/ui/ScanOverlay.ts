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

    this.shutterEl.addEventListener('click', opts.onShutter)
    ;(this.root.querySelector('.mr-scan__back') as HTMLButtonElement).addEventListener(
      'click',
      opts.onClose,
    )
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

  destroy(): void {
    this.root.remove()
  }
}
