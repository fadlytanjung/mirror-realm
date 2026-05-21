// apps/web/src/services/camera.ts
// docs: 08-frontend-app.md#camera
//
// getUserMedia capture + JPEG compression to <=200KB base64 (server cap).
const MAX_B64 = 200_000

export class CameraError extends Error {}

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

function drawFrame(video: HTMLVideoElement, longEdge: number): HTMLCanvasElement {
  const vw = video.videoWidth || 1280
  const vh = video.videoHeight || 720
  const scale = Math.min(1, longEdge / Math.max(vw, vh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vw * scale)
  canvas.height = Math.round(vh * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CameraError('Canvas 2D context unavailable.')
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

function toJpegB64(canvas: HTMLCanvasElement, quality: number): string {
  // dataURL = "data:image/jpeg;base64,XXXX" — strip the prefix.
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? ''
}

/**
 * Capture a frame from a live <video> and return base64 JPEG <=200KB.
 * Lowers quality, then resolution, per docs/08 §5 algorithm.
 */
export function capture(video: HTMLVideoElement): string {
  for (const longEdge of [1280, 1024]) {
    const canvas = drawFrame(video, longEdge)
    for (let q = 0.7; q >= 0.4 - 1e-9; q -= 0.1) {
      const b64 = toJpegB64(canvas, Math.round(q * 10) / 10)
      if (b64.length > 0 && b64.length <= MAX_B64) return b64
    }
  }
  throw new CameraError('Photo too complex — try another.')
}
