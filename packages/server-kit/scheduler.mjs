// Schedule computation and a small ticker-driven Scheduler.
//
// Spec shape: { enabled, days: [0..6] (empty = daily), at: "HH:MM",
// catchUp: true }. Days are JS weekdays (0 = Sunday), times are local.
//
// The scheduler is fully testable: pass `now` and call `tick()` yourself.

const DEFAULT_TICK_MS = 30_000
// Without catchUp, an occurrence older than this is treated as missed instead
// of firing late (the tick interval plus slack).
const FRESH_WINDOW_MS = 90_000

export function parseAt(at) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

export function normalizeSpec(raw) {
  const spec = raw && typeof raw === 'object' ? raw : {}
  const days = Array.isArray(spec.days)
    ? [...new Set(spec.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : []
  const at = parseAt(spec.at)
  return {
    enabled: Boolean(spec.enabled),
    days,
    at: at ? `${String(at.hours).padStart(2, '0')}:${String(at.minutes).padStart(2, '0')}` : null,
    catchUp: spec.catchUp !== false,
  }
}

export function specValid(spec) {
  return Boolean(normalizeSpec(spec).at)
}

function atTime(day, time) {
  const date = new Date(day)
  date.setHours(time.hours, time.minutes, 0, 0)
  return date
}

// Most recent occurrence at or before `ref`, or null when the spec has no
// time / is not scheduled on any day.
export function occurrenceBefore(spec, ref) {
  const norm = normalizeSpec(spec)
  const time = parseAt(norm.at)
  if (!time) return null
  const day = new Date(ref)
  day.setHours(0, 0, 0, 0)
  for (let back = 0; back <= 7; back++) {
    const candidateDay = new Date(day)
    candidateDay.setDate(candidateDay.getDate() - back)
    if (norm.days.length && !norm.days.includes(candidateDay.getDay())) continue
    const candidate = atTime(candidateDay, time)
    if (candidate.getTime() <= ref.getTime()) return candidate.getTime()
  }
  return null
}

// Next occurrence strictly after `ref`.
export function occurrenceAfter(spec, ref) {
  const norm = normalizeSpec(spec)
  const time = parseAt(norm.at)
  if (!time) return null
  const day = new Date(ref)
  day.setHours(0, 0, 0, 0)
  for (let ahead = 0; ahead <= 7; ahead++) {
    const candidateDay = new Date(day)
    candidateDay.setDate(candidateDay.getDate() + ahead)
    if (norm.days.length && !norm.days.includes(candidateDay.getDay())) continue
    const candidate = atTime(candidateDay, time)
    if (candidate.getTime() > ref.getTime()) return candidate.getTime()
  }
  return null
}

export class Scheduler {
  // getSpec() -> spec; onDue(occurrenceMs) -> Promise|void; isBusy() -> bool
  // onMissed(occurrenceMs) -> void; store (stateStore, optional) persists the
  // last handled occurrence for catch-up across restarts.
  constructor(options) {
    const {
      getSpec,
      onDue,
      onMissed = () => {},
      isBusy = () => false,
      now = () => Date.now(),
      tickMs = DEFAULT_TICK_MS,
      store = null,
      log = () => {},
    } = options
    this.getSpec = getSpec
    this.onDue = onDue
    this.onMissed = onMissed
    this.isBusy = isBusy
    this.now = now
    this.tickMs = tickMs
    this.store = store
    this.log = log
    this.timer = null
    this.lastHandled = store ? store.lastScheduledRun() : null
    this.fired = 0
  }

  start() {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), this.tickMs)
    this.timer.unref?.()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
  }

  nextRunAt() {
    const spec = normalizeSpec(this.getSpec())
    if (!spec.enabled) return null
    return occurrenceAfter(spec, new Date(this.now()))
  }

  // One scheduling decision. Exposed for tests.
  async tick() {
    const spec = normalizeSpec(this.getSpec())
    if (!spec.enabled) {
      // Re-enabling later should not replay the disabled period.
      const latestWhileOff = occurrenceBefore(spec, new Date(this.now()))
      this.#setHandled(latestWhileOff)
      return
    }
    const now = new Date(this.now())
    const latest = occurrenceBefore(spec, now)
    if (latest == null) return
    // With catchUp the scheduler fires any occurrence newer than the persisted
    // marker (app was down over the scheduled time). Without it, only fresh
    // occurrences fire and older ones are recorded as missed.
    if (this.lastHandled == null) {
      // First ever tick with no persisted marker: adopt the latest occurrence
      // without firing (fresh install).
      this.#setHandled(latest)
      return
    }
    if (this.lastHandled >= latest) return

    const fresh = now.getTime() - latest <= FRESH_WINDOW_MS
    if (!spec.catchUp && !fresh) {
      this.log(`missed scheduled run at ${new Date(latest).toISOString()}`)
      this.#setHandled(latest)
      this.onMissed(latest)
      return
    }
    if (this.isBusy()) {
      this.log(`scheduled run at ${new Date(latest).toISOString()} skipped: run active`)
      this.#setHandled(latest)
      this.onMissed(latest)
      return
    }
    this.#setHandled(latest)
    this.fired += 1
    this.log(`scheduled run due (${new Date(latest).toISOString()})`)
    try {
      await this.onDue(latest)
    } catch (err) {
      this.log(`scheduled run failed to start: ${err.message}`)
    }
  }

  #setHandled(ts) {
    if (ts == null || ts === this.lastHandled) return
    this.lastHandled = ts
    this.store?.setLastScheduledRun(ts).catch(() => {})
  }
}
