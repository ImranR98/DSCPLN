import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import os from 'node:os'

// One active run per app. Commands are spawned detached (own process group)
// so cancel() can kill the whole tree; stdout/stderr are split into lines,
// streamed to subscribers and mirrored into logs/last.log. There is no
// timeout: a run ends when the command exits or is cancelled.

const MAX_LINES = 2000

export class Runner {
  // logDir: where logs/last.log is written. onLine callbacks receive every
  // line (SSE hook); onState callbacks fire when a run starts/ends.
  constructor(options = {}) {
    const {
      logDir = null,
      cwd = process.cwd(),
      env = {},
      maxLines = MAX_LINES,
      title = '',
    } = options
    this.logDir = logDir ? path.resolve(logDir) : null
    this.cwd = cwd
    this.env = env
    this.maxLines = maxLines
    this.title = title
    this.child = null
    this.startedAt = null
    this.lines = []
    this.lastLine = ''
    this.cancelled = false
    this.lineListeners = new Set()
    this.stateListeners = new Set()
    this.logStream = null
  }

  get running() {
    return Boolean(this.child)
  }

  status() {
    return {
      running: this.running,
      startedAt: this.startedAt,
      pid: this.child?.pid ?? null,
      lastLine: this.lastLine,
    }
  }

  recent(limit = 200) {
    if (!Number.isFinite(limit) || limit <= 0) limit = this.lines.length
    return this.lines.slice(-limit)
  }

  onLine(fn) {
    this.lineListeners.add(fn)
    return () => this.lineListeners.delete(fn)
  }

  onState(fn) {
    this.stateListeners.add(fn)
    return () => this.stateListeners.delete(fn)
  }

  #emitLine(line) {
    this.lastLine = line
    this.lines.push(line)
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines)
    }
    if (this.logStream) {
      try {
        this.logStream.write(line + '\n')
      } catch {
        this.logStream = null
      }
    }
    for (const fn of this.lineListeners) {
      try {
        fn(line)
      } catch {
        // a broken SSE client must not fail the run
      }
    }
  }

  #emitState() {
    for (const fn of this.stateListeners) {
      try {
        fn(this.status())
      } catch {
        // ignore listener errors
      }
    }
  }

  // command: shell string (default) or argv array via { shell: false }; an
  // array of commands runs sequentially and stops at the first failure.
  async run(command, options = {}) {
    if (this.running) {
      throw new Error('A run is already active')
    }
    const commands = Array.isArray(command) ? command : [command]
    if (commands.length === 0) {
      throw new Error('No command to run')
    }
    const {
      shell = true,
      cwd = this.cwd,
      env = {},
      label = null,
    } = options

    this.cancelled = false
    this.lines = []
    this.lastLine = ''
    this.startedAt = Date.now()

    if (this.logDir) {
      fs.mkdirSync(this.logDir, { recursive: true })
      const stream = fs.createWriteStream(path.join(this.logDir, 'last.log'), { flags: 'w' })
      // A full/read-only disk must never crash the app: keep streaming to
      // memory and stop writing the file.
      stream.on('error', () => {
        if (this.logStream === stream) this.logStream = null
      })
      this.logStream = stream
      if (label) this.logStream.write(`# ${label}\n`)
    }

    let exitCode = 0
    let signal = null
    try {
      for (const [index, cmd] of commands.entries()) {
        if (index > 0) this.#emitLine(`--- next command ---`)
        const [file, args] = Array.isArray(cmd) ? [cmd[0], cmd.slice(1)] : [cmd, []]
        const result = await this.#spawnOne(file, args, { shell: Array.isArray(cmd) ? false : shell, cwd, env })
        exitCode = result.exitCode
        signal = result.signal
        if (exitCode !== 0) break
      }
    } finally {
      const endedAt = Date.now()
      const result = {
        ok: exitCode === 0 && !this.cancelled,
        cancelled: this.cancelled,
        exitCode,
        signal,
        startedAt: this.startedAt,
        endedAt,
        durationSec: Math.round((endedAt - this.startedAt) / 1000),
      }
      this.child = null
      this.startedAt = null
      if (this.logStream) {
        this.logStream.end()
        this.logStream = null
      }
      this.#emitState()
      return result
    }
  }

  #spawnOne(file, args, { shell, cwd, env }) {
    return new Promise((resolve) => {
      let proc
      try {
        proc = spawn(file, args, {
          cwd,
          shell,
          detached: true,
          env: { ...process.env, ...this.env, ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (err) {
        this.#emitLine(`ERROR: could not start: ${err.message}`)
        resolve({ exitCode: 127, signal: null })
        return
      }
      this.child = proc
      this.#emitState()
      this.#emitLine(`$ ${shell ? file : [file, ...args].join(' ')}`)

      const tails = { out: '', err: '' }
      const consume = (key) => (chunk) => {
        tails[key] += chunk
        let idx
        while ((idx = tails[key].search(/[\r\n]/)) !== -1) {
          this.#emitLine(tails[key].slice(0, idx))
          const skip = tails[key][idx] === '\r' && tails[key][idx + 1] === '\n' ? 2 : 1
          tails[key] = tails[key].slice(idx + skip)
        }
      }
      proc.stdout.on('error', () => {})
      proc.stderr.on('error', () => {})
      proc.stdout.on('data', consume('out'))
      proc.stderr.on('data', consume('err'))
      proc.on('error', (err) => {
        this.#emitLine(`ERROR: could not start: ${err.message}`)
      })
      proc.on('close', (code, sig) => {
        if (tails.out) this.#emitLine(tails.out)
        if (tails.err) this.#emitLine(tails.err)
        const rc = code ?? (sig ? 128 + (os.constants.signals[sig] ?? 0) : 1)
        resolve({ exitCode: rc, signal: sig ?? null })
      })
    })
  }

  // Kills the process group (SIGTERM, then SIGKILL one second later).
  cancel() {
    if (!this.child) return false
    this.cancelled = true
    const pid = this.child.pid
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // already gone
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }, 1000)
    return true
  }
}
