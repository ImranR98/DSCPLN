import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensureRepoOwnership } from '../backup.mjs'

test('ensureRepoOwnership makes the repository root group-owned and setgid', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-backup-repo-'))
  const repo = path.join(root, 'restic')

  try {
    ensureRepoOwnership(repo, () => {}, process.getgid())
    const stat = fs.statSync(repo)
    assert.equal(stat.gid, process.getgid())
    assert.ok(stat.mode & 0o2000, 'setgid bit is set')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
