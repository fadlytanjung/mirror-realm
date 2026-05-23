// apps/web/src/scenes/PixelScene.ts
// docs: 08-frontend-app.md#experiences
//
// "Funny pixel" reveal: the captured photo converted to crisp, posterised pixel art
// (client-side, on-device) and rendered with nearest-neighbour so the pixels stay sharp.
import type Phaser from 'phaser'
import { RevealScene } from './RevealScene'
import { toPixelArt } from '../services/pixelize'

export class PixelScene extends RevealScene {
  constructor() {
    super('PixelScene')
    this.title = 'PIXEL REALM'
    this.crisp = true // keep the pixels sharp despite global antialiasing
  }

  protected sourceDataUrl(): Promise<string> {
    return toPixelArt(`data:image/jpeg;base64,${this.photo}`, { cols: 72, steps: 5, saturate: 1.35 })
  }

  protected applyEffect(img: Phaser.GameObjects.Image): void {
    img.setAlpha(0)
    this.tweens.add({ targets: img, alpha: 1, duration: 320, ease: 'Sine.easeOut' })
  }
}
