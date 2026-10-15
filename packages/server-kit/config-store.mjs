import { atomicWriteJson, deepMerge, readJsonFile, ValidationError } from './atomic.mjs'

// App configuration on disk (mode 0600) with defaults, validation and change
// notifications. The config file is the full source of truth; `normalize`
// receives the defaults-merged raw object and returns the canonical shape.
//
//   const store = configStore(configFile, {
//     defaults: { schedule: { enabled: true, at: '03:00' } },
//     normalize(raw) { ... },
//     validate(cfg) { ... },        // throw ValidationError on bad input
//   })
//   await store.load()
//   store.get()                     // current config
//   await store.save(next)
//   store.onChange((cfg) => {})

// Sentinels for write-only secret fields: GET responses replace a set secret
// with SECRET_MASK, and saving the mask back (unchanged field) keeps the
// stored value. An explicit empty string clears it. Secret names may be dotted
// paths (`ntfy.token`) for nested config sections.
export const SECRET_MASK = '••••••••'

export function resolveSecret(value, stored) {
  if (value == null || value === '' || value === SECRET_MASK) return stored ?? ''
  return value
}

export function getPathValue(obj, path) {
  let current = obj
  for (const key of String(path).split('.')) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

export function setPathValue(obj, path, value) {
  const keys = String(path).split('.')
  let current = obj
  for (const key of keys.slice(0, -1)) {
    if (current[key] == null || typeof current[key] !== 'object') current[key] = {}
    current = current[key]
  }
  current[keys[keys.length - 1]] = value
  return obj
}

export function configStore(file, options = {}) {
  const {
    defaults = {},
    normalize = (raw) => raw,
    validate = () => {},
    secrets = [],
  } = options
  let current = null
  const listeners = new Set()

  const emit = (cfg) => {
    for (const fn of listeners) {
      try {
        fn(cfg)
      } catch (err) {
        console.error(`config change listener failed: ${err.message}`)
      }
    }
  }

  const normalizeAndValidate = (raw) => {
    const merged = deepMerge(defaults, raw ?? {})
    const next = normalize(merged)
    validate(next)
    return next
  }

  const save = async (raw) => {
    const prepared = structuredClone(raw ?? {})
    for (const field of secrets) {
      if (getPathValue(prepared, field) === SECRET_MASK) {
        setPathValue(prepared, field, getPathValue(current, field) ?? '')
      }
    }
    const next = normalizeAndValidate(prepared)
    await atomicWriteJson(file, next)
    current = next
    emit(next)
    return next
  }

  const load = async () => {
    const raw = await readJsonFile(file, null)
    const next = normalizeAndValidate(raw)
    current = next
    if (raw == null) {
      // create the file on first boot so permissions/dir errors surface now
      await atomicWriteJson(file, next)
    }
    return next
  }

  // Shallow update: callers pass the complete new config (dashboards edit the
  // whole form anyway). `patch` merges one level deep for convenience.
  const update = (patch) => save(deepMerge(current ?? {}, patch))

  const onChange = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return {
    file,
    load,
    save,
    update,
    get: () => current,
    // Config for API responses: secret fields are masked when set.
    public: () => {
      const out = structuredClone(current ?? {})
      for (const field of secrets) {
        if (getPathValue(out, field)) setPathValue(out, field, SECRET_MASK)
      }
      return out
    },
    secrets,
    onChange,
  }
}

// Convenience validator: ensures the value is one of `allowed`.
export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`)
  }
  return value
}
