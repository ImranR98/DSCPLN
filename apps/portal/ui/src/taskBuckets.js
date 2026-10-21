export const TASK_STALE_MS = 7 * 24 * 60 * 60 * 1000

export function taskBucket(task, now = Date.now()) {
  const ts = Number(task.state?.ts)
  const hasRun = Number.isFinite(ts) && ts > 0
  const ageMs = hasRun ? now - ts * 1000 : null
  // Errors are their own count regardless of age. A never-run/running task
  // with no completed run is active, not stale.
  if (task.state && task.state.ok === false) return 'errors'
  if (!task.running && (!hasRun || ageMs >= TASK_STALE_MS)) return 'stale'
  return 'recent'
}
