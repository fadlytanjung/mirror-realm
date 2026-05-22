// infra/asset-gen/generate-assets-ai.mjs
// docs: 03-tech-stack.md#assets · 08-frontend-app.md#rendering
//
// OPTIONAL, OPT-IN, PAID. Generates fancier pixel-art tilesets with a Gemini image
// model (nano-banana-pro / gemini-3-pro-image). This is NOT run by CI or the normal
// asset pipeline — the deterministic procedural generator (generate-assets.mjs) is
// the committed baseline. Use this only when you want to hand-curate prettier tiles.
//
// COST: each call bills image-generation tokens. To avoid surprise spend this script
// processes ONLY the vibe ids you pass on the command line — never all of them.
//
// Usage:
//   GEMINI_API_KEY=... node infra/asset-gen/generate-assets-ai.mjs neon forest
//
// Output goes to apps/web/public/tilesets-ai/<vibe>.png so it never overwrites the
// working tilesets. Review them, and if you like one, copy it over tilesets/<vibe>.png.
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const pub = resolve(repo, 'apps/web/public')

const API_KEY = process.env.GEMINI_API_KEY || process.env.MR_GEMINI_API_KEY
const MODEL = process.env.MR_IMAGE_MODEL || 'gemini-3-pro-image-preview'

const wanted = process.argv.slice(2)
if (!API_KEY) {
  console.error('Set GEMINI_API_KEY (or MR_GEMINI_API_KEY) first.')
  process.exit(1)
}
if (wanted.length === 0) {
  console.error('PAID generation. Pass one or more vibe ids, e.g.:')
  console.error('  node infra/asset-gen/generate-assets-ai.mjs neon forest')
  console.error('Nothing was generated, so nothing was billed.')
  process.exit(1)
}

const vibes = JSON.parse(await readFile(resolve(repo, 'packages/shared/vibes.json'), 'utf-8'))
const byId = new Map(vibes.vibes.map((v) => [v.id, v]))

// The tileset must keep the exact 4x3 / 64px-cell layout the game reads
// (tile-mapping.ts). We describe it precisely so the model lays cells out correctly.
function prompt(v) {
  const pal = (v.palette || []).join(', ')
  return [
    `Pixel-art platformer tileset sprite sheet, "${v.id}" vibe (${v.label ?? v.id}).`,
    `Palette: ${pal}.`,
    'Exactly 256x256 pixels, transparent background, crisp pixel art (no anti-aliasing).',
    'Lay out a 4-columns x 3-rows grid of 64x64 cells:',
    'Row 1 cells 1-3: a lit ground-surface block (grass/snow/metal cap over solid body),',
    'as left-edge / middle / right-edge variants.',
    'Row 2 cells 1-3: the same block interior (no cap), left / middle / right variants.',
    'Row 1 cell 4: a small glowing decoration orb.',
    'Row 2 cell 4: a gold goal flag on a pole.',
    'Row 3 cell 1: red danger spikes pointing up (rest of grid transparent).',
    'Tiles must tile seamlessly horizontally. No text, no grid lines, no watermark.',
  ].join(' ')
}

async function generate(id) {
  const v = byId.get(id)
  if (!v) {
    console.error(`unknown vibe "${id}" — skipping`)
    return
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt(v) }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  })
  if (!res.ok) {
    console.error(`${id}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
    return
  }
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const inline = parts.find((p) => p.inlineData?.data)?.inlineData
  if (!inline) {
    console.error(`${id}: no image in response`)
    return
  }
  const out = resolve(pub, `tilesets-ai/${id}.png`)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, Buffer.from(inline.data, 'base64'))
  console.log(`wrote tilesets-ai/${id}.png — review, then copy over tilesets/${id}.png if good`)
}

console.log(`Generating ${wanted.length} tileset(s) with ${MODEL} (this bills your key)...`)
for (const id of wanted) await generate(id)
