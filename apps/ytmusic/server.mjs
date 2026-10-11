#!/usr/bin/env node
// YTMusic Downloads — scheduled YouTube Music library downloads using the
// absorbed YTMusicDL downloader (apps/ytmusic/downloader). Auth is a pasted
// ytmusicapi browser.json stored on the app's PVC.

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expandPath, resolveSecret, scheduledApp, specValid, ValidationError } from '@dscpln/server-kit'
import { DOWNLOADER_DIR, pythonFor } from './run.mjs'

const APP_DIR = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

export const DEFAULT_CONFIG = {
  musicDir: '~/Main/Media/Music',
  browserJson: '',
  ntfy: { url: '', token: '', notifySuccess: false },
  schedule: { enabled: true, days: [], at: '05:00', catchUp: true },
}

export function normalizeConfig(raw) {
  const cfg = {
    ...raw,
    ntfy: { url: '', token: '', notifySuccess: false, ...(raw.ntfy ?? {}) },
    schedule: { enabled: true, days: [], at: '05:00', catchUp: true, ...(raw.schedule ?? {}) },
  }
  cfg.musicDir = expandPath(cfg.musicDir)
  return cfg
}

export function validateConfig(cfg) {
  if (!cfg.musicDir) throw new ValidationError('musicDir is required')
  if (!specValid(cfg.schedule)) throw new ValidationError('schedule needs a valid time (HH:MM)')
  if (cfg.browserJson) {
    try {
      JSON.parse(cfg.browserJson)
    } catch (err) {
      throw new ValidationError(`browserJson is not valid JSON: ${err.message}`)
    }
  }
}

// Writes the pasted headers to a temp file and asks ytmusicapi to fetch one
// playlist — the clearest signal that the headers are still valid.
export async function defaultTestAuth({ browserJson, downloaderDir = DOWNLOADER_DIR }) {
  const contents = String(browserJson ?? '').trim()
  if (!contents) throw new Error('paste browser.json contents first')
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
    throw new Error(`auth test failed: ${detail.split('\n').slice(-3).join(' ')}`)
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
}

export function createYtmusicApp(options = {}) {
  const dataDir = options.dataDir ?? process.env.DSCPLN_DATA_DIR ?? '/data'
  const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
  const commands = options.commands ?? (() => [
    [process.execPath, path.join(APP_DIR, 'run.mjs'), '--config', path.join(dataDir, 'config.json'), '--data-dir', dataDir],
  ])
  const testAuth = options.testAuth ?? defaultTestAuth

  return scheduledApp({
    name: 'YTMusic Downloads',
    dataDir,
    basePath,
    staticDir: path.join(APP_DIR, 'static'),
    defaults: DEFAULT_CONFIG,
    normalize: normalizeConfig,
    validate: validateConfig,
    secrets: ['browserJson'],
    commands: (cfg) => commands(cfg),
    summarize: (result, cfg) => `Downloaded into ${cfg.musicDir}`,
    routes: (router, ctx) => {
      router.post('/api/test-auth', async (req, res, next) => {
        try {
          const cfg = ctx.config.get() ?? {}
          const result = await testAuth({
            browserJson: resolveSecret(req.body?.browserJson, cfg.browserJson),
            downloaderDir: DOWNLOADER_DIR,
          })
          res.json({ ok: true, ...result })
        } catch (err) {
          err.statusCode = 502
          next(err)
        }
      })
    },
  })
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const app = createYtmusicApp()
  await app.start()
  app.app.listen(app.port, app.host, () => {
    console.log(`D$CPLN YTMusic Downloads listening on http://${app.host}:${app.port}${process.env.BASE_PATH ?? ''}`)
  })
}
