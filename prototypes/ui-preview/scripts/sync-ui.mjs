// Fetches the shadcn-svelte components at build time. Nothing generated here is
// committed: the CLI writes into src/lib/components/ui (gitignored), the base
// stylesheet is copied out of the CLI package, and utils is the registry one.
//
// Run automatically by `predev`/`prebuild`; safe to re-run (skips when present).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMPONENTS = [
  'button', 'card', 'badge', 'input', 'textarea', 'select', 'dialog', 'alert',
  'alert-dialog', 'progress', 'table', 'tabs', 'tooltip', 'popover', 'command',
  'checkbox', 'separator', 'label', 'dropdown-menu', 'chart', 'sonner',
]
const force = process.argv.includes('--force')
const uiDir = path.join(root, 'src/lib/components/ui')
const marker = path.join(uiDir, 'button')

if (force || !existsSync(marker)) {
  console.log(`[sync-ui] fetching ${COMPONENTS.length} components via shadcn-svelte (unpinned, latest)`)
  execFileSync('npx', ['shadcn-svelte@latest', 'add', '-y', '--skip-preflight', '--no-deps-install', ...COMPONENTS], {
    cwd: root,
    stdio: 'inherit',
  })
} else {
  console.log('[sync-ui] components already present (use --force to refetch)')
}

// Base stylesheet (custom variants/utilities) ships inside the CLI package.
const base = path.join(root, 'src/lib/generated/shadcn-base.css')
mkdirSync(path.dirname(base), { recursive: true })
copyFileSync(path.join(root, 'node_modules/shadcn-svelte/dist/tailwind.css'), base)

// `cn` helper, as shipped by the registry's utils item (v1.7+ uses the `cn` package).
writeFileSync(path.join(root, 'src/lib/utils.js'), 'export { cn } from "cn";\n')
console.log('[sync-ui] generated base.css and utils.js')
