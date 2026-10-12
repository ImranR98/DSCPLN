// Runs the preview end to end: the real Balance API (synthetic workbook) on
// :5599 plus this Vite app on :5177. Ctrl+C stops both.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(root, '../..')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-demo-'))
fs.copyFileSync(path.join(REPO, 'apps/balance-xlsx/mock-data.xlsx'), path.join(dir, 'Balance.xlsx'))
execFileSync('git', ['init', '-q'], { cwd: dir })

const { createApp } = await import(path.join(REPO, 'apps/balance-xlsx/server.mjs'))
const { app } = createApp({
  port: 5599,
  dataProvider: 'excelDataProvider',
  providers: { excelDataProvider: { workbookFile: path.join(dir, 'Balance.xlsx'), transactionsSheet: 'Transactions', constantsSheet: 'Constants' } },
  api: { stateFile: path.join(dir, 'api-state.json') },
  configDir: dir,
})
const api = app.listen(5599, '127.0.0.1')
await once(api, 'listening')
console.log('balance api: http://127.0.0.1:5599')

const vite = spawn('npx', ['vite', '--port', '5177', '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit' })

const stop = () => {
  vite.kill('SIGTERM')
  api.close(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
