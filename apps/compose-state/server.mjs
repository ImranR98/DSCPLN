#!/usr/bin/env node
// Infra Compose State — scheduled backups of the compose runtime state on srv0
// (locally) and vps0 (over SSH). The app generates its own SSH key on first
// boot; the public key is shown in the UI to authorize on vps0.

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expandPath, scheduledApp, specValid, ValidationError } from '@dscpln/server-kit'

const APP_DIR = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

export const DEFAULT_CONFIG = {
  targets: [
    { name: 'srv0', mode: 'local', host: '', user: '', path: '~/Main/Infra/current_target/compose_live_state' },
    { name: 'vps0', mode: 'ssh', host: 'vps0.example.com', user: 'root', path: '/root/Infra/current_target/compose_live_state' },
  ],
  destination: '~/Main/Infra/compose_state_backups',
  retention: 1,
  sshPrivateKey: '',
  sshPublicKey: '',
  ntfy: { url: '', token: '', notifySuccess: false },
  schedule: { enabled: true, days: [0], at: '04:00', catchUp: true },
}

export function normalizeConfig(raw) {
  const cfg = {
    ...raw,
    targets: Array.isArray(raw.targets) ? raw.targets : [],
    retention: Math.max(1, Math.floor(Number(raw.retention ?? 1) || 1)),
    ntfy: { url: '', token: '', notifySuccess: false, ...(raw.ntfy ?? {}) },
    schedule: { enabled: true, days: [], at: '04:00', catchUp: true, ...(raw.schedule ?? {}) },
  }
  cfg.destination = expandPath(cfg.destination)
  return cfg
}

export function validateConfig(cfg) {
  if (!cfg.destination) throw new ValidationError('destination is required')
  if (!Array.isArray(cfg.targets) || cfg.targets.length === 0) {
    throw new ValidationError('at least one target is required')
  }
  const seen = new Set()
  for (const target of cfg.targets) {
    if (!target?.name) throw new ValidationError('every target needs a name')
    if (!/^[A-Za-z0-9._-]+$/.test(target.name)) {
      throw new ValidationError(`target ${target.name}: names may only contain letters, numbers, dot, dash and underscore`)
    }
    if (seen.has(target.name)) throw new ValidationError(`duplicate target name: ${target.name}`)
    seen.add(target.name)
    if (!target.path) throw new ValidationError(`target ${target.name}: a path is required`)
    if (target.mode === 'ssh' && !target.host) throw new ValidationError(`target ${target.name}: ssh targets need a host`)
    if (target.mode !== 'local' && target.mode !== 'ssh') throw new ValidationError(`target ${target.name}: mode must be local or ssh`)
  }
  if (!Number.isFinite(Number(cfg.retention)) || Number(cfg.retention) < 1) {
    throw new ValidationError('retention must be at least 1')
  }
  if (!specValid(cfg.schedule)) throw new ValidationError('schedule needs a valid time (HH:MM)')
}

export async function generateSshKey() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dscpln-compose-key-'))
  const file = path.join(dir, 'id_ed25519')
  try {
    await execFileAsync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'dscpln-compose', '-f', file])
    const sshPrivateKey = await fsp.readFile(file, 'utf8')
    const sshPublicKey = (await fsp.readFile(`${file}.pub`, 'utf8')).trim()
    return { sshPrivateKey: sshPrivateKey.trim(), sshPublicKey }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

export function createComposeApp(options = {}) {
  const dataDir = options.dataDir ?? process.env.DSCPLN_DATA_DIR ?? '/data'
  const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
  const commands = options.commands ?? (() => [
    [process.execPath, path.join(APP_DIR, 'run.mjs'), '--config', path.join(dataDir, 'config.json'), '--data-dir', dataDir],
  ])

  const created = scheduledApp({
    name: 'Infra Compose State',
    dataDir,
    basePath,
    staticDir: path.join(APP_DIR, 'static'),
    defaults: DEFAULT_CONFIG,
    normalize: normalizeConfig,
    validate: validateConfig,
    secrets: ['sshPrivateKey'],
    commands: (cfg) => commands(cfg),
    summarize: (result, cfg) => `Backed up ${cfg.targets.length} target(s)`,
    routes: (router, ctx) => {
      // Shows/regenerates the app's SSH public key (authorize it on vps0).
      router.post('/api/key/regenerate', async (req, res, next) => {
        try {
          const key = await generateSshKey()
          await ctx.config.update(key)
          res.json({ sshPublicKey: key.sshPublicKey })
        } catch (err) {
          next(err)
        }
      })

      // Archive listing for the UI (name, target, size, mtime).
      router.get('/api/archives', async (req, res, next) => {
        try {
          const cfg = ctx.config.get()
          const destination = expandPath(cfg.destination)
          let names = []
          try {
            names = await fsp.readdir(destination)
          } catch {
            names = []
          }
          const entries = []
          for (const name of names.filter((n) => n.endsWith('.tar'))) {
            const stat = await fsp.stat(path.join(destination, name)).catch(() => null)
            if (!stat) continue
            const target = cfg.targets.find((t) => name.startsWith(`${t.name}-backup-`))?.name ?? name.split('-backup-')[0]
            entries.push({ name, target, size: stat.size, mtime: stat.mtimeMs })
          }
          entries.sort((a, b) => b.name.localeCompare(a.name))
          res.json({ destination, entries })
        } catch (err) {
          next(err)
        }
      })
    },
    onStart: async ({ config }) => {
      // Generate the SSH key on first boot so the vps0 target is actionable.
      if (!config.get().sshPrivateKey) {
        const key = await generateSshKey()
        await config.update(key)
        console.log('Generated a new SSH key (authorize the public key on vps0).')
      }
    },
  })

  return created
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const app = createComposeApp()
  await app.start()
  app.app.listen(app.port, app.host, () => {
    console.log(`D$CPLN Infra Compose State listening on http://${app.host}:${app.port}${process.env.BASE_PATH ?? ''}`)
  })
}
