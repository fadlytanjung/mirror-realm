// packages/shared/codegen/generate-ts.mjs
// docs: 02-repository-structure.md#shared
//
// Generates apps/web/src/domain/{level,vibes}.ts from the canonical JSON Schemas.
// `node generate-ts.mjs`         → write generated files
// `node generate-ts.mjs --check` → exit 1 if on-disk files differ (CI uses this)
//
// Edit the SOURCE (level.schema.json / vibes.json), never the generated .ts files.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { compile } from 'json-schema-to-typescript'

const here = dirname(fileURLToPath(import.meta.url))
const sharedDir = resolve(here, '..')
const webDomainDir = resolve(here, '../../../apps/web/src/domain')

const BANNER = `// DO NOT EDIT BY HAND — generated from packages/shared by \`pnpm gen\`.\n// docs: 04-domain-model.md#level\n`

// Array length bounds (minItems/maxItems) make json-schema-to-typescript emit
// huge tuple unions. We enforce lengths at runtime (services/validate.ts) and on
// the server (Pydantic), so strip them for clean `T[]` types matching docs/04.
function stripArrayBounds(node) {
  if (Array.isArray(node)) return node.map(stripArrayBounds)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'minItems' || k === 'maxItems') && node.type === 'array') continue
      out[k] = stripArrayBounds(v)
    }
    return out
  }
  return node
}

async function buildLevelTs() {
  const schema = JSON.parse(await readFile(resolve(sharedDir, 'level.schema.json'), 'utf-8'))
  const body = await compile(stripArrayBounds(schema), 'Level', {
    bannerComment: '',
    additionalProperties: false,
    style: { singleQuote: true, semi: false },
  })
  const vibeUnion = schema.properties.vibe.enum.map((v) => `'${v}'`).join(' | ')
  // The schema title is `MirrorRealmLevel`; expose a stable `Level` alias + `Vibe`.
  return (
    `${BANNER}\nexport type Vibe = ${vibeUnion}\n\n${body}\n` +
    `export type Level = MirrorRealmLevel\n`
  )
}

async function buildVibesTs() {
  const vibes = JSON.parse(await readFile(resolve(sharedDir, 'vibes.json'), 'utf-8'))
  const entries = vibes.vibes
    .map((v) => `  ${JSON.stringify(v.id)}: ${JSON.stringify(v)},`)
    .join('\n')
  return (
    `// DO NOT EDIT BY HAND — generated from packages/shared/vibes.json by \`pnpm gen\`.\n` +
    `// docs: 04-domain-model.md#vibes\n` +
    `import type { Vibe } from './level'\n\n` +
    `export interface VibeMetadata {\n` +
    `  id: Vibe\n  source: string\n  palette: string[]\n  tilesetPath: string\n  fallback?: boolean\n}\n\n` +
    `export const VIBES: Record<Vibe, VibeMetadata> = {\n${entries}\n}\n\n` +
    `export const VIBE_IDS = Object.keys(VIBES) as Vibe[]\n` +
    `export const FALLBACK_VIBE: Vibe = 'cozy'\n`
  )
}

async function emit(path, content, check) {
  let current = null
  try {
    current = await readFile(path, 'utf-8')
  } catch {
    /* not present yet */
  }
  if (check) {
    if (current !== content) {
      console.error(`drift: ${path} is stale. Run \`pnpm gen\`.`)
      process.exitCode = 1
    }
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
  console.log(`wrote ${path}`)
}

const check = process.argv.includes('--check')
await emit(resolve(webDomainDir, 'level.ts'), await buildLevelTs(), check)
await emit(resolve(webDomainDir, 'vibes.ts'), await buildVibesTs(), check)
