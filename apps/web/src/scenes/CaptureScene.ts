// apps/web/src/scenes/CaptureScene.ts
// docs: 08-frontend-app.md#camera · 09-features.md#f1-capture-to-play
//
// Orchestrates camera -> shutter -> /api/analyze -> LevelScene. The visual
// camera viewport is the DOM ScanOverlay; this scene wires it to the services.
import Phaser from 'phaser'
import { ScanOverlay } from '../ui/ScanOverlay'
import {
  requestStream,
  release,
  capture,
  captureFromFile,
  streamSupported,
  CameraError,
} from '../services/camera'
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
  private fileMode = false
  private picking = false

  constructor() {
    super('CaptureScene')
  }

  create(): void {
    // Phaser reuses the scene instance, so reset per-entry state — otherwise after the
    // first successful capture `busy` stays true and the shutter never responds again.
    this.busy = false
    this.picking = false
    this.fileMode = false

    this.overlay = new ScanOverlay({
      onShutter: () => void this.onShutter(),
      onClose: () => navigateHash('#/'),
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this)

    if (!streamSupported()) {
      // Insecure context (e.g. plain-HTTP LAN): no live camera. The overlay becomes
      // a full-screen tap target that opens the photo picker (a real DOM gesture).
      this.fileMode = true
      this.overlay.setFileMode()
      return
    }

    requestStream()
      .then((s) => {
        this.stream = s
        return this.overlay?.attachStream(s)
      })
      .catch(() => {
        // Permission denied or unavailable mid-flight — degrade to the picker.
        this.fileMode = true
        this.overlay?.setFileMode('camera blocked — tap to choose a photo')
      })
  }

  private async onShutter(): Promise<void> {
    if (this.busy || this.picking || !this.overlay) return
    let photo: string
    this.picking = true
    try {
      photo = this.fileMode ? await captureFromFile() : capture(this.overlay.video)
    } catch (err) {
      // A cancelled picker is not an error worth shouting about.
      if (err instanceof CameraError && err.message !== 'No photo selected.') toast(err.message)
      return
    } finally {
      this.picking = false
    }

    this.busy = true
    // Flash + freeze the captured frame first so the user sees the capture happened,
    // then run the scan animation over the still (live-camera path only).
    if (!this.fileMode) this.overlay.freeze()
    this.overlay.setScanning(true)
    const deviceHash = this.registry.get('deviceHash') as string
    try {
      const res = await analyze(photo, deviceHash)
      setLevel(res.level)
      // The AI picks which experience to reveal first. The level is always generated,
      // so sharing always opens a playable game (docs/08 §experiences).
      const exp = res.level.experience ?? 'platformer'
      if (exp === 'pixel') {
        this.scene.start('PixelScene', { level: res.level, photo })
      } else if (exp === 'animation') {
        this.scene.start('AnimationScene', { level: res.level, photo })
      } else {
        this.scene.start('LevelScene', {
          level: res.level,
          source: 'fresh',
          wasUnreachableOnFirstAttempt: res.wasUnreachableOnFirstAttempt,
        })
      }
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
