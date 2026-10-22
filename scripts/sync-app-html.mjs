// Generates every app's ui/*.html from one template so the head (charset,
// viewport, description, color-scheme, favicon, pre-paint theme bootstrap) and
// the module entry stay identical across the monorepo.
//
//   node scripts/sync-app-html.mjs           # write the files
//   node scripts/sync-app-html.mjs --check   # exit 1 when a file differs
//
// The <title> in the file is only the pre-load fallback: the server injects
// the real title (and <base href>) into the built HTML at serve time.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// file -> { title, description, entry } (entry relative to ui/, no leading slash)
const PAGES = {
  'apps/portal/ui/index.html': { title: 'D$CPLN', description: 'Self-hosted apps for your personal data', entry: 'main.jsx' },
  'apps/balance-xlsx/ui/index.html': { title: 'D$CPLN ⋅ Balance XLSX', description: 'Budget dashboard backed by your Excel workbook', entry: 'index.jsx' },
  'apps/balance-xlsx/ui/insights.html': { title: 'D$CPLN ⋅ Balance XLSX — Insights', description: 'Budget dashboard backed by your Excel workbook', entry: 'insights.jsx' },
  'apps/balance-xlsx/ui/forecasts.html': { title: 'D$CPLN ⋅ Balance XLSX — Forecasts', description: 'Budget dashboard backed by your Excel workbook', entry: 'forecasts.jsx' },
  'apps/balance-xlsx/ui/settings.html': { title: 'D$CPLN ⋅ Balance XLSX — Settings', description: 'Budget dashboard backed by your Excel workbook', entry: 'settings.jsx' },
  'apps/file-pipelines/ui/index.html': { title: 'D$CPLN ⋅ File Pipelines', description: 'Watch folders, organize media, and keep originals safe', entry: 'main.jsx' },
  'apps/task-runner/ui/index.html': { title: 'D$CPLN ⋅ Task Runner', description: 'Run scheduled and on-demand tasks', entry: 'main.jsx' },
  'apps/lockdown/ui/index.html': { title: 'D$CPLN ⋅ Lockdown', description: 'Block configured host ports for a limited time', entry: 'main.jsx' },
  'apps/whatsapp-txt/ui/index.html': { title: 'D$CPLN ⋅ WhatsApp TXT', description: 'Browse, import and merge WhatsApp chat exports', entry: 'main.jsx' },
}

const page = ({ title, description, entry }) => `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${description}">
    <meta name="color-scheme" content="light dark">
    <title>${title}</title>
    <link rel="icon"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%232f6fed'/%3E%3Ctext x='32' y='45' font-size='34' text-anchor='middle' fill='white' font-family='sans-serif'%3E%24%3C/text%3E%3C/svg%3E">
    <script>
        // Apply the saved theme before first paint to avoid a flash.
        try {
            const stored = localStorage.getItem('dscpln-theme')
            const dark = stored === 'dark' || ((!stored || stored === 'auto') && matchMedia('(prefers-color-scheme: dark)').matches)
            document.documentElement.dataset.theme = dark ? 'dark' : 'light'
        } catch { /* storage unavailable */ }
    </script>
</head>

<body>
    <div id="app"></div>
    <script type="module" src="/src/${entry}"></script>
</body>

</html>
`

const check = process.argv.includes('--check')
let changed = 0
for (const [file, page_] of Object.entries(PAGES)) {
  const target = path.join(REPO, file)
  const next = page(page_)
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  if (current === next) continue
  changed += 1
  if (check) console.log(`out of date: ${file}`)
  else {
    fs.writeFileSync(target, next)
    console.log(`updated ${file}`)
  }
}
if (check && changed) process.exit(1)
console.log(changed ? `${changed} file(s) ${check ? 'out of date' : 'written'}` : 'all app HTML files are up to date')
