// apps/web/src/scenes/LevelScene.ts
// docs: 08-frontend-app.md#scenes · 04-domain-model.md#physics
import Phaser from 'phaser'
import type { Level } from '../domain/level'
import type { PlaySource } from '../app'
import { onResize } from '../app'
import { toast } from '../ui/toast'
import { buildLevel } from '../game/builder'
import { Controls } from '../game/controls'
import {
  GRAVITY,
  JUMP_VEL,
  MOVE_VEL,
  PLAYER_W,
  PLAYER_H,
  COYOTE_FRAMES,
  WORLD_W,
  WORLD_H,
} from '../game/physics'
import { TILE_SRC } from '../game/tile-mapping'

interface LevelData {
  level: Level
  source: PlaySource
  isFromYesterday?: boolean
  wasUnreachableOnFirstAttempt?: boolean
}

export class LevelScene extends Phaser.Scene {
  private level!: Level
  private levelData!: LevelData
  private player!: Phaser.Physics.Arcade.Sprite
  private controls!: Controls
  private coyote = 0
  private startTime = 0
  private finished = false
  private wakeLock?: WakeLockSentinel

  constructor() {
    super('LevelScene')
  }

  init(data: LevelData): void {
    this.levelData = data
    this.level = data.level
    this.finished = false
    this.coyote = 0
  }

  preload(): void {
    this.load.spritesheet('tiles', `/tilesets/${this.level.vibe}.png`, {
      frameWidth: TILE_SRC,
      frameHeight: TILE_SRC,
    })
    this.load.spritesheet('player', '/sprites/spark.png', {
      frameWidth: PLAYER_W,
      frameHeight: PLAYER_H,
    })
    for (const s of ['jump', 'die', 'win']) {
      this.load.audio(`sfx-${s}`, [`/sfx/${s}.wav`])
    }
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)
    this.physics.world.gravity.y = GRAVITY
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H)
    this.drawBackdrop()

    const built = buildLevel(this, this.level)

    this.player = this.physics.add.sprite(this.level.spawn.x, this.level.spawn.y, 'player', 0)
    this.player.setOrigin(0, 0)
    this.player.setCollideWorldBounds(true)
    this.makeAnims()

    this.physics.add.collider(this.player, built.platformsGroup)
    this.physics.add.overlap(this.player, built.hazardsGroup, () => this.die())
    this.physics.add.overlap(this.player, built.goal, () => this.win())

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1)
    this.cameras.main.setLerp(0.12, 0.12)
    // Zoom so the full world height is always on screen; the camera follows the
    // player horizontally. Recompute on rotate/resize (docs/08 §responsive).
    onResize(this, (_w, h) => this.cameras.main.setZoom(h / WORLD_H))

    this.controls = new Controls(this)
    this.startTime = this.time.now

    this.hud()
    void this.acquireWakeLock()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this)
  }

  update(): void {
    if (this.finished) return
    const body = this.player.body as Phaser.Physics.Arcade.Body
    const onGround = body.blocked.down || body.touching.down
    if (onGround) this.coyote = COYOTE_FRAMES
    else if (this.coyote > 0) this.coyote--

    if (this.controls.wantsLeft()) {
      this.player.setVelocityX(-MOVE_VEL)
      this.player.setFlipX(true)
    } else if (this.controls.wantsRight()) {
      this.player.setVelocityX(MOVE_VEL)
      this.player.setFlipX(false)
    } else {
      this.player.setVelocityX(0)
    }

    if (this.controls.consumeJump() && this.coyote > 0) {
      this.player.setVelocityY(-JUMP_VEL)
      this.coyote = 0
      this.safePlay('sfx-jump')
    }

    // Fell out of the world -> respawn.
    if (this.player.y > WORLD_H + 64) this.die()

    this.animate(onGround, body.velocity.x)
  }

  private animate(onGround: boolean, vx: number): void {
    if (!onGround) this.player.anims.play('jump', true)
    else if (Math.abs(vx) > 10) this.player.anims.play('run', true)
    else this.player.anims.play('idle', true)
  }

  private makeAnims(): void {
    if (this.anims.exists('idle')) return
    this.anims.create({ key: 'idle', frames: [{ key: 'player', frame: 0 }], frameRate: 1 })
    this.anims.create({
      key: 'run',
      frames: this.anims.generateFrameNumbers('player', { frames: [1, 2] }),
      frameRate: 8,
      repeat: -1,
    })
    this.anims.create({ key: 'jump', frames: [{ key: 'player', frame: 3 }], frameRate: 1 })
  }

  private drawBackdrop(): void {
    // Sky wash — oversized + anchored at screen origin (scrollFactor 0) so it covers
    // the viewport at any camera zoom.
    const g = this.add.graphics().setScrollFactor(0).setDepth(-6)
    g.fillGradientStyle(0x3a1066, 0x2a0a55, 0x140033, 0x0a0420, 1)
    g.fillRect(0, 0, WORLD_W * 2, WORLD_H * 2)

    // A faint parallax starfield across the world for depth/ambiance.
    const stars = this.add.graphics().setScrollFactor(0.35).setDepth(-5)
    for (let i = 0; i < 90; i++) {
      const x = Phaser.Math.Between(0, WORLD_W)
      const y = Phaser.Math.Between(0, WORLD_H)
      stars.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.08, 0.5))
      stars.fillCircle(x, y, Phaser.Math.FloatBetween(0.6, 1.8))
    }
  }

  private die(): void {
    if (this.finished) return
    this.safePlay('sfx-die')
    this.cameras.main.flash(140, 120, 0, 40)
    this.player.setVelocity(0, 0)
    this.player.setPosition(this.level.spawn.x, this.level.spawn.y)
  }

  private win(): void {
    if (this.finished) return
    this.finished = true
    this.safePlay('sfx-win')
    const timeMs = Math.round(this.time.now - this.startTime)
    this.player.setVelocity(0, 0)
    this.scene.launch('ResultScene', { level: this.level, source: this.levelData.source, timeMs })
    this.scene.pause()
  }

  private hud(): void {
    // Transient hints go through the DOM toast layer so they're unaffected by the
    // world camera's zoom (docs/08 §responsive).
    if (this.levelData.isFromYesterday) toast("yesterday's pick")
    if (this.levelData.wasUnreachableOnFirstAttempt) toast('tricky one — good luck!')
  }

  private safePlay(key: string): void {
    if (this.cache.audio.exists(key)) this.sound.play(key, { volume: 0.5 })
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen')
    } catch {
      /* wake lock is best-effort */
    }
  }

  private onShutdown(): void {
    void this.wakeLock?.release()
    this.wakeLock = undefined
  }
}
