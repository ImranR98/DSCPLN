import { atomicWriteJson, readJsonFile } from './atomic.mjs'

// Per-app run state: last run, bounded history, next scheduled run, paused
// flag, missed-run count and the last scheduler occurrence handled. Persisted
// atomically; every mutation emits a change event so the API can stream it.
//
//   const state = stateStore(stateFile)
//   await state.load()
//   state.recordRun({ ok: true, summary: 'Backed up 12 files', startedAt, durationSec })
//   state.snapshot()

const DEFAULT_STATE = {
  lastRun: null,
  history: [],
  nextRun: null,
  paused: false,
  missed: 0,
  lastScheduledRun: null,
  // Set while a run is in flight so a killed process leaves a visible
  // "interrupted" marker instead of silently stale state.
  runMarker: null,
  updatedAt: null,
}

const HISTORY_LIMIT = 20

export function stateStore(file, options = {}) {
  const { historyLimit = HISTORY_LIMIT } = options
  let current = { ...DEFAULT_STATE }
  const listeners = new Set()

  const emit = () => {
    for (const fn of listeners) {
      try {
        fn(current)
      } catch (err) {
        console.error(`state change listener failed: ${err.message}`)
      }
    }
  }

  let writeChain = Promise.resolve()

  const persist = async () => {
    current.updatedAt = Date.now()
    // Serialize writes: a rapid run+state change must not interleave renames.
    // The catch keeps a failed write from poisoning the chain forever (which
    // would silently drop every later state update until a restart).
    writeChain = writeChain.catch(() => {}).then(() => atomicWriteJson(file, current))
    await writeChain
    emit()
    return current
  }

  const load = async () => {
    const raw = await readJsonFile(file, null)
    current = { ...DEFAULT_STATE, ...(raw ?? {}) }
    if (!Array.isArray(current.history)) current.history = []
    return current
  }

  return {
    file,
    load,
    snapshot: () => ({ ...current, history: current.history.slice() }),

    // Called when a run starts; recordRun clears the marker when it finishes.
    async beginRun(entry = {}) {
      current.runMarker = {
        startedAt: entry.startedAt ?? Date.now(),
        trigger: entry.trigger ?? 'manual',
      }
      return persist()
    },

    async recordRun(entry) {
      const run = {
        startedAt: entry.startedAt ?? null,
        endedAt: entry.endedAt ?? Date.now(),
        durationSec: entry.durationSec ?? null,
        ok: Boolean(entry.ok),
        summary: String(entry.summary ?? ''),
        trigger: entry.trigger ?? 'manual',
      }
      current.runMarker = null
      current.lastRun = run
      current.history = [run, ...current.history].slice(0, historyLimit)
      return persist()
    },

    async setNextRun(ts) {
      current.nextRun = ts == null ? null : Number(ts)
      return persist()
    },

    async setPaused(paused) {
      current.paused = Boolean(paused)
      return persist()
    },

    async setMissed(count) {
      current.missed = Math.max(0, Number(count) || 0)
      return persist()
    },

    async markMissed() {
      current.missed = (current.missed ?? 0) + 1
      return persist()
    },

    // The scheduler stores the last occurrence (ms epoch) it acted on here, so
    // catch-up works across restarts.
    lastScheduledRun: () => current.lastScheduledRun,
    async setLastScheduledRun(ts) {
      current.lastScheduledRun = ts == null ? null : Number(ts)
      return persist()
    },

    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
