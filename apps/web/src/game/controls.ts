// apps/web/src/game/controls.ts
// docs: 08-frontend-app.md#controls
//
// Touch: hold left half = move left, hold right half = move right, swipe up = jump.
// Keyboard fallback (desktop dev): Left/Right + Space/Up.
// Supports concurrent move + jump via multi-touch pointers.
import Phaser from 'phaser'

const SWIPE_DY = -40
const SWIPE_MS = 250

export class Controls {
  private left = false
  private right = false
  private jumpQueued = false
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined
  private spaceKey: Phaser.Input.Keyboard.Key | undefined
  // pointerId -> {downX, downY, downT, side}
  private touches = new Map<number, { x: number; y: number; t: number; side: 'L' | 'R' }>()

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard
    if (kb) {
      this.cursors = kb.createCursorKeys()
      this.spaceKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
    }
    scene.input.addPointer(2) // allow up to 3 simultaneous touches
    scene.input.on('pointerdown', this.onDown, this)
    scene.input.on('pointermove', this.onMove, this)
    scene.input.on('pointerup', this.onUp, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
  }

  private side(x: number): 'L' | 'R' {
    return x < this.scene.scale.width / 2 ? 'L' : 'R'
  }

  private onDown = (p: Phaser.Input.Pointer): void => {
    const side = this.side(p.x)
    this.touches.set(p.id, { x: p.x, y: p.y, t: p.downTime, side })
    if (side === 'L') this.left = true
    else this.right = true
  }

  private onMove = (p: Phaser.Input.Pointer): void => {
    const start = this.touches.get(p.id)
    if (!start || !p.isDown) return
    const dy = p.y - start.y
    const dt = this.scene.time.now - start.t
    if (dy < SWIPE_DY && dt < SWIPE_MS) {
      this.jumpQueued = true
      start.y = p.y // re-arm so a long hold doesn't keep firing
    }
  }

  private onUp = (p: Phaser.Input.Pointer): void => {
    const start = this.touches.get(p.id)
    if (start) {
      if (start.side === 'L') this.left = false
      else this.right = false
      this.touches.delete(p.id)
    }
  }

  wantsLeft(): boolean {
    return this.left || !!this.cursors?.left.isDown
  }

  wantsRight(): boolean {
    return this.right || !!this.cursors?.right.isDown
  }

  /** True exactly once per jump request (touch swipe or key press). */
  consumeJump(): boolean {
    const keyJump =
      Phaser.Input.Keyboard.JustDown(this.spaceKey as Phaser.Input.Keyboard.Key) ||
      (this.cursors ? Phaser.Input.Keyboard.JustDown(this.cursors.up) : false)
    if (this.jumpQueued || keyJump) {
      this.jumpQueued = false
      return true
    }
    return false
  }

  destroy = (): void => {
    this.scene.input.off('pointerdown', this.onDown, this)
    this.scene.input.off('pointermove', this.onMove, this)
    this.scene.input.off('pointerup', this.onUp, this)
    this.touches.clear()
  }
}
