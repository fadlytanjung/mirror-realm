// apps/web/src/scenes/BootScene.ts
// docs: 08-frontend-app.md#scenes
// First scene. No heavy preloads (tilesets load per-level). Routes to the
// scene the URL asks for.
import Phaser from 'phaser'
import { go, parseLocation } from '../app'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  create(): void {
    void go(parseLocation())
  }
}
