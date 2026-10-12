// Pure view helpers for the file-pipelines UI (no React): folder stats,
// context labels, the watched-file list ordering and the review grouping.

import { formatDuration } from '@dscpln/ui-kit'

export const STATUS_RANK = { error: 0, conflict: 1, queued: 2, processing: 3, pending: 4, review: 5, done: 6, duplicate: 7, discarded: 8, cleaned: 9, ignored: 10 }
export const METHOD_LABEL = { standardize: 'standardize', snapchat: 'snapchat', copy: 'copy', voicenotes: 'voicenotes' }
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const FILE_LIMIT = 300

export const isSnapshot = (folder) => folder.method === 'copy' && folder.snapshot === true

export function scheduleLabel(schedule) {
  if (!schedule?.enabled) return 'manual'
  const days = schedule.days?.length ? schedule.days.map((day) => DAY_NAMES[day]).join(', ') : 'every day'
  return `${days} at ${schedule.at}`
}

export function folderStats(folder) {
  const counts = folder.counts ?? {}
  const total = folder.files.length
  const ignored = counts.ignored ?? 0
  const processed = (counts.done ?? 0) + (counts.duplicate ?? 0)
  const considered = Math.max(1, total - ignored)
  return {
    total,
    pending: counts.pending ?? 0,
    processing: (counts.queued ?? 0) + (counts.processing ?? 0),
    processed,
    issues: (counts.error ?? 0) + (counts.conflict ?? 0),
    ignored,
    review: counts.review ?? 0,
    percent: Math.min(100, Math.round((processed / considered) * 100)),
  }
}

export function folderContext(folder) {
  if (isSnapshot(folder)) {
    return ['snapshot copy', folder.runner?.node ? `node ${folder.runner.node}` : 'this server', scheduleLabel(folder.schedule)].join(' · ')
  }
  const parts = [`settle ${formatDuration(folder.settleSeconds)}`]
  if (folder.method === 'snapchat') parts.push(`window ${formatDuration(folder.groupWindowSeconds)}`)
  if (folder.method === 'copy') {
    parts.push(folder.recursive ? 'recursive mirror' : 'flat copy')
    parts.push(`on change: ${folder.onChanged}`)
  }
  if (folder.placement === 'manual') parts.push('review before placing')
  if (folder.filePattern) parts.push(folder.filePattern)
  return parts.join(' · ')
}

export function sortedFiles(folder) {
  return [...folder.files]
    .sort((a, b) => {
      const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
      return rank !== 0 ? rank : a.name.localeCompare(b.name)
    })
    .slice(0, FILE_LIMIT)
}

// Groups pending/errored voicenote clips per chat and day, mirroring the
// server's grouping so the review dialog can offer "Process selected".
export function reviewGroups(folder) {
  const groups = new Map()
  for (const file of folder.files) {
    if (file.status !== 'pending' && file.status !== 'error') continue
    const parts = file.name.split('/')
    const base = parts.pop()
    const chat = parts.join('/')
    let date = null
    if (folder.datePattern) {
      try {
        const match = new RegExp(folder.datePattern).exec(base)
        if (match) {
          const raw = match.slice(1).filter(Boolean).join('').replace(/\D+/g, '')
          if (/^\d{8}$/.test(raw)) date = raw
        }
      } catch {
        date = null
      }
    }
    if (!date) continue
    const key = `${folder.name}\u0000${chat}\u0000${date}`
    if (!groups.has(key)) groups.set(key, { key, chat, date, files: [], bytes: 0 })
    const group = groups.get(key)
    group.files.push(file.name)
    group.bytes += file.size || 0
  }
  return [...groups.values()].sort((a, b) => `${a.chat}${a.date}`.localeCompare(`${b.chat}${b.date}`))
}
