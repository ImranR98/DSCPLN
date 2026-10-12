import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(root, '../..')
const BALANCE = process.env.BALANCE_URL || 'http://127.0.0.1:5599'

const balanceRoutes = [
  '/data',
  '/budget',
  '/transactions',
  '/details-suggestions',
  '/category-suggestions',
  '/token',
]

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      $lib: path.resolve(root, 'src/lib'),
      // Reuse the balance app's pure math module as-is.
      '@balance': path.resolve(REPO, 'apps/balance-xlsx/ui/src/lib'),
    },
  },
  server: {
    fs: { allow: [REPO, root] },
    proxy: Object.fromEntries(balanceRoutes.map((route) => [route, BALANCE])),
  },
  preview: {
    proxy: Object.fromEntries(balanceRoutes.map((route) => [route, BALANCE])),
  },
})
