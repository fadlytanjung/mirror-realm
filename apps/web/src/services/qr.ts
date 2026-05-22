// apps/web/src/services/qr.ts
// docs: 08-frontend-app.md#sharing · 04-open-shared
//
// QR encode (qrious) + decode-from-video (jsqr).
import QRious from 'qrious'
import jsQR from 'jsqr'

/** Render `text` into a 256x256 canvas, error-correction level M. */
export function encode(text: string): HTMLCanvasElement {
  const qr = new QRious({
    value: text,
    size: 256,
    level: 'M',
    background: '#fdf6e3',
    foreground: '#1a0033',
    padding: 12,
  })
  return qr.canvas
}

/**
 * Yields decoded QR payloads from a live <video> until the iterator is
 * abandoned. Caller breaks out once it gets a valid Mirror Realm payload.
 */
export async function* decodeFromVideo(
  video: HTMLVideoElement,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

  while (!signal?.aborted) {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
      if (found?.data) yield found.data
    }
    await nextFrame()
  }
}
