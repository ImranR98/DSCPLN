#!/usr/bin/env node
// Runs the State Backups restic backup for the given config. Invoked by the
// app's Runner so the output streams into the live log.
//
//   node run.mjs --config /data/config.json --data-dir /data

import fsp from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { runBackup } from './backup.mjs'

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    'data-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || !values.config || !values['data-dir']) {
  console.log('usage: node run.mjs --config <config.json> --data-dir <dir>')
  process.exit(values.help ? 0 : 2)
}

const config = JSON.parse(await fsp.readFile(values.config, 'utf8'))
try {
  await runBackup({ config, dataDir: values['data-dir'], log: (line) => console.log(line) })
} catch (err) {
  console.error(`Backup failed: ${err.message}`)
  process.exit(1)
}
