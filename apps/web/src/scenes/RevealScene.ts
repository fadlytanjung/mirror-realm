// apps/web/src/scenes/RevealScene.ts
// docs: 08-frontend-app.md#experiences
//
// Base for the non-game "reveal" experiences the AI can pick (pixel, animation).
// Renders the captured photo (kept on-device — never uploaded) with an effect, then
// offers PLAY / SHARE / AGAIN. The playable level is always generated, so SHARE always
// hands a friend a *playable* level, never a dead-end image.
import Phaser from 'phaser'
import type { Level } from '../domain/level'
import { navigateHash, onResize } from '../app'
import { ShareSheet } from '../ui/ShareSheet'

export interface RevealData {
  level: Level
  photo: string // base64 JPEG (no data: prefix)
}

const TEX = 'capture'

export abstract class RevealScene extends Phaser.Scene {
  protected level!: Level
  protected photo!: string
  protected title = ''
  /** Render the texture with nearest-neighbour (crisp) — set by pixel-art variants. */
  protected crisp = false
  private sheet?: ShareSheet
  private ready = false

  init(data: RevealData): void {
    this.level = data.level
    this.photo = data.photo
    this.ready = false
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0c0018')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.sheet?.destroy()
      this.sheet = undefined
    })
    void this.loadTexture()
  }

  /** The data URL to render. Override to pre-process the photo (e.g. pixel art). */
  protected sourceDataUrl(): Promise<string> {
    return Promise.resolve(`data:image/jpeg;base64,${this.photo}`)
  }

  private async loadTexture(): Promise<void> {
    let url: string
    try {
      url = await this.sourceDataUrl()
    } catch {
      url = `data:image/jpeg;base64,${this.photo}` // fall back to the raw photo
    }
    if (this.textures.exists(TEX)) this.textures.remove(TEX)
    this.textures.once(Phaser.Textures.Events.ADD, (key: string) => {
      if (key !== TEX) return
      if (this.crisp) this.textures.get(TEX).setFilter(Phaser.Textures.FilterMode.NEAREST)
      this.ready = true
      onResize(this, () => this.build())
    })
    this.textures.addBase64(TEX, url)
  }

  /** Apply the variant's visual effect to the photo image (animate, …). Optional. */
  protected applyEffect(_img: Phaser.GameObjects.Image, _w: number, _h: number): void {
    /* default: no extra effect (pixel art is baked into the texture) */
  }

  private build(): void {
    if (!this.ready) return
    this.tweens.killAll()
    this.children.removeAll(true)
    const { width, height } = this.scale

    const img = this.add.image(width / 2, height * 0.42, TEX)
    const fit = Math.min((width * 0.86) / img.width, (height * 0.5) / img.height)
    img.setScale(fit)
    // Vibe-tinted glow frame so the photo reads as "transformed", not just shown.
    const fw = img.displayWidth + 16
    const fh = img.displayHeight + 16
    this.add
      .rectangle(width / 2, height * 0.42, fw, fh)
      .setStrokeStyle(3, 0xaa00ff, 0.9)
      .setDepth(5)
    this.applyEffect(img, width, height)

    this.add
      .text(width / 2, height * 0.12, this.title, {
        fontFamily: 'monospace',
        fontSize: `${Math.round(Phaser.Math.Clamp(width * 0.06, 18, 26))}px`,
        color: '#ffcc00',
        align: 'center',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#aa00ff', 14, true, true)
      .setDepth(10)

    const cy = height - Phaser.Math.Clamp(height * 0.12, 56, 92)
    const bw = Math.min(120, (width - 56) / 3)
    const gap = bw + 12
    this.button(width / 2 - gap, cy, bw, 'PLAY', 0xaa00ff, () => this.play())
    this.button(width / 2, cy, bw, 'SHARE', 0x00ffff, () => this.share())
    this.button(width / 2 + gap, cy, bw, 'AGAIN', 0x6a5acd, () => navigateHash('#/capture'))
  }

  private button(
    x: number,
    y: number,
    w: number,
    label: string,
    color: number,
    onTap: () => void,
  ): void {
    const h = 48
    const bg = this.add.rectangle(x, y, w, h, color, 0.18).setStrokeStyle(2, color, 1).setDepth(10)
    const txt = this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(11)
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(11)
    zone.on('pointerover', () => bg.setFillStyle(color, 0.32))
    zone.on('pointerout', () => bg.setFillStyle(color, 0.18))
    zone.on('pointerdown', () => this.tweens.add({ targets: [bg, txt], scale: 0.95, duration: 70, yoyo: true }))
    zone.on('pointerup', onTap)
  }

  private play(): void {
    this.scene.start('LevelScene', { level: this.level, source: 'fresh' })
  }

  private share(): void {
    this.sheet?.destroy()
    this.sheet = new ShareSheet({
      level: this.level,
      deviceHash: this.registry.get('deviceHash') as string,
      onReplay: () => this.scene.start('LevelScene', { level: this.level, source: 'fresh' }),
      onHome: () => navigateHash('#/'),
    })
  }
}
