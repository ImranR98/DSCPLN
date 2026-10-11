import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSteps, pythonFor, writeBrowserJson, DOWNLOADER_DIR } from '../run.mjs'

test('pythonFor prefers the bundled venv and falls back to python3', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmusic-py-'))
  const downloader = path.join(base, 'downloader')
  fs.mkdirSync(downloader, { recursive: true })
  assert.equal(pythonFor(downloader), 'python3')
  const bin = path.join(base, 'venv', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'python'), '#!')
  assert.equal(pythonFor(downloader), path.join(bin, 'python'))
  fs.rmSync(base, { recursive: true, force: true })
})

test('buildSteps runs the downloader then playlist validation', () => {
  const steps = buildSteps({ musicDir: '/music' }, '/downloader')
  assert.equal(steps.length, 2)
  assert.deepEqual(steps[0].args, ['ytmusic_dl.py', '--dir', '/music'])
  assert.equal(steps[0].cwd, '/downloader')
  assert.deepEqual(steps[1].args, ['validate_m3u8s.sh', '/music'])
})

test('writeBrowserJson validates JSON and writes mode 0600', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmusic-auth-'))
  await assert.rejects(() => writeBrowserJson({ browserJson: '' }, root), /not configured/)
  await assert.rejects(() => writeBrowserJson({ browserJson: '{not json' }, root), /not valid JSON/)
  const file = await writeBrowserJson({ browserJson: '{"cookie":"x"}' }, root)
  assert.equal(fs.readFileSync(file, 'utf8'), '{"cookie":"x"}')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  fs.rmSync(root, { recursive: true, force: true })
})

test('the downloader directory exists in the app', () => {
  assert.equal(fs.existsSync(path.join(DOWNLOADER_DIR, 'ytmusic_dl.py')), true)
  assert.equal(fs.existsSync(path.join(DOWNLOADER_DIR, 'validate_m3u8s.sh')), true)
})
