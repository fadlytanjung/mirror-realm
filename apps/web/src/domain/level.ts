// DO NOT EDIT BY HAND — generated from packages/shared by `pnpm gen`.
// docs: 04-domain-model.md#level

export type Vibe = 'cozy' | 'neon' | 'ruined' | 'forest' | 'vapor' | 'desert' | 'industrial' | 'snow' | 'underwater' | 'library' | 'cosmic' | 'monochrome'

/**
 * A playable side-scrolling pixel-art platformer level extracted from a photo. Single source of truth — imported by Python (Pydantic) and TypeScript (auto-generated types).
 */
export interface MirrorRealmLevel {
  /**
   * Semantic version of THIS schema. Bump on any breaking change.
   */
  schemaVersion: '1.0.0'
  /**
   * Which pre-baked tileset to render with. Enum is normative — see docs/04-domain-model.md#vibes.
   */
  vibe:
    | 'cozy'
    | 'neon'
    | 'ruined'
    | 'forest'
    | 'vapor'
    | 'desert'
    | 'industrial'
    | 'snow'
    | 'underwater'
    | 'library'
    | 'cosmic'
    | 'monochrome'
  /**
   * Which experience the AI chose to reveal first from the photo. The playable level is ALWAYS generated (so sharing always opens a game); 'pixel'/'animation' are on-device reveals of the captured photo. See docs/08-frontend-app.md#experiences.
   */
  experience?: 'platformer' | 'pixel' | 'animation'
  platforms: Rect[]
  hazards?: Rect[]
  decorations?: Decoration[]
  spawn: Point
  goal: Point
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
  label?: string
}
export interface Decoration {
  x: number
  y: number
  label?: string
}
export interface Point {
  x: number
  y: number
}

export type Level = MirrorRealmLevel
