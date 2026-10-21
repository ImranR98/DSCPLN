// User-managed task metadata: attribute definitions, per-task attribute values
// and schedules. It lives in the private config repo next to config.mjs so
// changes are committed (and made from the Task Runner UI) rather than hidden
// in runtime state.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export class TaskMetaError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'TaskMetaError'
  }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function taskMetaFileFor(configPath) {
  if (process.env.BACKUPCTL_META_FILE) return path.resolve(process.env.BACKUPCTL_META_FILE)
  const resolved = configPath instanceof URL ? fileURLToPath(configPath) : path.resolve(configPath)
  return path.join(path.dirname(resolved), 'task-meta.json')
}

function normalizeAttributeEntry(entry, index) {
  if (!isPlainObject(entry)) throw new TaskMetaError(`attributes[${index}] must be an object`)
  const name = String(entry.name ?? '').trim()
  if (!name) throw new TaskMetaError(`attributes[${index}].name is required`)
  if (!Array.isArray(entry.values)) throw new TaskMetaError(`Attribute '${name}': values must be a list`)
  const values = []
  for (const value of entry.values) {
    if (typeof value !== 'string') throw new TaskMetaError(`Attribute '${name}': values must be strings`)
    const trimmed = value.trim()
    if (trimmed && !values.includes(trimmed)) values.push(trimmed)
  }
  return { ...entry, name, values }
}

// Validates and normalizes attribute definitions without inventing any. Used
// both when reading task-meta.json and when the UI saves the manager.
export function normalizeAttributeDefinitions(raw, label = 'attributes') {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TaskMetaError(`${label} must be a non-empty list`)
  }
  const definitions = []
  const names = new Set()
  for (const [index, entry] of raw.entries()) {
    const normalized = normalizeAttributeEntry(entry, index)
    if (names.has(normalized.name)) {
      throw new TaskMetaError(`Duplicate attribute name: '${normalized.name}'`)
    }
    names.add(normalized.name)
    definitions.push(normalized)
  }
  return definitions
}

// Category is the one attribute that has a natural default (the config group).
// It is only synthesized when the metadata does not define it.
export function attributeDefinitions(raw, groups = []) {
  let definitions = []
  if (Array.isArray(raw) && raw.length) definitions = normalizeAttributeDefinitions(raw)
  if (!definitions.some((attribute) => attribute.name === 'Category')) {
    definitions.unshift({ name: 'Category', values: [...new Set(groups.filter(Boolean))] })
  }
  return definitions
}

export function defaultGroupBy(meta, definitions) {
  const names = new Set(definitions.map((attribute) => attribute.name))
  if (meta?.default_group_by && names.has(meta.default_group_by)) return meta.default_group_by
  if (names.has('Best run from')) return 'Best run from'
  return definitions[0]?.name ?? 'Category'
}

function normalizeTaskEntry(name, entry) {
  if (!isPlainObject(entry)) throw new TaskMetaError(`tasks['${name}'] must be an object`)
  const normalized = { ...entry }
  if (entry.attributes !== undefined) {
    if (!isPlainObject(entry.attributes)) {
      throw new TaskMetaError(`Task '${name}': attributes must be an object`)
    }
    normalized.attributes = {}
    for (const [attribute, value] of Object.entries(entry.attributes)) {
      if (typeof value !== 'string') {
        throw new TaskMetaError(`Task '${name}': attribute '${attribute}' must be a string`)
      }
      normalized.attributes[attribute] = value
    }
  }
  if (entry.schedule !== undefined && entry.schedule !== null && !isPlainObject(entry.schedule)) {
    throw new TaskMetaError(`Task '${name}': schedule must be an object or null`)
  }
  return normalized
}

export function readTaskMeta(file) {
  if (!fs.existsSync(file)) return null
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new TaskMetaError(`${file} is not valid JSON: ${err.message}`, { cause: err })
  }
  if (!isPlainObject(data)) throw new TaskMetaError(`${file} must contain a JSON object`)
  if (data.attributes !== undefined && !Array.isArray(data.attributes)) {
    throw new TaskMetaError(`${file}: attributes must be a list`)
  }
  if (data.tasks !== undefined && !isPlainObject(data.tasks)) {
    throw new TaskMetaError(`${file}: tasks must be an object`)
  }
  if (data.default_group_by !== undefined && typeof data.default_group_by !== 'string') {
    throw new TaskMetaError(`${file}: default_group_by must be a string`)
  }
  const tasks = {}
  for (const [name, entry] of Object.entries(data.tasks ?? {})) {
    tasks[name] = normalizeTaskEntry(name, entry)
  }
  return {
    ...data,
    version: data.version ?? 1,
    attributes: data.attributes?.length ? normalizeAttributeDefinitions(data.attributes) : [],
    default_group_by: data.default_group_by ?? '',
    tasks,
  }
}

// The config checkout is owned by the login user while the server runs as
// root. Hand the metadata back so Syncthing/editors never see a root-owned
// file. Local test runs cannot chown and simply skip it.
function handToOwner(file) {
  const uid = Number(process.env.BACKUPCTL_STATE_UID ?? 1000)
  const gid = Number(process.env.BACKUPCTL_STATE_GID ?? uid)
  try {
    fs.chmodSync(file, 0o664)
    fs.chownSync(file, uid, gid)
  } catch {
    // best effort: non-root local runs and users without chown
  }
}

export function writeTaskMeta(file, meta) {
  const data = `${JSON.stringify(meta, null, 2)}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  const fd = fs.openSync(tmp, 'w', 0o664)
  try {
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  handToOwner(file)
}
