// apps/web/src/game/tile-mapping.ts
// docs: 08-frontend-app.md#rendering
//
// 9-slice frame picker. Every vibe tileset PNG uses the SAME 32x32 frame layout
// (only the pixels differ), so this mapping is vibe-independent. The layout is
// produced by infra/asset-gen/generate-assets.mjs and consumed here + by builder.ts.
//
// Sheet is 4 columns wide; frame indices:
//   0 surface-top-left   1 surface-top   2 surface-top-right   3 decoration
//   4 fill-left          5 fill          6 fill-right          7 goal flag
//   8 hazard spike
export const TILE = 32 // world grid size (logical px per tile)
export const TILE_SRC = 64 // source texture frame size (2x); sprites are downscaled to TILE
export const TILESET_COLS = 4

export const FRAME = {
  TOP_LEFT: 0,
  TOP: 1,
  TOP_RIGHT: 2,
  DECO: 3,
  FILL_LEFT: 4,
  FILL: 5,
  FILL_RIGHT: 6,
  GOAL: 7,
  HAZARD: 8,
} as const

/** Frame for a cell at (col,row) inside a platform that is cols x rows tiles. */
export function platformFrame(col: number, row: number, cols: number): number {
  const left = col === 0
  const right = col === cols - 1
  if (row === 0) {
    if (left) return FRAME.TOP_LEFT
    if (right) return FRAME.TOP_RIGHT
    return FRAME.TOP
  }
  if (left) return FRAME.FILL_LEFT
  if (right) return FRAME.FILL_RIGHT
  return FRAME.FILL
}
