import { Save } from 'lucide-react'

export default function ForecastSaveBar({
  statusText,
  saving,
  onReset,
  onDiscard,
  onSave,
}) {
  return (
    <div className="forecast-savebar" role="region" aria-label="Unsaved forecast changes">
      <span className="forecast-savebar__status" role="status" aria-live="polite">{statusText || 'Unsaved changes'}</span>
      <div className="forecast-savebar__actions">
        <button
          className="outline secondary"
          type="button"
          data-testid="forecast-reset-sticky"
          disabled={saving}
          title="Reset Base plan to defaults"
          aria-label="Reset Base plan to defaults"
          onClick={onReset}
        >
          <span className="forecast-label-wide">Reset defaults</span>
          <span className="forecast-label-narrow">Reset</span>
        </button>
        <button
          className="outline secondary"
          type="button"
          disabled={saving}
          title="Discard unsaved changes and reload the last saved version"
          aria-label="Discard unsaved changes and reload the last saved version"
          onClick={onDiscard}
        >
          <span className="forecast-label-wide">Discard changes</span>
          <span className="forecast-label-narrow">Discard</span>
        </button>
        <button type="button" disabled={saving} onClick={onSave} data-testid="forecast-save-sticky">
          <Save size={14} strokeWidth={1.8} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
