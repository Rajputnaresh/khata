import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles/app.css'

const el = document.getElementById('root')
if (!el) throw new Error('Root element missing')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Auto-updating service worker: precaches the app shell for offline use and
// swaps in a new build on the next launch. `immediate` avoids a stale first
// paint after an update.
registerSW({ immediate: true })
