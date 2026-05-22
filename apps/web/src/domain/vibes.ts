// DO NOT EDIT BY HAND — generated from packages/shared/vibes.json by `pnpm gen`.
// docs: 04-domain-model.md#vibes
import type { Vibe } from './level'

export interface VibeMetadata {
  id: Vibe
  source: string
  palette: string[]
  tilesetPath: string
  fallback?: boolean
}

export const VIBES: Record<Vibe, VibeMetadata> = {
  "cozy": {"id":"cozy","source":"Kenney Pixel Platformer","palette":["#f4e4c1","#c98a5a","#8b5a3c"],"tilesetPath":"/tilesets/cozy.png","fallback":true},
  "neon": {"id":"neon","source":"LimeZu Modern Interiors (recolor)","palette":["#ff00ff","#00ffff","#1a0033"],"tilesetPath":"/tilesets/neon.png"},
  "ruined": {"id":"ruined","source":"OpenGameArt Dark Castle","palette":["#5c5c5c","#a85a3c","#2a2a2a"],"tilesetPath":"/tilesets/ruined.png"},
  "forest": {"id":"forest","source":"Kenney Platformer Forest","palette":["#3c8a3c","#2a5a2a","#8acc66"],"tilesetPath":"/tilesets/forest.png"},
  "vapor": {"id":"vapor","source":"Cozy recolor (hue-rotate 180deg)","palette":["#ff66cc","#66ccff","#1a0033"],"tilesetPath":"/tilesets/vapor.png"},
  "desert": {"id":"desert","source":"Kenney Platformer Desert","palette":["#e0b070","#a87040","#704020"],"tilesetPath":"/tilesets/desert.png"},
  "industrial": {"id":"industrial","source":"OpenGameArt Industrial Tiles","palette":["#707070","#a04040","#404040"],"tilesetPath":"/tilesets/industrial.png"},
  "snow": {"id":"snow","source":"Kenney Platformer Snow","palette":["#e8f0ff","#a0b0c8","#506080"],"tilesetPath":"/tilesets/snow.png"},
  "underwater": {"id":"underwater","source":"Kenney Platformer Water","palette":["#3060a0","#5090c0","#102040"],"tilesetPath":"/tilesets/underwater.png"},
  "library": {"id":"library","source":"Custom: cozy + bookshelf decor","palette":["#7a4a2a","#c89060","#3a2a1a"],"tilesetPath":"/tilesets/library.png"},
  "cosmic": {"id":"cosmic","source":"Imagen 4 Fast (pre-generated)","palette":["#1a0033","#aa00ff","#ffcc00"],"tilesetPath":"/tilesets/cosmic.png"},
  "monochrome": {"id":"monochrome","source":"Kenney 1-Bit Pack","palette":["#000000","#ffffff"],"tilesetPath":"/tilesets/monochrome.png"},
}

export const VIBE_IDS = Object.keys(VIBES) as Vibe[]
export const FALLBACK_VIBE: Vibe = 'cozy'
