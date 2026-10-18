#!/usr/bin/env node
// State Backups — scheduled restic backups of the K3s app PVCs and the
// srv0/vps0 Compose runtime state. The app is intentionally backup-only;
// restoring is a separate operator command in the Infra repo.

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expandPath, scheduledApp, specValid, ValidationError } from '@dscpln/server-kit'
import { DEFAULT_RESTIC_PASSWORD, resticEnv } from './backup.mjs'

const APP_DIR = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

export const DEFAULT_TARGETS = [
  {
    name: 'srv0',
    mode: 'local',
    host: '',
    user: '',
    path: '/home/imranr/Main/Infra/current_target/compose_live_state',
  },
  {
    name: 'vps0',
    mode: 'ssh',
    host: 'vps0.imranr.dev',
    user: 'root',
    path: '/root/Infra/current_target/compose_live_state',
  },
]

export const DEFAULT_CONFIG = {
  targets: DEFAULT_TARGETS,
  destination: '/home/imranr/Main/Infra/state_backups/restic',
  appDataRoot: '/home/imranr/Main/Infra/current_target/k3s_live_state/nfs-apps',
  appDataLabel: 'auto-backup=true',
  retention: 7,
  resticPassword: DEFAULT_RESTIC_PASSWORD,
  sshPrivateKey: '',
  sshPublicKey: '',
  notifySuccess: true,
  schedule: { enabled: true, days: [0], at: '04:00', catchUp: true },
}

export function normalizeConfig(raw) {
  const cfg = {
    ...raw,
    targets: Array.isArray(raw.targets) ? raw.targets : [],
    retention: Math.max(1, Math.floor(Number(raw.retention ?? 7) || 7)),
    resticPassword: String(raw.resticPassword || DEFAULT_RESTIC_PASSWORD),
    notifySuccess: Boolean(raw.notifySuccess ?? true),
    schedule: { enabled: true, days: [], at: '04:00', catchUp: true, ...(raw.schedule ?? {}) },
  }
  cfg.destination = expandPath(cfg.destination)
  cfg.appDataRoot = expandPath(cfg.appDataRoot)
  return cfg
}

export function validateConfig(cfg) {
  if (!cfg.destination) throw new ValidationError('destination is required')
  if (!cfg.appDataRoot) throw new ValidationError('app data root is required')
  if (!Array.isArray(cfg.targets)) throw new ValidationError('targets must be a list')
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
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dscpln-state-backup-key-'))
  const file = path.join(dir, 'id_ed25519')
  try {
    await execFileAsync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'dscpln-state-backup', '-f', file])
    const sshPrivateKey = await fsp.readFile(file, 'utf8')
    const sshPublicKey = (await fsp.readFile(`${file}.pub`, 'utf8')).trim()
    return { sshPrivateKey: sshPrivateKey.trim(), sshPublicKey }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

export function summarizeBackup(result, cfg) {
  return `Backed up app data and ${(cfg.targets ?? []).length} compose target(s) to ${cfg.destination}`
}

export function createStateBackupApp(options = {}) {
  const dataDir = options.dataDir ?? process.env.DSCPLN_DATA_DIR ?? '/data'
  const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
  const commands = options.commands ?? (() => [
    [process.execPath, path.join(APP_DIR, 'run.mjs'), '--config', path.join(dataDir, 'config.json'), '--data-dir', dataDir],
  ])

  const created = scheduledApp({
    name: 'State Backups',
    dataDir,
    basePath,
    staticDir: path.join(APP_DIR, 'static'),
    defaults: DEFAULT_CONFIG,
    normalize: normalizeConfig,
    validate: validateConfig,
    secrets: ['sshPrivateKey', 'resticPassword'],
    commands: (cfg) => commands(cfg),
    summarize: summarizeBackup,
    routes: (router, ctx) => {
      // The deployment mounts the existing vps0 key as a Secret. Only fall
      // back to generating a key when no mounted key exists.
      router.post('/api/key/regenerate', async (req, res, next) => {
        try {
          if (process.env.SSH_KEY_FILE) {
            return res.status(400).json({ error: 'the SSH key is mounted from the deployment Secret' })
          }
          const key = await generateSshKey()
          await ctx.config.update(key)
          res.json({ sshPublicKey: key.sshPublicKey })
        } catch (err) {
          next(err)
        }
      })

      // Snapshot listing for the UI.
      router.get('/api/snapshots', async (req, res, next) => {
        try {
          const cfg = ctx.config.get()
          const env = resticEnv(cfg, dataDir)
          const { stdout } = await execFileAsync(
            'restic',
            ['snapshots', '--json'],
            { env, maxBuffer: 16 * 1024 * 1024 },
          )
          const entries = JSON.parse(stdout || '[]').map((snapshot) => ({
            id: snapshot.short_id ?? snapshot.id,
            time: snapshot.time,
            hostname: snapshot.hostname,
            paths: snapshot.paths ?? [],
            tags: snapshot.tags ?? [],
            size: snapshot.summary?.total_bytes_processed ?? null,
          })).sort((a, b) => String(b.time).localeCompare(String(a.time)))
          res.json({ repository: cfg.destination, entries })
        } catch (err) {
          next(err)
        }
      })
    },
    onStart: async ({ config }) => {
      if (process.env.SSH_PUBLIC_KEY_FILE) {
        try {
          const sshPublicKey = (await fsp.readFile(process.env.SSH_PUBLIC_KEY_FILE, 'utf8')).trim()
          if (sshPublicKey && sshPublicKey !== config.get().sshPublicKey) {
            await config.update({ sshPublicKey })
          }
        } catch (err) {
          console.warn(`Could not read SSH_PUBLIC_KEY_FILE: ${err.message}`)
        }
        return
      }
      if (!config.get().sshPrivateKey) {
        const key = await generateSshKey()
        await config.update(key)
        console.log('Generated a new SSH key (authorize the public key on the target host).')
      }
    },
  })

  return created
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const app = createStateBackupApp()
  await app.start()
  app.app.listen(app.port, app.host, () => {
    console.log(`D$CPLN State Backups listening on http://${app.host}:${app.port}${process.env.BASE_PATH ?? ''}`)
  })
}
