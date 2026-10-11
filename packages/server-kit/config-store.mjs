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

export function configStore(file, options = {}) {
  const {
    defaults = {},
    normalize = (raw) => raw,
    validate = () => {},
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
    const next = normalizeAndValidate(raw)
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
