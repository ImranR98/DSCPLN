#!/usr/bin/env node
// Contacts + Calendar — scheduled Nextcloud CardDAV/CalDAV exports into
// ~/Main/Backups/Manual (git-committed). Config + state live on the app's PVC.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandPath, resolveSecret, scheduledApp, specValid, ValidationError } from '@dscpln/server-kit'
import { discoverCollections, normalizeBaseUrl } from './dav.mjs'

const APP_DIR = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_CONFIG = {
  nextcloudUrl: 'http://nextcloud:80',
  username: '',
  appPassword: '',
  destination: '~/Main/Backups/Manual',
  collections: [],
  git: { enabled: true, message: '' },
  ntfy: { url: '', token: '', notifySuccess: false },
  schedule: { enabled: true, days: [0], at: '03:00', catchUp: true },
}

export function normalizeConfig(raw) {
  const cfg = {
    ...raw,
    collections: Array.isArray(raw.collections) ? raw.collections : [],
    git: { enabled: true, message: '', ...(raw.git ?? {}) },
    ntfy: { url: '', token: '', notifySuccess: false, ...(raw.ntfy ?? {}) },
    schedule: { enabled: true, days: [], at: '03:00', catchUp: true, ...(raw.schedule ?? {}) },
  }
  cfg.destination = expandPath(cfg.destination)
  return cfg
}

export function validateConfig(cfg) {
  if (!cfg.destination) throw new ValidationError('destination is required')
  try {
    normalizeBaseUrl(cfg.nextcloudUrl)
  } catch (err) {
    throw new ValidationError(err.message)
  }
  if (cfg.collections.some((collection) => !collection?.href)) {
    throw new ValidationError('every collection needs an href')
  }
  if (!specValid(cfg.schedule)) {
    throw new ValidationError('schedule needs a valid time (HH:MM)')
  }
}

// Merges freshly discovered collections with the saved configuration: keeps
// the user's enabled/filename choices for hrefs that still exist.
export function mergeCollections(discovered, saved = []) {
  const byHref = new Map(saved.filter((c) => c?.href).map((c) => [c.href, c]))
  return discovered.map((entry) => {
    const existing = byHref.get(entry.href) ?? {}
    const extension = entry.type === 'addressbook' ? 'vcf' : 'ics'
    return {
      href: entry.href,
      type: entry.type,
      displayName: entry.displayName || existing.displayName || entry.href,
      enabled: existing.enabled ?? false,
      filename: existing.filename || `${entry.displayName || 'export'}.${extension}`,
    }
  })
}

export function createContactsApp(options = {}) {
  const dataDir = options.dataDir ?? process.env.DSCPLN_DATA_DIR ?? '/data'
  const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
  const commands = options.commands ?? (() => [
    [process.execPath, path.join(APP_DIR, 'export.mjs'), '--config', path.join(dataDir, 'config.json')],
  ])

  return scheduledApp({
    name: 'Contacts + Calendar',
    dataDir,
    basePath,
    staticDir: path.join(APP_DIR, 'static'),
    defaults: DEFAULT_CONFIG,
    normalize: normalizeConfig,
    validate: validateConfig,
    secrets: ['appPassword'],
    commands: (cfg) => commands(cfg),
    summarize: (result, cfg) => {
      const enabled = (cfg.collections ?? []).filter((c) => c.enabled).length
      return `Exported ${enabled} collection${enabled === 1 ? '' : 's'}`
    },
    routes: (router, ctx) => {
      // Discovers the user's collections (credentials taken from the request so
      // Discover works before the first save).
      router.post('/api/discover', async (req, res, next) => {
        try {
          const saved = ctx.config.get() ?? {}
          const body = req.body ?? {}
          const discovered = await discoverCollections({
            nextcloudUrl: body.nextcloudUrl || saved.nextcloudUrl,
            username: body.username || saved.username,
            appPassword: resolveSecret(body.appPassword, saved.appPassword),
          })
          res.json({ collections: mergeCollections(discovered, body.collections ?? saved.collections ?? []) })
        } catch (err) {
          err.statusCode = err.statusCode ?? 502
          next(err)
        }
      })
    },
  })
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const app = createContactsApp()
  await app.start()
  app.app.listen(app.port, app.host, () => {
    console.log(`D$CPLN Contacts + Calendar listening on http://${app.host}:${app.port}${process.env.BASE_PATH ?? ''}`)
  })
}
