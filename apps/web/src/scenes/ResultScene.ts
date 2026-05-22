// apps/web/src/scenes/ResultScene.ts
// docs: 08-frontend-app.md#scenes · 09-features.md#f2-play-runtime
//
// Win overlay. Dims the paused LevelScene and opens the DOM ShareSheet.
import Phaser from 'phaser'
import type { Level } from '../domain/level'
import type { PlaySource } from '../app'
import { navigateHash } from '../app'
import { ShareSheet } from '../ui/ShareSheet'
import { recordPlayed } from '../services/storage'
import { contentHash } from '../services/hash'

interface ResultData {
  level: Level
  source: PlaySource
  timeMs: number
}

export class ResultScene extends Phaser.Scene {
  private sheet?: ShareSheet

  constructor() {
    super('ResultScene')
  }

  create(data: ResultData): void {
    // Oversized so it covers the viewport even after a rotate while this overlay is up.
    this.add.rectangle(0, 0, 8000, 8000, 0x000000, 0.55).setScrollFactor(0).setOrigin(0)

    void this.persistBestTime(data)

    this.sheet = new ShareSheet({
      level: data.level,
      deviceHash: this.registry.get('deviceHash') as string,
      timeMs: data.timeMs,
      onReplay: () => {
        this.scene.stop('ResultScene')
        this.scene.stop('LevelScene')
        this.scene.start('LevelScene', { level: data.level, source: data.source })
      },
      onHome: () => {
        this.scene.stop('ResultScene')
        this.scene.stop('LevelScene')
        navigateHash('#/')
      },
    })

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.sheet?.destroy()
      this.sheet = undefined
    })
  }

  private async persistBestTime(data: ResultData): Promise<void> {
    const id = await contentHash(data.level)
    await recordPlayed({
      id,
      level: data.level,
      source: data.source,
      playedAt: Date.now(),
      bestTimeMs: data.timeMs,
    })
  }
}
