// apps/web/src/services/camera.ts
// docs: 08-frontend-app.md#camera
//
// getUserMedia capture + JPEG compression to <=200KB base64 (server cap).
const MAX_B64 = 200_000

export class CameraError extends Error {}

/**
 * Live camera (getUserMedia) only works in a secure context — HTTPS or localhost.
 * Over plain-HTTP LAN (iPhone/Chrome pointing at a laptop IP) it's blocked, so the
 * capture flow falls back to a file/photo picker. See captureFromFile (docs/08 §camera).
 */
export function streamSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext
}

export async function requestStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('Camera not available in this browser.')
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  })
}

export function release(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * Compress a drawable source to a base64 JPEG <=200KB.
 * Lowers quality, then resolution, per docs/08 §5 algorithm.
 */
function compress(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srcW: number,
  srcH: number,
): string {
  for (const longEdge of [1280, 1024]) {
    const scale = Math.min(1, longEdge / Math.max(srcW, srcH))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(srcW * scale))
    canvas.height = Math.max(1, Math.round(srcH * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new CameraError('Canvas 2D context unavailable.')
    draw(ctx, canvas.width, canvas.height)
    for (let q = 0.7; q >= 0.4 - 1e-9; q -= 0.1) {
      // dataURL = "data:image/jpeg;base64,XXXX" — strip the prefix.
      const b64 = canvas.toDataURL('image/jpeg', Math.round(q * 10) / 10).split(',')[1] ?? ''
      if (b64.length > 0 && b64.length <= MAX_B64) return b64
    }
  }
  throw new CameraError('Photo too complex — try another.')
}

/** Capture a frame from a live <video> and return base64 JPEG <=200KB. */
export function capture(video: HTMLVideoElement): string {
  return compress(
    (ctx, w, h) => ctx.drawImage(video, 0, 0, w, h),
    video.videoWidth || 1280,
    video.videoHeight || 720,
  )
}

/**
 * Fallback when the live camera is unavailable: open the OS photo/file picker
 * (on mobile this offers the camera) and compress the chosen image. Resolves to
 * base64 JPEG, or rejects on cancel/read error.
 */
export function captureFromFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.setAttribute('capture', 'environment') // hint mobile to use the rear camera
    input.style.display = 'none'
    document.body.appendChild(input)
    const cleanup = (): void => input.remove()

    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0]
        if (!file) {
          cleanup()
          reject(new CameraError('No photo selected.'))
          return
        }
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
          try {
            resolve(compress((ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), img.naturalWidth, img.naturalHeight))
          } catch (e) {
            reject(e instanceof Error ? e : new CameraError('Capture failed.'))
          } finally {
            URL.revokeObjectURL(url)
            cleanup()
          }
        }
        img.onerror = () => {
          URL.revokeObjectURL(url)
          cleanup()
          reject(new CameraError('Could not read that image.'))
        }
        img.src = url
      },
      { once: true },
    )
    input.click()
  })
}
