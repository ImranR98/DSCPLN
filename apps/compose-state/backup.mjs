// Compose-state backup logic: tar the runtime state of each configured target
// (srv0 locally, vps0 over SSH), then apply per-target retention. Runs as a
// child of the app's Runner so its output streams into the live log.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { expandPath } from '@dscpln/server-kit'

export const ARCHIVE_STAMP = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export const archiveNameFor = (target, stamp) => `${target.name}-backup-${stamp}.tar`

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

// The existing compose-backup.sh semantics: include files, dirs and symlinks;
// tolerate files that change or vanish mid-stream.
export const findTarPipeline = (dir) =>
  `cd ${quote(dir)} && find . \\( -type f -o -type d -o -type l \\) -print0 | ` +
  'tar cf - --null -T - --sparse --ignore-failed-read --warning=no-file-changed --warning=no-file-removed'

export function backupShellCommand(target, { keyFile = null, knownHostsFile = null, destFile }) {
  const pipeline = findTarPipeline(expandPath(target.path))
  if (target.mode === 'ssh') {
    if (!keyFile) throw new Error(`target ${target.name}: ssh targets need an ssh key`)
    const host = `${target.user ? `${target.user}@` : ''}${target.host}`
    const options = [
      '-i', quote(keyFile),
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      ...(knownHostsFile ? ['-o', `UserKnownHostsFile=${knownHostsFile}`] : []),
    ].join(' ')
    return `set -o pipefail; ssh ${options} ${quote(host)} ${quote(pipeline)} > ${quote(destFile)}`
  }
  return `set -o pipefail; ${pipeline} > ${quote(destFile)}`
}

// Deletes every archive for one target except the newest `retention` ones.
// Returns the removed names. `keep` guards the archive just written (even if
// its mtime ties with an older one).
export function selectExpired(files, retention, keep, prefix) {
  const matching = files.filter((name) => name.startsWith(prefix) && name.endsWith('.tar'))
  if (retention < 1) return []
  const sorted = [...matching].sort()
  const remove = []
  for (const name of sorted.slice(0, Math.max(0, sorted.length - retention))) {
    if (name === keep) continue
    remove.push(name)
  }
  return remove
}

export async function runBackup({ config, dataDir, log = console.log, stamp = ARCHIVE_STAMP() }) {
  const destination = expandPath(config.destination)
  await fsp.mkdir(destination, { recursive: true })

  let keyFile = null
  const cleanup = []
  if (config.targets.some((target) => target.mode === 'ssh')) {
    if (!config.sshPrivateKey) {
      throw new Error('an SSH key is required for the vps0 target — generate one in the app settings and authorize it on vps0')
    }
    keyFile = path.join(dataDir, '.ssh-key.tmp')
    await fsp.mkdir(dataDir, { recursive: true })
    await fsp.writeFile(keyFile, `${config.sshPrivateKey.trim()}\n`, { mode: 0o600 })
    cleanup.push(() => fsp.rm(keyFile, { force: true }))
  }

  const written = []
  try {
    for (const target of config.targets) {
      if (!target.name || !target.path) throw new Error('every target needs a name and a path')
      const name = archiveNameFor(target, stamp)
      const final = path.join(destination, name)
      const part = path.join(destination, `.${name}.part`)
      log(`Backing up ${target.name} (${target.mode}) → ${name}`)
      const command = backupShellCommand(target, {
        keyFile,
        knownHostsFile: path.join(dataDir, 'known_hosts'),
        destFile: part,
      })
      try {
        execFileSync('bash', ['-c', command], { stdio: ['ignore', 'inherit', 'inherit'] })
        const stat = await fsp.stat(part)
        if (stat.size === 0) throw new Error('the archive is empty')
        await fsp.rename(part, final)
        log(`  wrote ${stat.size} bytes`)
        written.push({ target: target.name, name, size: stat.size })
      } catch (err) {
        await fsp.rm(part, { force: true }).catch(() => {})
        throw new Error(`${target.name}: ${err.message}`)
      }
    }

    // Retention per target, only after every archive succeeded.
    for (const target of config.targets) {
      const files = await fsp.readdir(destination)
      const keep = archiveNameFor(target, stamp)
      for (const name of selectExpired(files, Number(config.retention ?? 1), keep, `${target.name}-backup-`)) {
        await fsp.rm(path.join(destination, name), { force: true })
        log(`Removed old archive ${name} (retention ${config.retention})`)
      }
    }
  } finally {
    for (const fn of cleanup) await fn()
  }

  log(`Backed up ${written.length} target(s) to ${destination}`)
  return written
}
