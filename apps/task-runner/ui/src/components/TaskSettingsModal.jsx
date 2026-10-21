import { useMemo, useState } from 'react'
import { Dialog, Field } from '@dscpln/ui-kit'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// One dialog for everything the UI can persist about a task: its schedule and
// its attribute values. Both are written to task-meta.json in the config repo.
export default function TaskSettingsModal({ task, attributes, onClose, onSave }) {
  const current = task.schedule ?? {}
  const [enabled, setEnabled] = useState(Boolean(current.enabled))
  const [daily, setDaily] = useState(!(current.days?.length))
  const [days, setDays] = useState(new Set(current.days ?? []))
  const [at, setAt] = useState(current.at ?? '05:00')
  const [catchUp, setCatchUp] = useState(current.catchUp !== false)
  const values = useMemo(() => ({ ...(task.attributes ?? {}) }), [task])
  const [taskAttributes, setTaskAttributes] = useState(values)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleDay = (day, checked) => {
    setDays((currentDays) => {
      const next = new Set(currentDays)
      if (checked) next.add(day)
      else next.delete(day)
      return next
    })
  }

  const attributeValues = (attribute) => {
    const list = [...(attribute.values ?? [])]
    const selected = taskAttributes[attribute.name]
    if (selected && !list.includes(selected)) list.push(selected)
    return list
  }

  const save = async () => {
    setError('')
    if (task.schedulable && enabled && !daily && days.size === 0) {
      setError('Choose at least one day, or select Every day.')
      return
    }
    if (task.schedulable && enabled && !/^\d{2}:\d{2}$/.test(at)) {
      setError('Choose a valid time.')
      return
    }
    setSaving(true)
    try {
      const payload = { attributes: taskAttributes }
      if (task.schedulable) {
        payload.schedule = {
          enabled,
          days: daily ? [] : [...days].sort((a, b) => a - b),
          at,
          catchUp,
        }
      }
      await onSave(payload)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      className="wide-dialog"
      title={`Settings: ${task.name}`}
      onClose={onClose}
      requestClose={onClose}
      actions={(
        <>
          <button className="outline secondary" type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
        </>
      )}
    >
      <div className="settings-editor">
        <section className="settings-section">
          <h3>Attributes</h3>
          {attributes.length ? (
            <div className="attribute-editor">
              {attributes.map((attribute) => (
                <Field key={attribute.name} label={attribute.name} htmlFor={`task-attribute-${attribute.name}`}>
                  <select
                    id={`task-attribute-${attribute.name}`}
                    value={taskAttributes[attribute.name] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      setTaskAttributes((currentValues) => {
                        const next = { ...currentValues }
                        if (value) next[attribute.name] = value
                        else delete next[attribute.name]
                        return next
                      })
                    }}
                  >
                    <option value="">Unassigned</option>
                    {attributeValues(attribute).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          ) : <p className="hint">No attributes are defined.</p>}
        </section>

        <section className="settings-section">
          <h3>Schedule</h3>
          {task.schedulable ? (
            <div className="schedule-editor">
              <label className="schedule-toggle">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                <span>Run this task automatically on a schedule</span>
              </label>

              <Field label="Time" htmlFor="schedule-time" hint="Local time on the Task Runner instance.">
                <input id="schedule-time" type="time" value={at} onChange={(event) => setAt(event.target.value)} />
              </Field>

              <div className="field">
                <span className="field__label">Days</span>
                <label className="schedule-toggle">
                  <input type="checkbox" checked={daily} onChange={(event) => setDaily(event.target.checked)} />
                  <span>Every day</span>
                </label>
                {!daily ? (
                  <div className="schedule-days">
                    {DAYS.map((label, day) => (
                      <label key={label} className="schedule-day">
                        <input type="checkbox" checked={days.has(day)} onChange={(event) => toggleDay(day, event.target.checked)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>

              <label className="schedule-toggle">
                <input type="checkbox" checked={catchUp} onChange={(event) => setCatchUp(event.target.checked)} />
                <span>Catch up a missed run when the Task Runner comes back</span>
              </label>
            </div>
          ) : (
            <p className="hint">This task needs manual input or browser interaction, so it cannot be scheduled.</p>
          )}
        </section>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Dialog>
  )
}
