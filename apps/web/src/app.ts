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
import { PixelScene } from './scenes/PixelScene'
import { AnimationScene } from './scenes/AnimationScene'
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

let game: Phaser.Game

/**
 * Register a viewport-resize callback that survives scene restarts and is cleaned
 * up on scene shutdown. Fires once immediately so callers have a single layout path.
 * Debounced to coalesce the burst of events mobile browsers emit (URL bar, rotate).
 */
export function onResize(scene: Phaser.Scene, cb: (w: number, h: number) => void): void {
  let raf = 0
  const fire = (): void => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => cb(scene.scale.width, scene.scale.height))
  }
  scene.scale.on(Phaser.Scale.Events.RESIZE, fire)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    cancelAnimationFrame(raf)
    scene.scale.off(Phaser.Scale.Events.RESIZE, fire)
  })
  cb(scene.scale.width, scene.scale.height)
}

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

/**
 * Start a scene and STOP every other running scene first. Plain game.scene.start()
 * leaves the previous scene alive — which left CaptureScene's full-screen DOM overlay
 * (and its dead back button) on top of the menu after navigating away. Each scene's
 * SHUTDOWN handler (e.g. ScanOverlay cleanup) only fires when the scene is stopped.
 */
function startSceneExclusive(key: string, data?: object): void {
  for (const s of game.scene.getScenes(true)) {
    if (s.scene.key !== key) game.scene.stop(s.scene.key)
  }
  game.scene.start(key, data)
}

/** Centralised navigation. Resolves async sources, then starts the right scene. */
export async function go(route: Route): Promise<void> {
  switch (route.name) {
    case 'home':
      startSceneExclusive('MenuScene')
      return
    case 'capture':
      startSceneExclusive('CaptureScene')
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
        startSceneExclusive('MenuScene')
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
    startSceneExclusive('MenuScene')
    return
  }
  game.registry.set('level', level)
  game.registry.set('source', source)
  startSceneExclusive('LevelScene', { level, source, isFromYesterday })
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
    backgroundColor: '#140026',
    // Smooth (linear) scaling instead of nearest-neighbour: the 2x-source art is
    // up/down-scaled by the camera zoom, and NEAREST made it look like "broken
    // pixels". antialias keeps tiles + sprites crisp-but-clean (docs/08 §responsive).
    antialias: true,
    roundPixels: false,
    // RESIZE: the canvas always fills the viewport (no letterbox), so the game is
    // full-screen in portrait or landscape. Scenes read this.scale.{width,height}
    // and re-layout via onResize() (docs/08 §responsive).
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scene: [BootScene, MenuScene, CaptureScene, LevelScene, ResultScene, PixelScene, AnimationScene],
  })

  game.registry.set('deviceHash', getOrCreateDeviceHash())

  // Re-route on hash changes (back button, in-app links).
  window.addEventListener('hashchange', () => void go(parseLocation()))

  // iOS Safari sometimes reports stale dimensions on rotate and doesn't drive the
  // RESIZE listener; force the ScaleManager to recompute after the orientation settles.
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => game.scale.refresh(), 120)
  })
}
