// apps/web/src/scenes/MenuScene.ts
// docs: 08-frontend-app.md#scenes · 09-features.md#f5-daily-world
//
// Home. Animated starfield, title, and three big tactile buttons. Phaser-native
// (no SPA framework) — DOM is reserved for overlays that Phaser is bad at.
import Phaser from 'phaser'
import { navigateHash, onResize } from '../app'
import { listPlayed } from '../services/storage'

const ACCENT = 0xaa00ff
const ACCENT_2 = 0x00ffff

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene')
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#140026')
    // Re-layout on rotate/resize so the menu always fills the viewport.
    onResize(this, (w, h) => this.layout(w, h))
  }

  /** Idempotent: clears prior objects + tweens, then rebuilds for the given size. */
  private layout(width: number, height: number): void {
    this.tweens.killAll()
    this.children.removeAll(true)

    // Vertical nebula gradient behind the stars so the menu feels like a "realm".
    const bg = this.add.graphics().setDepth(-10)
    bg.fillGradientStyle(0x2a0a55, 0x2a0a55, 0x0c0018, 0x06121f, 1)
    bg.fillRect(0, 0, width, height)

    this.drawStarfield(width, height)

    // Title scales down on narrow/short screens.
    const titleSize = Math.round(Phaser.Math.Clamp(Math.min(width * 0.11, height * 0.1), 28, 60))
    this.add
      .text(width / 2, height * 0.18, 'MIRROR REALM', {
        fontFamily: 'monospace',
        fontSize: `${titleSize}px`,
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#aa00ff', 18, true, true)
    this.add
      .text(width / 2, height * 0.18 + titleSize, 'turn any photo into a level', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#c9b6ff',
      })
      .setOrigin(0.5)

    // Centre the 3 buttons as a group and scale the gap to height so nothing overlaps
    // or crops in short/landscape viewports (no scrolling needed).
    const cx = width / 2
    const btnW = Math.min(340, width - 48)
    const gap = Math.round(Phaser.Math.Clamp(height * 0.13, 64, 80))
    const mid = height * 0.56
    this.button(cx, mid - gap, btnW, 'CAMERA', ACCENT, () => navigateHash('#/capture'))
    this.button(cx, mid, btnW, "TODAY'S WORLD", ACCENT_2, () => navigateHash('#/daily'))
    this.button(cx, mid + gap, btnW, 'ABOUT', 0x6a5acd, () => this.showAbout())

    void this.showPlayedCount(cx, Math.min(height - 22, mid + gap + 52))
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

  private button(
    x: number,
    y: number,
    w: number,
    label: string,
    color: number,
    onTap: () => void,
  ): void {
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
    // DOM overlay (not Phaser text) so it scrolls and never crops in landscape.
    const root = document.createElement('div')
    root.className = 'mr-sheet'
    root.innerHTML = `
      <div class="mr-sheet__card mr-about">
        <div class="mr-sheet__title">MIRROR REALM</div>
        <p>Point your camera at anything. AI reads the scene and builds a tiny pixel-art platformer from it.</p>
        <p>No accounts. No image stored. Share levels with friends via QR.</p>
        <button class="mr-btn" data-act="close">Close</button>
      </div>
    `
    document.body.appendChild(root)
    // Disable the Phaser menu's input while the modal is up: Phaser processes pointer
    // events at the window level, so without this a tap on the DOM Close button also
    // hits the menu button behind it (e.g. "Today's World").
    this.input.enabled = false
    const close = (): void => {
      root.remove()
      this.input.enabled = true
    }
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t === root || t.closest('[data-act="close"]')) close()
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => root.remove())
  }
}
