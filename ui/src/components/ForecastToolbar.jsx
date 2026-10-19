import { RotateCcw, Save, Undo2 } from 'lucide-react'

export default function ForecastToolbar({
  scenario,
  statusText,
  hasChanges,
  saving,
  onReset,
  onDiscard,
  onSave,
}) {
  return (
    <section className="card forecast-toolbar" aria-label="Scenario controls">
      <div className="forecast-toolbar__row">
        <div className="forecast-toolbar__scenario">
          <span className="field__label">Scenario</span>
          <strong className="forecast-toolbar__name">{scenario?.name || 'Base plan'}</strong>
        </div>
        <div className="forecast-toolbar__save">
          <span className={`forecast-save-status${hasChanges ? ' forecast-save-status--dirty' : ''}`} role="status" aria-live="polite">{statusText}</span>
          <button
            className="outline secondary"
            type="button"
            data-testid="forecast-reset"
            disabled={saving}
            title="Reset Base plan to defaults"
            aria-label="Reset Base plan to defaults"
            onClick={onReset}
          >
            <RotateCcw size={14} strokeWidth={1.8} />
            <span className="forecast-label-wide">Reset defaults</span>
            <span className="forecast-label-narrow">Reset</span>
          </button>
          <button
            className="outline secondary"
            type="button"
            disabled={!hasChanges || saving}
            title="Discard unsaved changes and reload the last saved version"
            aria-label="Discard unsaved changes and reload the last saved version"
            onClick={onDiscard}
          >
            <Undo2 size={14} strokeWidth={1.8} />
            <span className="forecast-label-wide">Discard changes</span>
            <span className="forecast-label-narrow">Discard</span>
          </button>
          <button type="button" data-testid="forecast-save" disabled={!hasChanges || saving} onClick={onSave}>
            <Save size={14} strokeWidth={1.8} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {scenario && !scenario.sheetName ? (
        <p className="hint forecast-toolbar__draft">
          {scenario.dirty
            ? 'Local draft — press Save to create its scenario sheet.'
            : 'Local draft — edit a field and press Save to create its scenario sheet.'}
        </p>
      ) : null}
    </section>
  )
}
