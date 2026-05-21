// apps/web/src/scenes/LevelScene.ts
// docs: 08-frontend-app.md#scenes · 04-domain-model.md#physics
import Phaser from 'phaser'
import type { Level } from '../domain/level'
import type { PlaySource } from '../app'
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
      frameWidth: 32,
      frameHeight: 32,
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
    // Subtle parallax wash so empty space never looks broken.
    const g = this.add.graphics().setScrollFactor(0).setDepth(-5)
    g.fillGradientStyle(0x1a0033, 0x1a0033, 0x2a0a4a, 0x10001f, 1)
    g.fillRect(0, 0, this.scale.width, this.scale.height)
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
    if (this.levelData.isFromYesterday) {
      this.add
        .text(12, 12, "yesterday's pick", { fontFamily: 'monospace', fontSize: '14px', color: '#c9b6ff' })
        .setScrollFactor(0)
        .setDepth(10)
    }
    if (this.levelData.wasUnreachableOnFirstAttempt) {
      this.add
        .text(12, this.scale.height - 26, 'tricky one!', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ffcc00',
        })
        .setScrollFactor(0)
        .setDepth(10)
    }
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
