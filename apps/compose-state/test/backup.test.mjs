import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { backupShellCommand, runBackup, safeTargetName, selectExpired } from '../backup.mjs'

test('selectExpired keeps the newest N and never deletes the just-written file', () => {
  const files = [
    'srv0-backup-20260101_000000.tar',
    'srv0-backup-20260201_000000.tar',
    'srv0-backup-20260301_000000.tar',
    'vps0-backup-20260101_000000.tar',
  ]
  assert.deepEqual(selectExpired(files, 1, 'srv0-backup-20260301_000000.tar', 'srv0-backup-'), [
    'srv0-backup-20260101_000000.tar',
    'srv0-backup-20260201_000000.tar',
  ])
  assert.deepEqual(selectExpired(files, 2, 'srv0-backup-20260301_000000.tar', 'srv0-backup-'), [
    'srv0-backup-20260101_000000.tar',
  ])
  assert.deepEqual(selectExpired(files, 1, 'srv0-backup-20260101_000000.tar', 'srv0-backup-'), [
    'srv0-backup-20260201_000000.tar',
  ], 'the keep file is protected even when sorting puts it first')
})

test('local backups tar the directory and apply retention', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'))
  const source = path.join(root, 'compose_live_state')
  const destination = path.join(root, 'backups')
  fs.mkdirSync(path.join(source, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(source, 'one.txt'), 'one')
  fs.writeFileSync(path.join(source, 'sub', 'two.txt'), 'two')
  fs.symlinkSync('one.txt', path.join(source, 'link'))

  const config = {
    targets: [{ name: 'srv0', mode: 'local', path: source }],
    destination,
    retention: 1,
    sshPrivateKey: '',
  }
  const first = await runBackup({ config, dataDir: root, stamp: '20260101_000000', log: () => {} })
  assert.equal(first.length, 1)
  const listing = execFileSync('tar', ['-tf', path.join(destination, 'srv0-backup-20260101_000000.tar')], { encoding: 'utf8' })
  assert.match(listing, /\.\/one\.txt/)
  assert.match(listing, /\.\/sub\/two\.txt/)
  assert.match(listing, /\.\/link/)

  await runBackup({ config, dataDir: root, stamp: '20260201_000000', log: () => {} })
  const remaining = fs.readdirSync(destination).sort()
  assert.deepEqual(remaining, ['srv0-backup-20260201_000000.tar'], 'retention removed the older archive')
  fs.rmSync(root, { recursive: true, force: true })
})

test('a partial archive is deleted when the source path is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-fail-'))
  const config = {
    targets: [{ name: 'srv0', mode: 'local', path: path.join(root, 'missing') }],
    destination: path.join(root, 'backups'),
    retention: 1,
    sshPrivateKey: '',
  }
  await assert.rejects(() => runBackup({ config, dataDir: root, stamp: '20260101_000000', log: () => {} }), /Command failed|No such file/)
  const leftovers = fs.existsSync(path.join(root, 'backups')) ? fs.readdirSync(path.join(root, 'backups')) : []
  assert.deepEqual(leftovers, [], 'no .part file is left behind')
  fs.rmSync(root, { recursive: true, force: true })
})

test('ssh targets build a batch-mode ssh command with the key and known_hosts', () => {
  const command = backupShellCommand(
    { name: 'vps0', mode: 'ssh', host: 'vps0.example.com', user: 'root', path: '/root/Infra/current_target/compose_live_state' },
    { keyFile: '/data/key', knownHostsFile: '/data/known_hosts', destFile: '/dest/.vps0.tar.part' },
  )
  assert.match(command, /ssh -i '\/data\/key' -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=\/data\/known_hosts 'root@vps0\.example.com'/)
  assert.match(command, /compose_live_state/)
  assert.match(command, /find \. \\\( -type f -o -type d -o -type l \\\)/)
  assert.match(command, /> '\/dest\/\.vps0\.tar\.part'/)
  assert.match(command, /rc=\$\?; if \[ "\$rc" -gt 1 \]/)
})

test('an ssh target without a key refuses to run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-nokey-'))
  const config = {
    targets: [{ name: 'vps0', mode: 'ssh', host: 'example.com', path: '/x' }],
    destination: path.join(root, 'backups'),
    retention: 1,
    sshPrivateKey: '',
  }
  await assert.rejects(() => runBackup({ config, dataDir: root, log: () => {} }), /SSH key is required/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('target names are sanitized for archive file names', () => {
  assert.equal(safeTargetName('srv0'), 'srv0')
  assert.equal(safeTargetName('../evil'), 'evil')
  assert.equal(safeTargetName('a/b c'), 'a_b_c')
  assert.equal(safeTargetName('...'), 'target')
})
