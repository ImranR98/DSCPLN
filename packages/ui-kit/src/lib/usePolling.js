import { useEffect, useRef } from 'react'

// Runs `callback` on an interval (immediately by default), swallowing
// rejections so a failed poll never becomes an unhandled error. Re-renders
// always call the latest callback without restarting the timer.
export function usePolling(callback, intervalMs, { enabled = true, runImmediately = true } = {}) {
  const saved = useRef(callback)
  saved.current = callback

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      Promise.resolve(saved.current()).catch(() => {})
    }
    if (runImmediately) tick()
    const timer = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, intervalMs, runImmediately])
}
