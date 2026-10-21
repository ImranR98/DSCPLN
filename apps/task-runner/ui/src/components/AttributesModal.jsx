import { useState } from 'react'
import { Dialog, Field } from '@dscpln/ui-kit'

const clone = (attributes) => attributes.map((attribute) => ({ ...attribute, values: [...attribute.values] }))

// Attribute definitions are global: adding/removing one here changes the
// grouping/filter choices and the chips on every card. Category is built in.
export default function AttributesModal({ attributes, defaultGroupBy, onClose, onSave }) {
  const [draft, setDraft] = useState(() => clone(attributes))
  const [defaultBy, setDefaultBy] = useState(defaultGroupBy)
  const [newName, setNewName] = useState('')
  const [valueDrafts, setValueDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const updateValues = (name, updater) => {
    setDraft((current) => current.map((attribute) => (
      attribute.name === name ? { ...attribute, values: updater(attribute.values) } : attribute
    )))
  }

  const addValue = (name) => {
    const value = (valueDrafts[name] ?? '').trim()
    if (!value) return
    updateValues(name, (values) => (values.includes(value) ? values : [...values, value]))
    setValueDrafts((current) => ({ ...current, [name]: '' }))
  }

  const removeValue = (name, value) => {
    updateValues(name, (values) => values.filter((entry) => entry !== value))
  }

  const addAttribute = () => {
    const name = newName.trim()
    if (!name) return
    if (draft.some((attribute) => attribute.name === name)) {
      setError(`Attribute '${name}' already exists.`)
      return
    }
    setDraft((current) => [...current, { name, values: [] }])
    setNewName('')
    setError('')
  }

  const removeAttribute = (name) => {
    if (name === 'Category') return
    setDraft((current) => current.filter((attribute) => attribute.name !== name))
    if (defaultBy === name) setDefaultBy('Category')
  }

  const save = async () => {
    setError('')
    if (!draft.some((attribute) => attribute.name === 'Category')) {
      setError('The Category attribute is required.')
      return
    }
    if (draft.some((attribute) => !attribute.name.trim())) {
      setError('Every attribute needs a name.')
      return
    }
    if (draft.some((attribute, index) => draft.findIndex((entry) => entry.name === attribute.name) !== index)) {
      setError('Attribute names must be unique.')
      return
    }
    setSaving(true)
    try {
      await onSave({ attributes: draft, default_group_by: defaultBy })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      className="wide-dialog"
      title="Manage attributes"
      onClose={onClose}
      requestClose={onClose}
      actions={(
        <>
          <button className="outline secondary" type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save attributes'}</button>
        </>
      )}
    >
      <div className="settings-editor">
        <p className="hint">Attributes group, filter and label tasks. Removing an attribute or value also removes it from tasks.</p>

        <Field label="Default grouping" htmlFor="default-group-by">
          <select id="default-group-by" value={defaultBy} onChange={(event) => setDefaultBy(event.target.value)}>
            {draft.map((attribute) => <option key={attribute.name} value={attribute.name}>{attribute.name}</option>)}
          </select>
        </Field>

        <div className="attribute-list">
          {draft.map((attribute) => (
            <section className="attribute-card" key={attribute.name}>
              <div className="attribute-card__head">
                <strong>{attribute.name}</strong>
                {attribute.name === 'Category' ? (
                  <span className="muted">required</span>
                ) : (
                  <button className="outline secondary" type="button" onClick={() => removeAttribute(attribute.name)}>Remove attribute</button>
                )}
              </div>
              <div className="attribute-values">
                {attribute.values.length ? attribute.values.map((value) => (
                  <span className="attribute-value" key={value}>
                    {value}
                    <button
                      type="button"
                      className="attribute-value__remove"
                      aria-label={`Remove ${value} from ${attribute.name}`}
                      onClick={() => removeValue(attribute.name, value)}
                    >×</button>
                  </span>
                )) : <span className="hint">No values yet.</span>}
              </div>
              <div className="attribute-add">
                <input
                  aria-label={`New ${attribute.name} value`}
                  placeholder="Add a value"
                  value={valueDrafts[attribute.name] ?? ''}
                  onChange={(event) => setValueDrafts((current) => ({ ...current, [attribute.name]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addValue(attribute.name)
                    }
                  }}
                />
                <button className="outline secondary" type="button" onClick={() => addValue(attribute.name)}>Add value</button>
              </div>
            </section>
          ))}
        </div>

        <div className="attribute-add">
          <input
            aria-label="New attribute name"
            placeholder="New attribute name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addAttribute()
              }
            }}
          />
          <button className="outline secondary" type="button" onClick={addAttribute}>Add attribute</button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Dialog>
  )
}
