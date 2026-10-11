#!/usr/bin/env node
// Runs the YouTube Music downloader + playlist validation. Invoked by the
// app's Runner so output streams into the live log.
//
//   node run.mjs --config /data/config.json --data-dir /data

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const DOWNLOADER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'downloader')

// The venv lives next to the downloader in the container (created at build
// time); local development falls back to the system Python.
export function pythonFor(downloaderDir) {
  const venv = path.join(downloaderDir, '..', 'venv', 'bin', 'python')
  return fs.existsSync(venv) ? venv : 'python3'
}

export function buildSteps(config, downloaderDir = DOWNLOADER_DIR) {
  const python = pythonFor(downloaderDir)
  return [
    { file: python, args: ['ytmusic_dl.py', '--dir', config.musicDir], cwd: downloaderDir },
    { file: 'bash', args: ['validate_m3u8s.sh', config.musicDir], cwd: downloaderDir },
  ]
}

// ytmusicapi reads browser.json from the process working directory; write it
// fresh for every run (0600) so rotated headers take effect immediately.
export async function writeBrowserJson(config, downloaderDir = DOWNLOADER_DIR) {
  const contents = String(config.browserJson ?? '').trim()
  if (!contents) {
    throw new Error('browser.json is not configured — paste fresh browser headers in Settings')
  }
  try {
    JSON.parse(contents)
  } catch (err) {
    throw new Error(`browser.json is not valid JSON: ${err.message}`)
  }
  const file = path.join(downloaderDir, 'browser.json')
  await fsp.writeFile(file, contents, { mode: 0o600 })
  return file
}

export async function runYtmusic({ config, log = console.log, downloaderDir = DOWNLOADER_DIR }) {
  await writeBrowserJson(config, downloaderDir)
  const musicDir = config.musicDir
  log(`Downloading into ${musicDir}`)
  for (const step of buildSteps(config, downloaderDir)) {
    execFileSync(step.file, step.args, { cwd: step.cwd, stdio: ['ignore', 'inherit', 'inherit'] })
  }
  log('Download and playlist validation finished.')
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`
if (isMain) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      'data-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help || !values.config) {
    console.log('usage: node run.mjs --config <config.json> [--data-dir <dir>]')
    process.exit(values.help ? 0 : 2)
  }
  const config = JSON.parse(await fsp.readFile(values.config, 'utf8'))
  try {
    await runYtmusic({ config })
  } catch (err) {
    console.error(`Download failed: ${err.message}`)
    process.exit(1)
  }
}
