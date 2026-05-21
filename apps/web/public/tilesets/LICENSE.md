# Asset provenance — tilesets, sprite, sfx

The v1 game assets in `public/tilesets/`, `public/sprites/`, `public/icons/`,
and `public/sfx/` are **procedurally generated** by
[`infra/asset-gen/generate-assets.mjs`](../../../../infra/asset-gen/generate-assets.mjs)
from the palettes in `packages/shared/vibes.json`.

They are original output of this repo (no third-party assets bundled) and are
released under the project's MIT license / CC0 — free to use, modify, share.

> The spec ([`docs/03-tech-stack.md#assets`](../../../../docs/03-tech-stack.md))
> describes sourcing curated CC0 packs (Kenney / OpenGameArt) for a polished
> release. v1 ships generated placeholders so a fresh clone is instantly
> playable; swap in curated art by replacing these PNGs (the 4×3 / 32px tileset
> layout in `src/game/tile-mapping.ts` is the contract to preserve).

To regenerate:

```bash
node infra/asset-gen/generate-assets.mjs
```
