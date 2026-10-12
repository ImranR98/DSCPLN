import { appViteConfig } from '@dscpln/ui-kit/vite'

export default appViteConfig(import.meta.url, {
  inputs: ['index.html', 'insights.html', 'settings.html'],
})
