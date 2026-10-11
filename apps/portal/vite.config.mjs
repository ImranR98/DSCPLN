import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// UI source lives in ui/ and builds into static/, which the Node server serves.
// Relative asset URLs (base './') keep the build valid under any BASE_PATH; the
// server injects <base href> into the built index.html.
export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: './',
  plugins: [svelte()],
  build: {
    outDir: fileURLToPath(new URL('./static', import.meta.url)),
    emptyOutDir: true,
  },
})
