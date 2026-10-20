#!/usr/bin/env node
// YTMusic downloader CLI used by the Task Runner's scheduled task.
//
// The old YTMusic app's HTTP/Settings layer is gone; this wrapper keeps the
// downloader + playlist validation and reads its config/browser headers from
// the private config repo. It prints a concise final summary line so the Task
// Runner can use summary_last_line.
//
//   node run.mjs --config tools/ytmusic/config.json \
//     [--browser-file secrets/ytmusic-browser.json] [--data-dir /data] \
//     [--test]
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const execFileAsync = promisify(execFile)
export const DOWNLOADER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'downloader')

// The venv is created by the Task Runner task (under the task-runner home
// volume); YTMUSIC_PYTHON lets that task point at it without hardcoding a path
// into the image.
export function pythonFor(downloaderDir = DOWNLOADER_DIR) {
  const override = String(process.env.YTMUSIC_PYTHON ?? '').trim()
  if (override) return override
  const venv = path.join(downloaderDir, '..', 'venv', 'bin', 'python')
  return fs.existsSync(venv) ? venv : 'python3'
}

export function buildSteps(config, downloaderDir = DOWNLOADER_DIR, workDir = downloaderDir) {
  const python = pythonFor(downloaderDir)
  return [
    { file: python, args: [path.join(downloaderDir, 'ytmusic_dl.py'), '--dir', config.musicDir], cwd: workDir },
    { file: 'bash', args: [path.join(downloaderDir, 'validate_m3u8s.sh'), config.musicDir], cwd: workDir },
  ]
}

// ytmusicapi reads browser.json relative to the process working directory;
// write it fresh for every run (0600) into the work dir so rotated headers
// take effect immediately.
export async function writeBrowserJson(contents, workDir) {
  const text = String(contents ?? '').trim()
  if (!text) {
    throw new Error('browser headers are not configured — set secrets/ytmusic-browser.json')
  }
  try {
    JSON.parse(text)
  } catch (err) {
    throw new Error(`browser headers are not valid JSON: ${err.message}`, { cause: err })
  }
  await fsp.mkdir(workDir, { recursive: true })
  const file = path.join(workDir, 'browser.json')
  await fsp.writeFile(file, text, { mode: 0o600 })
  return file
}

export async function browserContents(config, browserFile = null) {
  if (browserFile) return fsp.readFile(browserFile, 'utf8')
  return config.browserJson ?? ''
}

export function summarizeDownload(text, cfg = {}) {
  const downloaded = /Downloaded (\d+) new tracks?/.exec(text ?? '')
  if (!downloaded) return `Downloaded into ${cfg.musicDir ?? 'the music directory'}`
  const count = Number(downloaded[1])
  const parts = [count === 0 ? 'No new tracks' : `Downloaded ${count} new track${count === 1 ? '' : 's'}`]
  const unsorted = /Number of unsorted songs was \d+, is now (\d+)/.exec(text ?? '')
  if (unsorted) parts.push(`${Number(unsorted[1])} unsorted`)
  return parts.join(' · ')
}

// Run both steps, streaming their output to the task log, and return the
// captured text so the summary can include the downloader/validator counters.
export async function runYtmusic({ config, dataDir = null, browserFile = null, downloaderDir = DOWNLOADER_DIR, log = console.log }) {
  const workDir = path.join(dataDir ?? process.env.DSCPLN_DATA_DIR ?? os.tmpdir(), 'work')
  log(`Using browser headers: ${browserFile || 'config.browserJson'}`)
  await writeBrowserJson(await browserContents(config, browserFile), workDir)
  log(`Downloading into ${config.musicDir}`)

  const captured = []
  for (const step of buildSteps(config, downloaderDir, workDir)) {
    const result = spawnSync(step.file, step.args, {
      cwd: step.cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    captured.push(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`${path.basename(step.file)} failed (exit ${result.status ?? 'signal'})`)
    }
  }

  const summary = summarizeDownload(captured.join('\n'), config)
  console.log(summary)
  return { summary, text: captured.join('\n') }
}

// Validate the stored headers by asking ytmusicapi for one library playlist.
export async function testAuth({ browserFile = null, browserJson = '', downloaderDir = DOWNLOADER_DIR }) {
  const contents = browserFile ? await fsp.readFile(browserFile, 'utf8') : String(browserJson ?? '')
  if (!contents.trim()) throw new Error('browser headers are not configured')
  JSON.parse(contents)
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ytmusic-auth-'))
  const file = path.join(tmpDir, 'browser.json')
  await fsp.writeFile(file, contents, { mode: 0o600 })
  try {
    const { stdout } = await execFileAsync(
      pythonFor(downloaderDir),
      ['-c', `from ytmusicapi import YTMusic; m = YTMusic(${JSON.stringify(file)}); print(len(m.get_library_playlists(limit=1)))`],
      { cwd: downloaderDir, timeout: 60_000, env: { ...process.env, PYTHONWARNINGS: 'ignore' } },
    )
    return { playlists: Number.parseInt(stdout.trim(), 10) || 0 }
  } catch (err) {
    const detail = `${err.stderr ?? ''}${err.stdout ?? ''}`.trim() || err.message
    throw new Error(`auth test failed: ${detail.split('\n').slice(-3).join(' ')}`, { cause: err })
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`
if (isMain) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      'browser-file': { type: 'string' },
      'data-dir': { type: 'string' },
      test: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help || !values.config) {
    console.log('usage: node run.mjs --config <config.json> [--browser-file <json>] [--data-dir <dir>] [--test]')
    process.exit(values.help ? 0 : 2)
  }
  try {
    const config = JSON.parse(await fsp.readFile(values.config, 'utf8'))
    if (values.test) {
      const result = await testAuth({
        browserFile: values['browser-file'],
        browserJson: config.browserJson,
        downloaderDir: DOWNLOADER_DIR,
      })
      console.log(`Auth OK — ${result.playlists} playlist(s) visible.`)
    } else {
      await runYtmusic({
        config,
        dataDir: values['data-dir'] ?? null,
        browserFile: values['browser-file'] ?? null,
        downloaderDir: DOWNLOADER_DIR,
      })
    }
  } catch (err) {
    console.error(`YTMusic failed: ${err.message}`)
    process.exit(1)
  }
}
