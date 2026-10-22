// Shared form field: label + control + optional hint/error. Callers pass the
// control as children so it works with input/select/textarea.
export default function Field({ label, htmlFor, hint, error, className = '', children }) {
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
