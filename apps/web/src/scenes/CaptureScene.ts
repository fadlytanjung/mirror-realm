// apps/web/src/scenes/CaptureScene.ts
// docs: 08-frontend-app.md#camera · 09-features.md#f1-capture-to-play
//
// Orchestrates camera -> shutter -> /api/analyze -> LevelScene. The visual
// camera viewport is the DOM ScanOverlay; this scene wires it to the services.
import Phaser from 'phaser'
import { ScanOverlay } from '../ui/ScanOverlay'
import { requestStream, release, capture, CameraError } from '../services/camera'
import { analyze, ApiError } from '../services/api'
import { navigateHash, setLevel } from '../app'
import { toast } from '../ui/toast'

const ERROR_COPY: Record<string, string> = {
  budget_exhausted: "We're full for the month — try yesterday's Daily World.",
  agent_timeout: 'Reading is taking too long — try a different photo.',
  safety_filter: "We can't read this scene — try another.",
  validation_failed: 'Something went wrong with that photo — try again.',
}

export class CaptureScene extends Phaser.Scene {
  private overlay?: ScanOverlay
  private stream?: MediaStream
  private busy = false

  constructor() {
    super('CaptureScene')
  }

  create(): void {
    this.overlay = new ScanOverlay({
      onShutter: () => void this.onShutter(),
      onClose: () => navigateHash('#/'),
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this)

    requestStream()
      .then((s) => {
        this.stream = s
        return this.overlay?.attachStream(s)
      })
      .catch((err: unknown) => {
        toast(err instanceof CameraError ? err.message : 'Camera permission denied.')
        navigateHash('#/')
      })
  }

  private async onShutter(): Promise<void> {
    if (this.busy || !this.overlay) return
    let photo: string
    try {
      photo = capture(this.overlay.video)
    } catch (err) {
      toast(err instanceof CameraError ? err.message : 'Capture failed.')
      return
    }

    this.busy = true
    this.overlay.setScanning(true)
    const deviceHash = this.registry.get('deviceHash') as string
    try {
      const res = await analyze(photo, deviceHash)
      setLevel(res.level)
      this.scene.start('LevelScene', {
        level: res.level,
        source: 'fresh',
        wasUnreachableOnFirstAttempt: res.wasUnreachableOnFirstAttempt,
      })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal'
      toast(ERROR_COPY[code] ?? 'Something went wrong — try again.')
      this.overlay.setScanning(false)
      this.busy = false
    }
  }

  private cleanup(): void {
    if (this.stream) release(this.stream)
    this.overlay?.destroy()
    this.overlay = undefined
    this.stream = undefined
  }
}
