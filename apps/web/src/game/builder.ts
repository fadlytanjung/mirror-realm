// apps/web/src/game/builder.ts
// docs: 08-frontend-app.md#rendering
//
// Translates an abstract Level (rects in a 1920x540 world) into Phaser objects.
// We tile each platform rect with 32x32 frames from the vibe spritesheet into a
// StaticGroup. (The spec floats a Tilemap approach; at 4-12 platforms a static
// sprite group is simpler and renders identically — see docs/08 rendering note.)
import Phaser from 'phaser'
import type { Level } from '../domain/level'
import { TILE, FRAME, platformFrame } from './tile-mapping'

/** Downscale a 2x-source static sprite to the TILE world footprint + fix its body. */
function fitStatic(s: Phaser.GameObjects.GameObject, w = TILE, h = TILE): void {
  const sprite = s as Phaser.Physics.Arcade.Sprite
  sprite.setDisplaySize(w, h)
  sprite.refreshBody() // recompute the static body from the new display size
}

export interface BuiltLevel {
  platformsGroup: Phaser.Physics.Arcade.StaticGroup
  hazardsGroup: Phaser.Physics.Arcade.StaticGroup
  goal: Phaser.Types.Physics.Arcade.SpriteWithStaticBody
  decorations: Phaser.GameObjects.Image[]
}

function tileRect(
  group: Phaser.Physics.Arcade.StaticGroup,
  rect: { x: number; y: number; w: number; h: number },
  frameFor: (col: number, row: number, cols: number) => number,
): void {
  const cols = Math.max(1, Math.round(rect.w / TILE))
  const rows = Math.max(1, Math.round(rect.h / TILE))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = rect.x + col * TILE + TILE / 2
      const py = rect.y + row * TILE + TILE / 2
      fitStatic(group.create(px, py, 'tiles', frameFor(col, row, cols)))
    }
  }
}

export function buildLevel(scene: Phaser.Scene, level: Level): BuiltLevel {
  const platformsGroup = scene.physics.add.staticGroup()
  const hazardsGroup = scene.physics.add.staticGroup()

  for (const p of level.platforms) {
    tileRect(platformsGroup, p, platformFrame)
  }
  for (const h of level.hazards ?? []) {
    tileRect(hazardsGroup, h, () => FRAME.HAZARD)
  }

  // Decorations are purely visual (no physics, behind the player).
  const decorations: Phaser.GameObjects.Image[] = []
  for (const d of level.decorations ?? []) {
    const img = scene.add
      .image(d.x, d.y, 'tiles', FRAME.DECO)
      .setDisplaySize(TILE, TILE)
      .setDepth(-1)
      .setAlpha(0.85)
    decorations.push(img)
  }

  const goal = scene.physics.add.staticSprite(
    level.goal.x + TILE / 2,
    level.goal.y + TILE / 2,
    'tiles',
    FRAME.GOAL,
  ) as Phaser.Types.Physics.Arcade.SpriteWithStaticBody
  fitStatic(goal)
  goal.setData('kind', 'goal')

  return { platformsGroup, hazardsGroup, goal, decorations }
}
