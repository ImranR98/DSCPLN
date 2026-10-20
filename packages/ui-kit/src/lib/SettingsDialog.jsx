import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { getPath, setPath } from './paths.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const fieldId = (path) => `dscpln-${String(path).replace(/[^a-zA-Z0-9_-]/g, '-')}`

const SettingsDialog = forwardRef(function SettingsDialog(
  { fields = [], schedule = true, notice = null, onsave, extra },
  ref,
) {
  const dialogRef = useRef(null)
  const [draft, setDraft] = useState({ schedule: { enabled: false, days: [], at: '03:00', catchUp: true } })
  const [error, setError] = useState('')

  useImperativeHandle(ref, () => ({
    show(config) {
      const next = structuredClone(config ?? {})
      if (schedule) {
        next.schedule ??= { enabled: false, days: [], at: '03:00', catchUp: true }
        next.schedule.days ??= []
      }
      setDraft(next)
      setError('')
      dialogRef.current.showModal()
    },
  }))

  const value = (path) => {
    const current = getPath(draft, path)
    return current == null ? '' : current
  }

  const update = (path, next) => {
    setDraft((current) => {
      const copy = structuredClone(current)
      setPath(copy, path, next)
      return copy
    })
  }

  const patchSchedule = (patch) => {
    setDraft((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }))
  }

  const toggleDay = (index, checked) => {
    const days = new Set(draft.schedule.days ?? [])
    if (checked) days.add(index)
    else days.delete(index)
    patchSchedule({ days: [...days].sort() })
  }

  const save = async () => {
    try {
      await onsave(structuredClone(draft))
      dialogRef.current.close()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <dialog ref={dialogRef} className="wide-dialog">
      <article>
        <header className="card__header">
          <h2>Settings</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" aria-label="Close" onClick={() => dialogRef.current.close()}>&times;</button>
          </span>
        </header>

        <div className="settings-body">
          {notice ? <p className="hint">{notice}</p> : null}

          {schedule ? (
            <section className="settings-section">
              <h3>Schedule</h3>
              <div className="settings-row">
                <label htmlFor="dscpln-schedule-enabled">Enabled</label>
                <input
                  id="dscpln-schedule-enabled"
                  type="checkbox"
                  checked={Boolean(draft.schedule.enabled)}
                  onChange={(event) => patchSchedule({ enabled: event.target.checked })}
                />
              </div>
              <div className="settings-row">
                <label htmlFor="dscpln-schedule-catchup">Catch up missed runs</label>
                <input
                  id="dscpln-schedule-catchup"
                  type="checkbox"
                  checked={draft.schedule.catchUp !== false}
                  onChange={(event) => patchSchedule({ catchUp: event.target.checked })}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="dscpln-schedule-at">At</label>
                <input
                  id="dscpln-schedule-at"
                  type="time"
                  value={draft.schedule.at ?? '03:00'}
                  onChange={(event) => patchSchedule({ at: event.target.value })}
                />
              </div>
              <p className="hint">No days selected = every day.</p>
              <div className="settings-days">
                {DAYS.map((day, index) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={(draft.schedule.days ?? []).includes(index)}
                      onChange={(event) => toggleDay(index, event.target.checked)}
                    />
                    {day}
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {fields.map((field) => (
            <div className="field" key={field.path}>
              {field.type === 'checkbox' ? (
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(value(field.path))}
                    onChange={(event) => update(field.path, event.target.checked)}
                  />
                  {field.label ?? field.path}
                </label>
              ) : (
                <>
                  <label className="field__label" htmlFor={fieldId(field.path)}>{field.label ?? field.path}</label>
                  {field.type === 'textarea' ? (
                    <textarea
                      id={fieldId(field.path)}
                      rows={field.rows ?? 5}
                      placeholder={field.placeholder}
                      spellCheck="false"
                      className={field.className}
                      value={value(field.path)}
                      onChange={(event) => update(field.path, event.target.value)}
                    ></textarea>
                  ) : field.type === 'select' ? (
                    <select id={fieldId(field.path)} value={value(field.path)} onChange={(event) => update(field.path, event.target.value)}>
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={fieldId(field.path)}
                      type={field.type === 'password' ? 'password' : field.type ?? 'text'}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      value={value(field.path)}
                      onChange={(event) =>
                        update(field.path, field.type === 'number' ? Number(event.target.value) : event.target.value)
                      }
                    />
                  )}
                  {field.help ? <p className="hint">{field.help}</p> : null}
                </>
              )}
            </div>
          ))}

          {typeof extra === 'function' ? extra({ draft, update }) : extra}

          {error ? <p className="form-error">{error}</p> : null}
        </div>

        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => dialogRef.current.close()}>Cancel</button>
          <button onClick={save}>Save</button>
        </div>
      </article>
    </dialog>
  )
})

export default SettingsDialog
