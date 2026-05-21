// infra/asset-gen/generate-assets.mjs
// docs: 03-tech-stack.md#assets · 08-frontend-app.md#rendering
//
// Generates the v1 game assets procedurally (pure JS, no native deps) so a fresh
// clone is immediately playable. NOT on the runtime path — run once:
//   node infra/asset-gen/generate-assets.mjs
//
// Tileset layout (must match apps/web/src/game/tile-mapping.ts): a 4x3 grid of
// 32px frames. Player sprite: 4 frames of 24x32.
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PNG } from 'pngjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const pub = resolve(repo, 'apps/web/public')

const TILE = 32

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
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return
  const i = (p.width * y + x) << 2
  p.data[i] = r
  p.data[i + 1] = g
  p.data[i + 2] = b
  p.data[i + 3] = a
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

// --- Tilesets ----------------------------------------------------------------
function drawTile(p, col, row, draw) {
  const ox = col * TILE
  const oy = row * TILE
  draw((x, y, c, a) => px(p, ox + x, oy + y, c, a), (x, y, w, h, c, a) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(p, ox + xx, oy + yy, c, a)
  })
}

function tileset(palette) {
  const p = img(TILE * 4, TILE * 3)
  const surface = hex(palette[0])
  const mid = hex(palette[1] ?? palette[0])
  const deep = hex(palette[2] ?? palette[1] ?? palette[0])

  const topTile = (col, left, right) =>
    drawTile(p, col, 0, (_set, fill) => {
      fill(0, 0, TILE, TILE, deep)
      fill(0, 0, TILE, 9, surface) // grass cap
      fill(0, 9, TILE, 2, shade(surface, 0.7))
      for (let x = 1; x < TILE; x += 3) fill(x, 2, 1, 3, shade(surface, 1.15)) // texture
      if (left) fill(0, 0, 2, TILE, shade(deep, 0.8))
      if (right) fill(TILE - 2, 0, 2, TILE, shade(deep, 0.8))
    })
  topTile(0, true, false)
  topTile(1, false, false)
  topTile(2, false, true)

  const fillTile = (col, left, right) =>
    drawTile(p, col, 1, (_set, fill) => {
      fill(0, 0, TILE, TILE, deep)
      for (let y = 2; y < TILE; y += 6)
        for (let x = 2; x < TILE; x += 6) fill(x, y, 2, 2, shade(mid, 0.9))
      if (left) fill(0, 0, 2, TILE, shade(deep, 0.8))
      if (right) fill(TILE - 2, 0, 2, TILE, shade(deep, 0.8))
    })
  fillTile(0, true, false)
  fillTile(1, false, false)
  fillTile(2, false, true)

  // (3,0) decoration motif — a soft glowing orb.
  drawTile(p, 3, 0, (set) => {
    const c = shade(mid, 1.2)
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const d = Math.hypot(x - 16, y - 16)
        if (d < 9) set(x, y, c, 230)
        else if (d < 12) set(x, y, c, 90)
      }
  })

  // (3,1) goal flag — gold pennant on a pole.
  drawTile(p, 3, 1, (set, fill) => {
    fill(14, 2, 3, 28, [220, 220, 220])
    for (let y = 4; y < 16; y++) for (let x = 17; x < 17 + (16 - y); x++) set(x, y, [255, 204, 0])
  })

  // (0,2) hazard spikes — danger red on transparent.
  drawTile(p, 0, 2, (set) => {
    const danger = [255, 51, 85]
    for (let s = 0; s < 4; s++) {
      const cx = s * 8 + 4
      for (let y = 0; y < 16; y++) {
        const half = Math.round((y / 16) * 4)
        for (let x = cx - half; x <= cx + half; x++) set(x, TILE - 1 - y, danger)
      }
    }
  })
  return p
}

// --- Player sprite (4 frames, 24x32) ----------------------------------------
function spark() {
  const W = 24
  const p = img(W * 4, 32)
  const body = [0, 255, 255]
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
    // body capsule
    for (let y = 8; y < 28; y++)
      for (let x = 6; x < 18; x++) {
        const d = Math.hypot(x - 12, y - 18)
        if (d < 7) px(p, ox + x, y, body)
        else if (d < 8) px(p, ox + x, y, glow, 200)
      }
    // head
    for (let y = 2; y < 12; y++)
      for (let x = 7; x < 17; x++) if (Math.hypot(x - 12, y - 7) < 5) px(p, ox + x, y, body)
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
  const bg = hex('#1a0033')
  rect(p, 0, 0, size, size, bg)
  // gradient wash
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size)
      px(p, x, y, [Math.round(26 + t * 60), Math.round(t * 20), Math.round(51 + t * 90)])
    }
  const cx = size / 2
  const cy = size / 2
  const inset = maskable ? size * 0.18 : 0 // maskable safe zone
  const rOuter = size * 0.34 - inset
  const rInner = rOuter * 0.62
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d < rOuter && d > rInner) px(p, x, y, [170, 0, 255], 255)
      else if (d <= rInner) px(p, x, y, [0, 255, 255], Math.round(40 + (1 - d / rInner) * 120))
    }
  // a little spark in the centre
  rect(p, Math.round(cx - size * 0.03), Math.round(cy - size * 0.12), Math.round(size * 0.06), Math.round(size * 0.24), [255, 255, 255])
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
for (const v of vibes.vibes) await save(tileset(v.palette), `tilesets/${v.id}.png`)

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
