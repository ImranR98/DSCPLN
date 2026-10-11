import path from 'node:path'
import { configStore } from './config-store.mjs'
import { stateStore } from './state-store.mjs'
import { Runner } from './runner.mjs'
import { Scheduler } from './scheduler.mjs'
import { Notifier } from './notifier.mjs'
import { createApp } from './app.mjs'

// Standard wiring for a scheduled D$CPLN app: config + state on disk, one
// Runner, a Scheduler that fires the same run function as the UI, ntfy
// notifications, and the kit's standard API routes.
//
//   const app = scheduledApp({
//     name: 'Contacts + Calendar',
//     dataDir: '/data',
//     defaults: { schedule: { enabled: true, days: [], at: '03:00', catchUp: true } },
//     normalize(cfg) { ... },            // optional canonicalization
//     validate(cfg) { ... },             // optional (throw ValidationError)
//     commands(cfg) { return [cmd, ...] } // string(s) or argv arrays for Runner
//     summarize(result, cfg) { return 'Exported 3 collections' },
//     stateExtra() { return { ... } },    // merged into GET /api/state
//     healthExtra() { return { ... } },
//     logFile: true,                      // Runner logs/last.log
//   })
//   await app.start()   // loads stores, generates defaults, starts scheduler
//
// `runNow()` is safe to call from HTTP and from the scheduler: a concurrent
// call is rejected, and the run itself is fire-and-forget (state + notify are
// recorded when it finishes).

export function scheduledApp(options) {
  const {
    name,
    dataDir,
    basePath = process.env.BASE_PATH ?? '',
    defaults = {},
    normalize = (cfg) => cfg,
    validate = () => {},
    secrets = [],
    commands,
    summarize = () => 'Completed',
    stateExtra = null,
    healthExtra = null,
    routes = null,
    staticDir = null,
    logDir = dataDir ? path.join(dataDir, 'logs') : null,
    onConfigChanged = null,
    onStart = null,
    port = Number(process.env.PORT ?? 8080),
    host = process.env.HOST ?? '0.0.0.0',
  } = options

  const configFile = path.join(dataDir, 'config.json')
  const stateFile = path.join(dataDir, 'state.json')

  const config = configStore(configFile, { defaults, normalize, validate, secrets })
  const state = stateStore(stateFile)
  const runner = new Runner({ logDir, title: name })
  const notifier = new Notifier(defaults.ntfy ?? {}, (line) => console.log(line))
  const scheduler = new Scheduler({
    getSpec: () => (config.get() ?? defaults).schedule ?? {},
    onDue: () => runNow({ trigger: 'schedule' }),
    isBusy: () => runner.running,
    onMissed: () => state.markMissed(),
    store: state,
    log: (line) => console.log(`[scheduler] ${line}`),
  })

  const runNow = ({ trigger = 'manual' } = {}) => {
    if (runner.running) {
      const err = new Error('A run is already active')
      err.statusCode = 409
      throw err
    }
    // Fire and forget: the HTTP response returns immediately; the run records
    // its own state and notification.
    execute(trigger).catch((err) => console.error(`run failed: ${err.stack ?? err.message}`))
    return { started: true }
  }

  async function execute(trigger) {
    const cfg = config.get()
    let result = null
    const startedAt = Date.now()
    await state.beginRun({ startedAt, trigger })
    try {
      const cmds = commands(cfg)
      result = await runner.run(cmds, { label: `${name} · ${trigger}` })
      const summary = result.ok ? summarize(result, cfg) : `Failed (exit ${result.exitCode})`
      await state.recordRun({
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        durationSec: result.durationSec,
        ok: result.ok,
        summary,
        trigger,
      })
      await notifier.notifyResult({ ok: result.ok, app: name, summary })
      return result
    } catch (err) {
      await state.recordRun({
        startedAt,
        endedAt: Date.now(),
        durationSec: 0,
        ok: false,
        summary: err.message,
        trigger,
      })
      await notifier.notifyResult({ ok: false, app: name, summary: err.message })
      throw err
    }
  }

  const app = createApp({
    title: name,
    basePath,
    staticDir,
    config,
    state,
    runner,
    run: runNow,
    routes: routes ? (router) => routes(router, { config, state, runner, scheduler, notifier, runNow }) : null,
    healthExtra,
    stateExtra: () => ({
      nextRun: scheduler.nextRunAt(),
      ...(stateExtra ? stateExtra() : {}),
    }),
    log: (line) => console.log(line),
  })

  const start = async () => {
    await config.load()
    await state.load()
    notifier.setConfig({ ntfy: config.get().ntfy ?? {} })
    config.onChange((cfg) => {
      notifier.setConfig({ ntfy: cfg.ntfy ?? {} })
      onConfigChanged?.(cfg)
    })
    scheduler.start()
    await onStart?.({ config, state, runner, scheduler, notifier })
    return { config, state, runner, scheduler, notifier }
  }

  const stop = () => {
    scheduler.stop()
    runner.cancel()
  }

  return { app, config, state, runner, scheduler, notifier, runNow, start, stop, port, host, name, dataDir }
}
