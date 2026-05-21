// apps/web/src/ui/toast.ts
// docs: 08-frontend-app.md#runtime
// Tiny DOM toast for transient errors/info. Lives above the Phaser canvas.
let host: HTMLDivElement | null = null

function ensureHost(): HTMLDivElement {
  if (host) return host
  host = document.createElement('div')
  host.className = 'mr-toast-host'
  document.body.appendChild(host)
  return host
}

export function toast(message: string, ms = 3200): void {
  const el = document.createElement('div')
  el.className = 'mr-toast'
  el.textContent = message
  ensureHost().appendChild(el)
  requestAnimationFrame(() => el.classList.add('is-in'))
  window.setTimeout(() => {
    el.classList.remove('is-in')
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }, ms)
}
