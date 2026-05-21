// apps/web/src/scenes/MenuScene.ts
// docs: 08-frontend-app.md#scenes · 09-features.md#f5-daily-world
//
// Home. Animated starfield, title, and three big tactile buttons. Phaser-native
// (no SPA framework) — DOM is reserved for overlays that Phaser is bad at.
import Phaser from 'phaser'
import { navigateHash } from '../app'
import { listPlayed } from '../services/storage'

const ACCENT = 0xaa00ff
const ACCENT_2 = 0x00ffff

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene')
  }

  create(): void {
    const { width, height } = this.scale
    this.cameras.main.setBackgroundColor('#140026')
    this.drawStarfield(width, height)

    // Title.
    this.add
      .text(width / 2, height * 0.2, 'MIRROR REALM', {
        fontFamily: 'monospace',
        fontSize: '52px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#aa00ff', 18, true, true)
    this.add
      .text(width / 2, height * 0.2 + 44, 'turn any photo into a level', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#c9b6ff',
      })
      .setOrigin(0.5)

    const cx = width / 2
    this.button(cx, height * 0.46, 'CAMERA', ACCENT, () => navigateHash('#/capture'))
    this.button(cx, height * 0.46 + 78, "TODAY'S WORLD", ACCENT_2, () => navigateHash('#/daily'))
    this.button(cx, height * 0.46 + 156, 'ABOUT', 0x6a5acd, () => this.showAbout())

    void this.showPlayedCount(cx, height - 28)
  }

  private drawStarfield(w: number, h: number): void {
    for (let i = 0; i < 70; i++) {
      const star = this.add.circle(
        Phaser.Math.Between(0, w),
        Phaser.Math.Between(0, h),
        Phaser.Math.FloatBetween(0.5, 1.8),
        0xffffff,
        Phaser.Math.FloatBetween(0.2, 0.9),
      )
      this.tweens.add({
        targets: star,
        alpha: 0.1,
        duration: Phaser.Math.Between(900, 2600),
        yoyo: true,
        repeat: -1,
        delay: Phaser.Math.Between(0, 1500),
      })
    }
  }

  private button(x: number, y: number, label: string, color: number, onTap: () => void): void {
    const w = 320
    const h = 60
    const bg = this.add.rectangle(x, y, w, h, color, 0.18).setStrokeStyle(2, color, 1)
    const txt = this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: '24px', color: '#ffffff' })
      .setOrigin(0.5)
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true })

    zone.on('pointerover', () => bg.setFillStyle(color, 0.32))
    zone.on('pointerout', () => bg.setFillStyle(color, 0.18))
    zone.on('pointerdown', () => {
      this.tweens.add({ targets: [bg, txt], scale: 0.95, duration: 70, yoyo: true })
    })
    zone.on('pointerup', onTap)
  }

  private async showPlayedCount(x: number, y: number): Promise<void> {
    const played = await listPlayed()
    if (played.length === 0) return
    this.add
      .text(x, y, `${played.length} level${played.length === 1 ? '' : 's'} played`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#7a6aa8',
      })
      .setOrigin(0.5)
  }

  private showAbout(): void {
    const { width, height } = this.scale
    const overlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.7)
      .setInteractive()
    const lines = [
      'MIRROR REALM',
      '',
      'Point your camera at anything.',
      'A.I. reads the scene and builds a',
      'tiny pixel-art platformer from it.',
      '',
      'No accounts. No image stored.',
      'Share levels with friends via QR.',
      '',
      '[ tap to close ]',
    ].join('\n')
    const card = this.add
      .text(width / 2, height / 2, lines, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5)
    overlay.once('pointerup', () => {
      overlay.destroy()
      card.destroy()
    })
  }
}
