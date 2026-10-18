// restic backup logic for the State Backups app.
//
// One run captures:
//   * every PVC labelled `auto-backup=true` from the NFS app-data host path
//   * the configured local/SSH Compose state targets
// into a single encrypted restic repository. A Syncthing-replicated copy of the
// repository is handled by the deployment, not by this module.

import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { expandPath } from '@dscpln/server-kit'

// Deliberately hardcoded default. The UI can override it with a write-only
// secret; leave the field blank to keep using this value.
export const DEFAULT_RESTIC_PASSWORD = 'dscpln-state-backups-default-2026'

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

export const safeTargetName = (name) =>
  String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '') || 'target'

export const resticEnv = (config, dataDir) => ({
  ...process.env,
  RESTIC_REPOSITORY: expandPath(config.destination),
  RESTIC_PASSWORD: String(config.resticPassword || DEFAULT_RESTIC_PASSWORD),
  RESTIC_CACHE_DIR: path.join(dataDir, 'restic-cache'),
})

function run(cmd, args, options = {}) {
  const { inherit = false, ...rest } = options
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    ...rest,
  })
}

function ensureRepository(config, dataDir, log) {
  const repo = expandPath(config.destination)
  fs.mkdirSync(repo, { recursive: true })
  const env = resticEnv(config, dataDir)
  if (!fs.existsSync(path.join(repo, 'config'))) {
    log(`Initializing restic repository at ${repo}`)
    run('restic', ['init'], { env, inherit: true })
    return
  }
  try {
    run('restic', ['cat', 'config'], { env })
  } catch (err) {
    throw new Error(
      `the restic repository at ${repo} cannot be opened with the configured password; ` +
        `restore the correct password or initialize a new repository`,
      { cause: err },
    )
  }
}

function collectAppData(config, log) {
  const root = expandPath(config.appDataRoot)
  if (!config.appDataRoot || !fs.existsSync(root)) {
    log(`App-data root not found: ${root}`)
    return { paths: [], excludes: [] }
  }

  let raw
  try {
    raw = run('kubectl', ['get', 'pvc', '-A', '-l', config.appDataLabel || 'auto-backup=true', '-o', 'json'])
  } catch (err) {
    throw new Error(`could not list auto-backup PVCs with kubectl: ${err.message}`, { cause: err })
  }

  const paths = []
  const excludes = []
  for (const pvc of JSON.parse(raw).items ?? []) {
    const ns = pvc.metadata?.namespace
    const name = pvc.metadata?.name
    if (!ns || !name) continue
    const pvcPath = path.join(root, ns, name)
    if (!fs.existsSync(pvcPath)) {
      log(`Skipping ${ns}/${name}: ${pvcPath} does not exist`)
      continue
    }
    paths.push(pvcPath)
    const patterns = String(pvc.metadata?.annotations?.['backup.infra/exclude'] ?? '').trim()
    for (const pattern of patterns.split(/\s+/).filter(Boolean)) {
      excludes.push(path.join(pvcPath, pattern))
    }
  }

  log(`App data: ${paths.length} PVC(s) under ${root}`)
  return { paths, excludes }
}

function sshCommand(keyFile, knownHostsFile) {
  return [
    'ssh',
    '-i', quote(keyFile),
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHostsFile}`,
  ].join(' ')
}

function fetchComposeTarget(target, { keyFile, knownHostsFile, staging, log }) {
  const destination = path.join(staging, safeTargetName(target.name))
  fs.mkdirSync(destination, { recursive: true })
  const remote = `${target.user ? `${target.user}@` : ''}${target.host}`
  log(`Fetching compose state from ${target.name} (${target.mode})`)
  try {
    run(
      'rsync',
      ['-a', '--delete', '-e', sshCommand(keyFile, knownHostsFile), `${remote}:${target.path}/`, `${destination}/`],
      { inherit: true },
    )
  } catch (err) {
    // rsync 24 means files vanished while it was reading live state (for
    // example ClickHouse merging parts). The copy is still usable; the old
    // compose-state tar accepted the equivalent condition.
    if (err.status === 24) {
      log('rsync noted vanished live files (exit 24); the staged copy is usable')
    } else {
      throw err
    }
  }
  return destination
}

export async function runBackup({ config, dataDir, log = console.log }) {
  const password = String(config.resticPassword || DEFAULT_RESTIC_PASSWORD)
  const repo = expandPath(config.destination)
  ensureRepository(config, dataDir, log)

  const stagingRoot = process.env.RESTIC_STAGING_DIR || dataDir
  // Stable path so the restic snapshot has a predictable vps0 source path
  // for the manual restore script.
  const staging = path.join(stagingRoot, 'compose')
  await fsp.mkdir(staging, { recursive: true })
  const keyFile = path.join(dataDir, '.ssh-key.tmp')
  const filesFrom = path.join(dataDir, '.restic-files')
  const knownHostsFile = path.join(dataDir, 'known_hosts')
  const cleanup = []

  try {
    if (process.env.SSH_KEY_FILE) {
      if (!fs.existsSync(process.env.SSH_KEY_FILE)) {
        throw new Error(`SSH_KEY_FILE does not exist: ${process.env.SSH_KEY_FILE}`)
      }
    } else if (config.targets.some((target) => target.mode === 'ssh')) {
      if (!config.sshPrivateKey) {
        throw new Error('an SSH key is required for SSH targets — mount the vps0 key or set sshPrivateKey in Settings')
      }
      await fsp.writeFile(keyFile, `${config.sshPrivateKey.trim()}\n`, { mode: 0o600 })
      cleanup.push(() => fsp.rm(keyFile, { force: true }))
    }

    const appData = collectAppData(config, log)
    const paths = [...appData.paths]
    const excludes = [...appData.excludes]

    for (const target of config.targets) {
      if (!target.name || !target.path) throw new Error('every target needs a name and a path')
      if (target.mode === 'local') {
        const targetPath = expandPath(target.path)
        if (!fs.existsSync(targetPath)) {
          log(`Skipping compose target ${target.name}: ${targetPath} does not exist`)
          continue
        }
        paths.push(targetPath)
      } else if (target.mode === 'ssh') {
        paths.push(
          fetchComposeTarget(target, {
            keyFile: process.env.SSH_KEY_FILE || keyFile,
            knownHostsFile,
            staging,
            log,
          }),
        )
      } else {
        throw new Error(`target ${target.name}: mode must be local or ssh`)
      }
    }

    if (!paths.length) throw new Error('nothing to back up')
    await fsp.writeFile(filesFrom, `${paths.join('\n')}\n`, { mode: 0o600 })

    const env = resticEnv(config, dataDir)
    const args = ['backup', '--files-from', filesFrom, '--host', os.hostname(), '--tag', 'dscpln-state-backup']
    for (const pattern of excludes) args.push('--exclude', pattern)
    log(`Wrote ${paths.length} path(s) to ${repo}`)
    run('restic', args, { env, inherit: true })

    const keep = Math.max(1, Math.floor(Number(config.retention ?? 7) || 7))
    log(`Applying retention: keep last ${keep} snapshot(s)`)
    run('restic', ['forget', '--keep-last', String(keep), '--prune'], { env, inherit: true })

    log('Checking repository integrity (1% sample)')
    run('restic', ['check', '--read-data-subset=1%'], { env, inherit: true })

    const snapshots = JSON.parse(run('restic', ['snapshots', '--json', '--latest', '1'], { env }))
    const latest = snapshots[snapshots.length - 1]
    return { repo, snapshot: latest?.short_id ?? null, paths, passwordUsed: Boolean(password) }
  } finally {
    for (const fn of cleanup) await fn()
    await fsp.rm(staging, { recursive: true, force: true })
    await fsp.rm(filesFrom, { force: true })
  }
}
