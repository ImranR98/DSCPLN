// Compose-state backup logic: tar the runtime state of each configured target
// (on this host or on a remote host over SSH), then apply per-target retention.
// child of the app's Runner so its output streams into the live log.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { expandPath } from '@dscpln/server-kit'

export const ARCHIVE_STAMP = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

// Target names only ever produce file names (validation enforces the same
// charset); sanitizing here keeps a hand-edited config from escaping the
// destination directory.
export const safeTargetName = (name) =>
  String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '') || 'target'

export const archiveNameFor = (target, stamp) => `${safeTargetName(target.name)}-backup-${stamp}.tar`

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

// The existing compose-backup.sh semantics: include files, dirs and symlinks;
// tolerate files that change or vanish mid-stream (live app state).
export const findTarPipeline = () =>
  'find . \\( -type f -o -type d -o -type l \\) -print0 | ' +
  'tar cf - --null -T - --sparse --ignore-failed-read --warning=no-file-changed --warning=no-file-removed'

// tar exits 1 when a live file changed mid-stream (the archive is still
// valid); exit codes above 1 are real failures.
export const TOLERATE_TAR_RC =
  'rc=$?; if [ "$rc" -gt 1 ]; then exit "$rc"; fi; ' +
  '[ "$rc" -eq 1 ] && echo "Note: some live files changed during the backup; the archive was still written" >&2; exit 0'

export function backupShellCommand(target, { keyFile = null, knownHostsFile = null, destFile }) {
  const body = `cd ${quote(expandPath(target.path))} && { ${findTarPipeline()}; ${TOLERATE_TAR_RC}; }`
  if (target.mode === 'ssh') {
    if (!keyFile) throw new Error(`target ${target.name}: ssh targets need an ssh key`)
    const host = `${target.user ? `${target.user}@` : ''}${target.host}`
    const options = [
      '-i', quote(keyFile),
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=15',
      '-o', 'StrictHostKeyChecking=accept-new',
      ...(knownHostsFile ? ['-o', `UserKnownHostsFile=${knownHostsFile}`] : []),
    ].join(' ')
    return `ssh ${options} ${quote(host)} ${quote(body)} > ${quote(destFile)}`
  }
  return `${body} > ${quote(destFile)}`
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
      throw new Error('an SSH key is required for SSH targets — generate one in the app settings and authorize it on the target host')
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
      for (const name of selectExpired(files, Number(config.retention ?? 1), keep, `${safeTargetName(target.name)}-backup-`)) {
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
