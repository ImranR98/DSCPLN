import { Dialog } from '@dscpln/ui-kit'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { showToast } from '@dscpln/ui-kit'
import { categoryColor } from './lib/insights-model.js'
import CategoryPanel from './components/CategoryPanel.jsx'


const setsEqual = (a, b) => a.size === b.size && [...a].every((value) => b.has(value))

// Category picker for the dashboard: the same checkbox panels the insights
// page uses, shown as a modal. Toggles apply to the page live; "Save as
// default" persists the current selection to the Constants sheet so it
// becomes the workbook default.
const CategoriesDialog = forwardRef(function CategoriesDialog({ data, excluded, defaults, onToggle, onReset, onSave }, ref) {
  const rootRef = useRef(null)
  const [saving, setSaving] = useState(false)

  useImperativeHandle(ref, () => ({
    show() {
      rootRef.current.showModal()
    },
  }))

  const groups = (data?.categories || []).map((entry) => ({
    title: entry.group,
    list: {
      categories: entry.categories,
      rows: entry.categories.map((category) => ({
        category,
        color: categoryColor(category),
        checked: !excluded.has(category),
      })),
    },
  }))

  const defaultSet = new Set(defaults || [])
  const changed = !setsEqual(excluded, defaultSet)

  const save = async () => {
    setSaving(true)
    try {
      await onSave()
      showToast('Saved as the workbook default')
    } catch (e) {
      if (!e.status) {
        console.error(e)
      }
      showToast(e.status ? e.message : 'Could not save the default', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog dialogRef={rootRef} autoOpen={false} className="wide-dialog categories-dialog" title="Counted categories">

        <p className="hint">
          Unchecked categories are left out of this page&rsquo;s totals, budgets and charts.
          The defaults come from the Constants sheet (&ldquo;Excluded from Budget by Default&rdquo;);
          changes apply to this visit unless you save them.
        </p>

        <div className="categories-dialog__groups">
          {groups.map((group) => (
            <section className="categories-dialog__group" key={group.title}>
              <CategoryPanel title={group.title} list={group.list} onSetExcluded={onToggle} />
            </section>
          ))}
        </div>

        <div className="dialog-actions">
          <button className="link-button" type="button" onClick={onReset} disabled={!changed}>Reset to defaults</button>
          <span className="categories-dialog__actions-right">
            <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>Close</button>
            <button type="button" disabled={saving || !changed} onClick={save}>Save as default</button>
          </span>
        </div>
    </Dialog>
  )
})

export default CategoriesDialog
