// apps/web/src/scenes/AnimationScene.ts
// docs: 08-frontend-app.md#experiences
//
// "Animated reveal": the captured photo with a Ken-Burns drift + a sweeping scan line,
// so the photo feels alive before you play or share.
import Phaser from 'phaser'
import { RevealScene } from './RevealScene'

export class AnimationScene extends RevealScene {
  constructor() {
    super('AnimationScene')
    this.title = 'LIVING REALM'
  }

  protected applyEffect(img: Phaser.GameObjects.Image): void {
    const base = img.scaleX
    img.setScale(base * 0.98).setAlpha(0)
    // Fade + slow Ken-Burns zoom/drift, looping gently.
    this.tweens.add({ targets: img, alpha: 1, duration: 500, ease: 'Sine.easeOut' })
    this.tweens.add({
      targets: img,
      scale: base * 1.06,
      angle: 1.2,
      duration: 4200,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    })

    // A neon scan line sweeping down across the photo.
    const top = img.y - img.displayHeight / 2
    const line = this.add
      .rectangle(img.x, top, img.displayWidth, 3, 0x00ffff, 0.9)
      .setDepth(6)
      .setBlendMode(Phaser.BlendModes.ADD)
    this.tweens.add({
      targets: line,
      y: top + img.displayHeight,
      duration: 1600,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    })
  }
}
