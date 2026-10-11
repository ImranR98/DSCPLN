import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: './',
  plugins: [svelte()],
  build: {
    outDir: fileURLToPath(new URL('./static', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./ui/index.html', import.meta.url)),
        insights: fileURLToPath(new URL('./ui/insights.html', import.meta.url)),
        settings: fileURLToPath(new URL('./ui/settings.html', import.meta.url)),
      },
    },
  },
})
