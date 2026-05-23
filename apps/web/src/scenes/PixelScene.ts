// apps/web/src/scenes/PixelScene.ts
// docs: 08-frontend-app.md#experiences
//
// "Funny pixel" reveal: the captured photo, pixelated. Uses Phaser 3.60+ postFX
// (WebGL); falls back gracefully to the plain image if postFX is unavailable.
import type Phaser from 'phaser'
import { RevealScene } from './RevealScene'

export class PixelScene extends RevealScene {
  constructor() {
    super('PixelScene')
    this.title = 'PIXEL REALM'
  }

  protected applyEffect(img: Phaser.GameObjects.Image): void {
    img.setScale(img.scaleX) // keep fit
    try {
      const fx = img.postFX?.addPixelate(2)
      if (fx) {
        // Animate from chunky to crisp-ish for a "developing" reveal, then settle chunky.
        fx.amount = 14
        this.tweens.add({ targets: fx, amount: 6, duration: 900, ease: 'Sine.easeOut' })
      }
    } catch {
      /* no WebGL postFX — the plain photo still shows */
    }
  }
}
