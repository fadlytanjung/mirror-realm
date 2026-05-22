// infra/asset-gen/generate-assets.mjs
// docs: 03-tech-stack.md#assets · 08-frontend-app.md#rendering
//
// Generates the v1 game assets procedurally (pure JS, no native deps) so a fresh
// clone is immediately playable. NOT on the runtime path — run once:
//   node infra/asset-gen/generate-assets.mjs
//
// Tileset layout (must match apps/web/src/game/tile-mapping.ts): a 4x3 grid of
// TILE_SRC-px frames. Player sprite: 4 frames of PLAYER_SRC_W x PLAYER_SRC_H.
//
// > Changed 2026-05-22: art rendered at 2x source resolution (64px tiles, 48x64
// player) with proper shading/AO/dither for a crisper, less "flat" look. The world
// grid stays 32px — the web app downscales the texture for sharpness.
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PNG } from 'pngjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const pub = resolve(repo, 'apps/web/public')

const TILE = 64 // source tile resolution (2x the 32px world grid)

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16)
  return h.length > 4
    ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    : [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
}
function img(w, h) {
  return new PNG({ width: w, height: h })
}
function px(p, x, y, [r, g, b], a = 255) {
  x = Math.round(x)
  y = Math.round(y)
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return
  const i = (p.width * y + x) << 2
  // alpha-blend onto whatever is there (lets glows/highlights layer nicely)
  const ba = p.data[i + 3]
  if (a >= 255 || ba === 0) {
    p.data[i] = r
    p.data[i + 1] = g
    p.data[i + 2] = b
    p.data[i + 3] = a
    return
  }
  const af = a / 255
  p.data[i] = Math.round(r * af + p.data[i] * (1 - af))
  p.data[i + 1] = Math.round(g * af + p.data[i + 1] * (1 - af))
  p.data[i + 2] = Math.round(b * af + p.data[i + 2] * (1 - af))
  p.data[i + 3] = Math.max(ba, a)
}
function rect(p, x, y, w, h, c, a = 255) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(p, xx, yy, c, a)
}
async function save(p, rel) {
  const out = resolve(pub, rel)
  await mkdir(dirname(out), { recursive: true })
  await new Promise((res, rej) => {
    const chunks = []
    p.pack()
      .on('data', (c) => chunks.push(c))
      .on('end', () => writeFile(out, Buffer.concat(chunks)).then(res, rej))
      .on('error', rej)
  })
  console.log('wrote', rel)
}

function shade([r, g, b], f) {
  const k = (v) => Math.max(0, Math.min(255, Math.round(v * f)))
  return [k(r), k(g), k(b)]
}
function mix([r, g, b], [r2, g2, b2], t) {
  return [Math.round(r + (r2 - r) * t), Math.round(g + (g2 - g) * t), Math.round(b + (b2 - b) * t)]
}
// Deterministic value noise so re-runs are byte-identical.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

// --- Tilesets ----------------------------------------------------------------
function drawTile(p, col, row, draw) {
  const ox = col * TILE
  const oy = row * TILE
  draw(
    (x, y, c, a) => px(p, ox + x, oy + y, c, a),
    (x, y, w, h, c, a) => rect(p, ox + x, oy + y, w, h, c, a),
  )
}

function tileset(palette, seed) {
  const p = img(TILE * 4, TILE * 3)
  const surface = hex(palette[0])
  const mid = hex(palette[1] ?? palette[0])
  const deep = hex(palette[2] ?? palette[1] ?? palette[0])
  const light = shade(surface, 1.35)
  const ao = shade(deep, 0.62)
  const cap = 18 // height of the lit top "cap" band

  const edges = (fill, left, right) => {
    if (left) {
      fill(0, 0, 2, TILE, ao)
      fill(2, 0, 1, TILE, shade(deep, 0.8), 160)
    }
    if (right) {
      fill(TILE - 2, 0, 2, TILE, ao)
      fill(TILE - 3, 0, 1, TILE, shade(deep, 0.8), 160)
    }
  }

  // Row 0 — lit top surface (grass/snow/metal cap over the body).
  const topTile = (col, left, right) =>
    drawTile(p, col, 0, (set, fill) => {
      const r = rng(seed + col * 97)
      fill(0, 0, TILE, TILE, deep) // body
      // subtle vertical body dither
      for (let y = cap; y < TILE; y++)
        for (let x = 0; x < TILE; x++) if (r() > 0.86) set(x, y, mix(deep, mid, 0.5), 110)
      fill(0, 0, TILE, cap, surface) // cap band
      fill(0, 0, TILE, 3, light) // top highlight
      fill(0, cap - 3, TILE, 3, shade(surface, 0.7)) // cap shadow lip
      // little tufts of texture on the cap
      for (let x = 2; x < TILE; x += 7) fill(x, 4, 2, 6, mix(surface, light, 0.6), 200)
      edges(fill, left, right)
    })
  topTile(0, true, false)
  topTile(1, false, false)
  topTile(2, false, true)

  // Row 1 — interior fill with a soft brick pattern + AO.
  const fillTile = (col, left, right) =>
    drawTile(p, col, 1, (set, fill) => {
      const r = rng(seed + 31 + col * 53)
      fill(0, 0, TILE, TILE, deep)
      const brick = mix(deep, mid, 0.45)
      const mortar = shade(deep, 0.75)
      const bw = 28
      const bh = 14
      for (let y = 0; y < TILE; y += bh) {
        const off = (y / bh) % 2 ? bw / 2 : 0
        fill(0, y, TILE, 1, mortar) // mortar line
        for (let x = -off; x < TILE; x += bw) {
          fill(Math.max(0, x), y + 1, 1, bh - 1, mortar)
          // face shading: lighter top, darker bottom
          for (let yy = y + 1; yy < y + bh; yy++)
            for (let xx = Math.max(0, x + 1); xx < Math.min(TILE, x + bw); xx++)
              set(xx, yy, mix(brick, yy - y < bh / 2 ? mid : ao, 0.25), 255)
          if (r() > 0.8) set(x + 4, y + 4, light, 90) // sparkle fleck
        }
      }
      edges(fill, left, right)
    })
  fillTile(0, true, false)
  fillTile(1, false, false)
  fillTile(2, false, true)

  // (3,0) decoration — a soft glowing orb with a radial ramp.
  drawTile(p, 3, 0, (set) => {
    const c = shade(mid, 1.25)
    const core = mix(c, [255, 255, 255], 0.4)
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const d = Math.hypot(x - 32, y - 32)
        if (d < 12) set(x, y, mix(core, c, d / 12), 235)
        else if (d < 26) set(x, y, c, Math.round(150 * (1 - (d - 12) / 14)))
      }
  })

  // (3,1) goal flag — gold pennant on a bright pole.
  drawTile(p, 3, 1, (set, fill) => {
    fill(28, 4, 4, TILE - 6, [228, 228, 232])
    fill(28, 4, 2, TILE - 6, [255, 255, 255]) // pole highlight
    const gold = [255, 204, 0]
    for (let y = 8; y < 34; y++) {
      const w = Math.round(26 - Math.abs(21 - y))
      for (let x = 0; x < w; x++) set(32 + x, y, mix(gold, x < 3 ? [255, 240, 160] : shade(gold, 0.8), x / w))
    }
  })

  // (0,2) hazard spikes — danger gradient with a glint, on transparent.
  drawTile(p, 0, 2, (set) => {
    const danger = [255, 51, 85]
    const tip = [255, 160, 180]
    for (let s = 0; s < 4; s++) {
      const cx = s * 16 + 8
      for (let y = 0; y < 32; y++) {
        const half = Math.round((y / 32) * 7)
        for (let x = cx - half; x <= cx + half; x++)
          set(x, TILE - 1 - y, mix(shade(danger, 0.7), danger, y / 32))
      }
      set(cx, TILE - 30, tip) // glint near the tip
    }
  })
  return p
}

// --- Player sprite (4 frames, 24x32 — native world size, no downscale) -------
// Kept at 1x so the dynamic Arcade body needs no scaling; shaded for a cleaner look.
function spark() {
  const W = 24
  const p = img(W * 4, 32)
  const body = [0, 235, 255]
  const bodyLight = [190, 255, 255]
  const glow = [170, 0, 255]
  const eye = [20, 0, 40]
  const legSets = [
    [[8, 30], [14, 30]], // idle
    [[6, 30], [16, 28]], // run 1
    [[16, 30], [6, 28]], // run 2
    [[7, 29], [15, 29]], // jump (tucked)
  ]
  for (let f = 0; f < 4; f++) {
    const ox = f * W
    // body capsule with top-light shading + glow rim
    for (let y = 8; y < 28; y++)
      for (let x = 6; x < 18; x++) {
        const d = Math.hypot(x - 12, y - 18)
        if (d < 7) px(p, ox + x, y, mix(bodyLight, body, Math.min(1, (y - 8) / 16)))
        else if (d < 8) px(p, ox + x, y, glow, 200)
      }
    // head
    for (let y = 2; y < 12; y++)
      for (let x = 7; x < 17; x++)
        if (Math.hypot(x - 12, y - 7) < 5) px(p, ox + x, y, mix(bodyLight, body, (y - 2) / 10))
    px(p, ox + 10, 6, eye)
    px(p, ox + 14, 6, eye)
    // legs
    for (const [lx, ly] of legSets[f]) rect(p, ox + lx, ly, 2, 32 - ly, glow)
  }
  return p
}

// --- App icons ---------------------------------------------------------------
function icon(size, maskable) {
  const p = img(size, size)
  // diagonal gradient wash
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size)
      px(p, x, y, [Math.round(20 + t * 70), Math.round(t * 24), Math.round(45 + t * 110)])
    }
  const cx = size / 2
  const cy = size / 2
  const inset = maskable ? size * 0.18 : 0 // maskable safe zone
  const rOuter = size * 0.34 - inset
  const rInner = rOuter * 0.62
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d < rOuter && d > rInner) {
        // glowing ring with a slight gradient
        px(p, x, y, mix([170, 0, 255], [0, 255, 255], (d - rInner) / (rOuter - rInner)))
      } else if (d <= rInner) {
        px(p, x, y, [0, 255, 255], Math.round(30 + (1 - d / rInner) * 150))
      }
    }
  // central spark
  rect(
    p,
    Math.round(cx - size * 0.025),
    Math.round(cy - size * 0.13),
    Math.round(size * 0.05),
    Math.round(size * 0.26),
    [255, 255, 255],
  )
  rect(
    p,
    Math.round(cx - size * 0.11),
    Math.round(cy - size * 0.01),
    Math.round(size * 0.22),
    Math.round(size * 0.02),
    [255, 255, 255],
    200,
  )
  return p
}

// --- SFX (tiny PCM WAV tones) ------------------------------------------------
function wav(freqStart, freqEnd, ms, kind = 'square') {
  const rate = 22050
  const n = Math.round((rate * ms) / 1000)
  const data = Buffer.alloc(44 + n * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + n * 2, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / n
    const f = freqStart + (freqEnd - freqStart) * t
    const phase = (i * f) / rate
    let s = kind === 'square' ? (phase % 1 < 0.5 ? 1 : -1) : Math.sin(phase * Math.PI * 2)
    s *= 1 - t // decay
    data.writeInt16LE(Math.round(s * 9000), 44 + i * 2)
  }
  return data
}

// --- Run ---------------------------------------------------------------------
const vibes = JSON.parse(await readFile(resolve(repo, 'packages/shared/vibes.json'), 'utf-8'))
let seed = 1
for (const v of vibes.vibes) await save(tileset(v.palette, seed++ * 7919), `tilesets/${v.id}.png`)

await save(spark(), 'sprites/spark.png')
await save(icon(192, false), 'icons/icon-192.png')
await save(icon(512, false), 'icons/icon-512.png')
await save(icon(512, true), 'icons/icon-maskable-512.png')
await save(icon(180, false), 'apple-touch-icon.png')

await mkdir(resolve(pub, 'sfx'), { recursive: true })
await writeFile(resolve(pub, 'sfx/jump.wav'), wav(420, 900, 120, 'square'))
await writeFile(resolve(pub, 'sfx/die.wav'), wav(300, 80, 260, 'square'))
await writeFile(resolve(pub, 'sfx/win.wav'), wav(520, 1040, 360, 'sine'))
console.log('wrote sfx/{jump,die,win}.wav')
