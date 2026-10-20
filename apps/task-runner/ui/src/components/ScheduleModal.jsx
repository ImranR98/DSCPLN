import { useState } from 'react'
import { Dialog, Field } from '@dscpln/ui-kit'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Edit one task's effective schedule. The config file stays read-only; the
// server persists overrides under BACKUPCTL_STATE_DIR.
export default function ScheduleModal({ task, onClose, onSave }) {
  const current = task.schedule ?? {}
  const [enabled, setEnabled] = useState(Boolean(current.enabled))
  const [daily, setDaily] = useState(!(current.days?.length))
  const [days, setDays] = useState(new Set(current.days ?? []))
  const [at, setAt] = useState(current.at ?? '05:00')
  const [catchUp, setCatchUp] = useState(current.catchUp !== false)
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

  const save = async () => {
    setError('')
    if (enabled && !daily && days.size === 0) {
      setError('Choose at least one day, or select Every day.')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(at)) {
      setError('Choose a valid time.')
      return
    }
    setSaving(true)
    try {
      await onSave({
        enabled,
        days: daily ? [] : [...days].sort((a, b) => a - b),
        at,
        catchUp,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      className="wide-dialog"
      title={`Schedule: ${task.name}`}
      onClose={onClose}
      requestClose={onClose}
      actions={(
        <>
          <button className="outline secondary" type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save schedule'}</button>
        </>
      )}
    >
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

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Dialog>
  )
}
