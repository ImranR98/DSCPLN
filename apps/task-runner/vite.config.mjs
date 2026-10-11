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
  },
})
