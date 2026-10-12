import { createRoot } from 'react-dom/client'
import AppErrorBoundary from './AppErrorBoundary.jsx'

// Mounts a D$CPLN app with the shared error boundary, so a render crash shows
// a readable panel instead of a blank page. Apps call this from main.jsx:
//
//   import '@dscpln/ui-kit/app.css'
//   import './app.css'
//   import App from './App.jsx'
//   import { mountApp } from '@dscpln/ui-kit'
//   mountApp(App)
export function mountApp(App) {
  createRoot(document.getElementById('app')).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  )
}
