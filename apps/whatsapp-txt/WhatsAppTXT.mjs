#!/usr/bin/env node
// WhatsApp TXT merge CLI. Usage is printed with --help; see README.md.

import fs from 'node:fs'
import { main } from './src/main.mjs'

export * from './src/index.mjs'

const USAGE = `Usage: node WhatsAppTXT.mjs [--dry-run] [--no-merge-renamed]
                            [--date-order=auto|dmy|mdy|ymd]
                            [--rename-min-shared=5] [--rename-min-coverage=0.6] [--help]
                            <output-directory> [additional-source-directory] [...]

Merges WhatsApp TXT exports (.txt) and existing JSON outputs with the same conversation
name across directories. The first directory receives the merged JSON files; existing
outputs there are replaced.
Each conversation is written as a JSON array of {date, sender, type, body} messages.
Conversations whose histories overlap heavily (renamed contacts/groups) are merged, with the
name changes recorded as system messages; --no-merge-renamed disables that.
Ambiguous slash dates default to DMY; --date-order forces an interpretation (auto = infer per file).
Aborts without modifying anything if a directory has name collisions or a file cannot be parsed.`

const args = process.argv.slice(2)

try {
  if (args.includes('--no-normalize')) {
    throw new Error('The --no-normalize text mode has been removed; conversations are always written as JSON')
  }
  const flags = ['--dry-run', '--no-merge-renamed', '--help', '-h']
  const dirs = args.filter((arg) => !flags.includes(arg)
    && !arg.startsWith('--date-order=')
    && !arg.startsWith('--rename-min-shared=')
    && !arg.startsWith('--rename-min-coverage='))
  if (args.includes('--help') || args.includes('-h') || dirs.length === 0) {
    console.log(USAGE)
    process.exit(args.length === 0 ? 2 : 0)
  }
  let dateOrder = 'auto'
  const dateOrderArg = args.find((arg) => arg.startsWith('--date-order='))
  if (dateOrderArg) {
    dateOrder = dateOrderArg.slice('--date-order='.length)
    if (!['auto', 'dmy', 'mdy', 'ymd'].includes(dateOrder)) throw new Error(`Invalid --date-order: ${dateOrder}`)
  }
  let renameMinShared = 5
  const minSharedArg = args.find((arg) => arg.startsWith('--rename-min-shared='))
  if (minSharedArg) {
    renameMinShared = Number(minSharedArg.slice('--rename-min-shared='.length))
    if (!Number.isFinite(renameMinShared) || renameMinShared < 1) throw new Error(`Invalid --rename-min-shared: ${minSharedArg}`)
  }
  let renameMinCoverage = 0.6
  const minCoverageArg = args.find((arg) => arg.startsWith('--rename-min-coverage='))
  if (minCoverageArg) {
    renameMinCoverage = Number(minCoverageArg.slice('--rename-min-coverage='.length))
    if (!Number.isFinite(renameMinCoverage) || renameMinCoverage <= 0 || renameMinCoverage > 1) throw new Error(`Invalid --rename-min-coverage: ${minCoverageArg}`)
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) throw new Error(`Directory does not exist: ${dir}`)
  }
  main(dirs, {
    dryRun: args.includes('--dry-run'),
    mergeRenamed: !args.includes('--no-merge-renamed'),
    renameMinShared,
    renameMinCoverage,
    dateOrder,
  })
} catch (err) {
  console.error(err)
  process.exit(-1)
}
