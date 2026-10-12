import { Component } from 'react'

// Catches render errors and shows a readable panel instead of a blank page
// (e.g. the React "too many re-renders" crash that blanked WhatsApp TXT).
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main style={{ maxWidth: '44rem', margin: '4rem auto', padding: '0 1rem' }}>
        <section className="card">
          <header className="card__header">
            <h2>Something went wrong</h2>
          </header>
          <p className="muted">
            The app hit an unexpected error while rendering. Reloading usually fixes it; if it keeps
            happening, the message below is the place to start.
          </p>
          <pre className="code-block">{String(this.state.error?.message ?? this.state.error)}</pre>
          <div className="dialog-actions">
            <button onClick={() => location.reload()}>Reload</button>
          </div>
        </section>
      </main>
    )
  }
}
