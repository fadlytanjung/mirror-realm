// apps/web/src/app.ts
// docs: 08-frontend-app.md#runtime · #routing
//
// Boots the single Phaser.Game, parses the location into a Route, and drives
// scene transitions. Cross-scene state lives in Phaser.Registry (no globals).
import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { CaptureScene } from './scenes/CaptureScene'
import { LevelScene } from './scenes/LevelScene'
import { ResultScene } from './scenes/ResultScene'
import { resolvePlaySource } from './routes/play'
import { getOrCreateDeviceHash } from './services/storage'
import { toast } from './ui/toast'
import type { Level } from './domain/level'

export type PlaySource = 'fresh' | 'qr' | 'daily' | 'short'
export type Route =
  | { name: 'home' }
  | { name: 'capture' }
  | { name: 'play'; source: PlaySource }
  | { name: 'daily' }
  | { name: 'short'; payload: string }
  | { name: 'inline'; payload: string }

const GAME_W = 960
const GAME_H = 540

let game: Phaser.Game

export function parseLocation(): Route {
  // Path-based deep links (Firebase rewrites serve index.html for these).
  const path = location.pathname
  const inline = path.match(/^\/p\/(.+)$/)
  if (inline) return { name: 'inline', payload: decodeURIComponent(inline[1] ?? '') }
  const short = path.match(/^\/l\/([a-zA-Z0-9]{6,7})$/)
  if (short) return { name: 'short', payload: short[1] ?? '' }

  // Hash routes.
  const hash = location.hash.replace(/^#/, '')
  const [route, query] = hash.split('?')
  const params = new URLSearchParams(query ?? '')
  switch (route) {
    case '/capture':
      return { name: 'capture' }
    case '/daily':
      return { name: 'daily' }
    case '/play':
      return { name: 'play', source: (params.get('source') as PlaySource) ?? 'fresh' }
    default:
      return { name: 'home' }
  }
}

/** Centralised navigation. Resolves async sources, then starts the right scene. */
export async function go(route: Route): Promise<void> {
  switch (route.name) {
    case 'home':
      game.scene.start('MenuScene')
      return
    case 'capture':
      game.scene.start('CaptureScene')
      return
    case 'play':
      startLevel(getCurrentLevel(), 'fresh')
      return
    case 'daily':
    case 'short':
    case 'inline': {
      const resolved = await resolvePlaySource(route)
      if (!resolved) {
        toast("That doesn't look like a Mirror Realm level.")
        game.scene.start('MenuScene')
        return
      }
      startLevel(resolved.level, resolved.source, resolved.isFromYesterday)
      return
    }
  }
}

function startLevel(level: Level | null, source: PlaySource, isFromYesterday = false): void {
  if (!level) {
    toast('No level loaded yet — capture one first.')
    game.scene.start('MenuScene')
    return
  }
  game.registry.set('level', level)
  game.registry.set('source', source)
  game.scene.start('LevelScene', { level, source, isFromYesterday })
}

function getCurrentLevel(): Level | null {
  return (game.registry.get('level') as Level | undefined) ?? null
}

export function setLevel(level: Level): void {
  game.registry.set('level', level)
}

export function navigateHash(hash: string): void {
  if (location.hash === hash) void go(parseLocation())
  else location.hash = hash
}

export function bootGame(): void {
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_W,
    height: GAME_H,
    backgroundColor: '#140026',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scene: [BootScene, MenuScene, CaptureScene, LevelScene, ResultScene],
  })

  game.registry.set('deviceHash', getOrCreateDeviceHash())

  // Re-route on hash changes (back button, in-app links).
  window.addEventListener('hashchange', () => void go(parseLocation()))
}
