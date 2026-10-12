// Shared Vite config for D$CPLN app UIs. UI source lives in ui/ and builds
// into static/, which the Node server serves; relative asset URLs (base './')
// keep the build valid under any BASE_PATH because the server injects
// <base href> into the built HTML.
//
//   // apps/<app>/vite.config.mjs
//   import { appViteConfig } from '@dscpln/ui-kit/vite'
//   export default appViteConfig(import.meta.url)
//
// Multi-page apps pass their HTML entries:
//   export default appViteConfig(import.meta.url, { inputs: ['index.html', 'insights.html'] })

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export function appViteConfig(appUrl, { inputs } = {}) {
  const root = fileURLToPath(new URL('./ui', appUrl))
  return defineConfig({
    root,
    base: './',
    plugins: [react()],
    build: {
      outDir: fileURLToPath(new URL('./static', appUrl)),
      emptyOutDir: true,
      ...(inputs
        ? {
            rollupOptions: {
              input: Object.fromEntries(
                inputs.map((file) => [file.replace(/\.html$/, ''), path.join(root, file)]),
              ),
            },
          }
        : {}),
    },
  })
}
