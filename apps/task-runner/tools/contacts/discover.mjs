#!/usr/bin/env node
// Discover the Nextcloud calendars/address books for a contacts config.
//
// This is the CLI successor to the Contacts app's Discover button. With
// --write it also updates the collections in the config (preserving existing
// enabled/filename choices), which is what the Task Runner's Discover action
// uses. Without --write it prints the JSON for manual pasting.
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { atomicWriteFile } from '@dscpln/server-kit/atomic'
import { discoverCollections, normalizeBaseUrl } from './dav.mjs'

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    write: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || !values.config) {
  console.log('usage: node discover.mjs --config <config.json> [--write]')
  process.exit(values.help ? 0 : 2)
}

const config = JSON.parse(await readFile(values.config, 'utf8'))
if (!config.nextcloudUrl) throw new Error('nextcloudUrl is required in the config')
normalizeBaseUrl(config.nextcloudUrl)

const discovered = await discoverCollections({
  nextcloudUrl: config.nextcloudUrl,
  username: config.username,
  appPassword: process.env.CONTACTS_APP_PASSWORD ?? config.appPassword,
})

const saved = new Map((config.collections ?? []).filter((entry) => entry?.href).map((entry) => [entry.href, entry]))
const collections = discovered.map((entry) => {
  const existing = saved.get(entry.href) ?? {}
  const extension = entry.type === 'addressbook' ? 'vcf' : 'ics'
  return {
    href: entry.href,
    type: entry.type,
    displayName: entry.displayName || existing.displayName || entry.href,
    enabled: existing.enabled ?? true,
    filename: existing.filename || `${entry.displayName || 'export'}.${extension}`,
  }
})

if (values.write) {
  await atomicWriteFile(values.config, `${JSON.stringify({ ...config, collections }, null, 2)}\n`, { mode: 0o644 })
  console.log(`Updated ${values.config}`)
} else {
  console.log(JSON.stringify(collections, null, 2))
}
const enabled = collections.filter((entry) => entry.enabled).length
console.log(`Discovered ${collections.length} collection(s), ${enabled} enabled.`)
