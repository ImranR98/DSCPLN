import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Small filesystem helpers shared by every app: path expansion, existence
// checks and atomic writes. Everything that persists config or state must go
// through atomicWriteFile/atomicWriteJson so a crash never leaves a truncated
// file behind.

export function expandPath(p) {
  if (!p) return p
  let out = String(p)
  if (out === '~') out = os.homedir()
  else if (out.startsWith('~/')) out = path.join(os.homedir(), out.slice(2))
  out = out.replace(/\$(\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (_, _m, a, b) => process.env[a ?? b] ?? '')
  return path.resolve(out)
}

export async function pathExists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

export function statOrNull(p) {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

export async function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch (err) {
    if (fallback !== undefined && (err.code === 'ENOENT' || err instanceof SyntaxError)) {
      if (err instanceof SyntaxError) {
        throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err })
      }
      return fallback
    }
    throw err
  }
}

// Write temp file + fsync + rename: readers never observe a partial write.
export async function atomicWriteFile(file, data, { mode = 0o600 } = {}) {
  const dir = path.dirname(file)
  await fsp.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`)
  const handle = await fsp.open(tmp, 'w', mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fsp.rename(tmp, file)
}

export function atomicWriteJson(file, value, { mode = 0o600, pretty = 2 } = {}) {
  const data = JSON.stringify(value, null, pretty) + '\n'
  return atomicWriteFile(file, data, { mode })
}

// Deep merge for plain objects; arrays and scalar values from `override`
// replace the base value. Used to apply config defaults without losing nested
// app settings.
export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override
  }
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message)
    this.name = 'ValidationError'
    this.statusCode = 400
    this.details = details
  }
}
