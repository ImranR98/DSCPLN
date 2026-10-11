#!/usr/bin/env node
// Exports every enabled collection to the destination directory (atomic
// writes), then git-commits the destination. Run by the app's Runner so its
// output streams into the live log.
//
//   node export.mjs --config /data/config.json

import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { atomicWriteFile, expandPath } from '@dscpln/server-kit/atomic'
import { discoverCollections, exportCollection, normalizeBaseUrl } from './dav.mjs'

const { values } = parseArgs({
  options: { config: { type: 'string', short: 'c' }, help: { type: 'boolean', short: 'h' } },
})

if (values.help || !values.config) {
  console.log('usage: node export.mjs --config <config.json>')
  process.exit(values.help ? 0 : 2)
}

const config = JSON.parse(await fsp.readFile(values.config, 'utf8'))
const destination = expandPath(config.destination)
if (!destination) {
  console.error('destination is not configured')
  process.exit(1)
}

const safeFilename = (value, fallback) => {
  const base = path.basename(String(value ?? '').trim())
  if (!base || base.startsWith('.')) return fallback
  return base
}

const gitCommit = (dir, message) => {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'D$CPLN',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'dscpln@localhost',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? process.env.GIT_AUTHOR_NAME ?? 'D$CPLN',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? process.env.GIT_AUTHOR_EMAIL ?? 'dscpln@localhost',
  }
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env })
  if (!fs.existsSync(path.join(dir, '.git'))) run(['init', '-q'])
  run(['add', '-A', '.', ':(exclude).backup-state-*'])
  const commit = run(['commit', '-q', '-m', message])
  if (commit.status !== 0) {
    const output = `${commit.stdout ?? ''}${commit.stderr ?? ''}`
    if (/nothing to commit|nothing added to commit/.test(output)) {
      console.log('No changes to commit.')
      return
    }
    console.error(output.trim())
    throw new Error(`git commit failed (exit ${commit.status})`)
  }
  console.log('Committed the exports.')
}

const enabled = (config.collections ?? []).filter((collection) => collection.enabled && collection.href)
if (enabled.length === 0) {
  console.error('No collections are enabled — run Discover in the app and enable the ones to export.')
  process.exit(1)
}

// Validate the connection credentials up front for a clear error before any
// partial writes (unless discovery was just done with the same settings).
normalizeBaseUrl(config.nextcloudUrl)

let exported = 0
for (const collection of enabled) {
  const extension = collection.type === 'addressbook' ? 'vcf' : 'ics'
  const filename = safeFilename(collection.filename, `${collection.displayName || 'export'}.${extension}`)
  console.log(`Exporting ${collection.type === 'addressbook' ? 'address book' : 'calendar'} "${collection.displayName}" -> ${filename}`)
  const data = await exportCollection({
    nextcloudUrl: config.nextcloudUrl,
    username: config.username,
    appPassword: config.appPassword,
    href: collection.href,
  })
  if (data.length === 0) {
    console.warn(`  skipped: the server returned an empty export`)
    continue
  }
  await atomicWriteFile(path.join(destination, filename), data, { mode: 0o644 })
  console.log(`  wrote ${data.length} bytes`)
  exported += 1
}

if (exported === 0) {
  console.error('Nothing was exported.')
  process.exit(1)
}

if (config.git?.enabled !== false) {
  gitCommit(destination, config.git?.message?.trim() || `Contacts + Calendar · ${new Date().toLocaleString()}`)
}

console.log(`Exported ${exported} collection(s) to ${destination}`)
