// apps/web/src/shims.d.ts
// qrious ships no types; declare the tiny surface we use.
declare module 'qrious' {
  interface QRiousOptions {
    element?: HTMLCanvasElement
    value?: string
    size?: number
    level?: 'L' | 'M' | 'Q' | 'H'
    background?: string
    foreground?: string
    padding?: number
  }
  export default class QRious {
    constructor(options?: QRiousOptions)
    value: string
    size: number
    readonly canvas: HTMLCanvasElement
    toDataURL(mime?: string): string
  }
}

interface WakeLockSentinel {
  released: boolean
  release(): Promise<void>
}
interface WakeLock {
  request(type: 'screen'): Promise<WakeLockSentinel>
}
interface Navigator {
  readonly wakeLock?: WakeLock
}
