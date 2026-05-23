// apps/web/src/services/pixelize.ts
// docs: 08-frontend-app.md#experiences
//
// Client-side "funny pixel" conversion of a captured photo: downscale to a small grid,
// posterize the colours (so it reads as deliberate pixel art, not a blurry photo), then
// crisp-upscale with nearest-neighbour. Free, instant, on-device (the photo never leaves
// the phone). Returns a PNG data URL.

export interface PixelOptions {
  cols?: number // pixel-grid width (default 72)
  steps?: number // colour levels per channel (default 5 → chunky palette)
  saturate?: number // saturation multiplier (default 1.3 for poppy colours)
  out?: number // output width in px (default 512)
}

export function toPixelArt(dataUrl: string, opts: PixelOptions = {}): Promise<string> {
  const { cols = 72, steps = 5, saturate = 1.3, out = 512 } = opts
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const aspect = (img.naturalHeight || 1) / (img.naturalWidth || 1)
        const rows = Math.max(1, Math.round(cols * aspect))

        const small = document.createElement('canvas')
        small.width = cols
        small.height = rows
        const sctx = small.getContext('2d')
        if (!sctx) throw new Error('no 2d context')
        sctx.imageSmoothingEnabled = false
        sctx.drawImage(img, 0, 0, cols, rows)
        const id = sctx.getImageData(0, 0, cols, rows)
        posterize(id.data, steps, saturate)
        sctx.putImageData(id, 0, 0)

        const scale = Math.max(1, Math.round(out / cols))
        const big = document.createElement('canvas')
        big.width = cols * scale
        big.height = rows * scale
        const bctx = big.getContext('2d')
        if (!bctx) throw new Error('no 2d context')
        bctx.imageSmoothingEnabled = false
        bctx.drawImage(small, 0, 0, big.width, big.height)
        resolve(big.toDataURL('image/png'))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('pixelize failed'))
      }
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = dataUrl
  })
}

function posterize(d: Uint8ClampedArray, steps: number, sat: number): void {
  const q = 255 / Math.max(1, steps - 1)
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] ?? 0
    const g = d[i + 1] ?? 0
    const b = d[i + 2] ?? 0
    // Push saturation around luma, then snap each channel to the nearest palette step.
    const l = 0.299 * r + 0.587 * g + 0.114 * b
    d[i] = Math.round((Math.round(clamp(l + (r - l) * sat) / q) * q))
    d[i + 1] = Math.round((Math.round(clamp(l + (g - l) * sat) / q) * q))
    d[i + 2] = Math.round((Math.round(clamp(l + (b - l) * sat) / q) * q))
  }
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}
