// Formatting helpers for the WhatsApp TXT UI (pure; no React).

const pad = (value) => String(value).padStart(2, '0')

export const dateLabel = (iso) => {
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const timeLabel = (iso) => {
  const date = new Date(iso)
  const hours = date.getHours() % 12 || 12
  return `${pad(hours)}:${pad(date.getMinutes())} ${date.getHours() >= 12 ? 'PM' : 'AM'}`
}

export const relativeTime = (iso) => {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} d ago`
}

export const initials = (name) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return ([...words[0]][0] + [...words[1]][0]).toUpperCase()
  return [...(words[0] ?? '?')].slice(0, 2).join('').toUpperCase()
}

export const typeLabel = (type) => (type === 'text' ? '' : type.charAt(0).toUpperCase() + type.slice(1))

export const formatSize = (bytes) => {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const senderHue = (text) => {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 360
  return hash
}

const SENDER_TONES = [
  { s: 62, l: 34, ds: 55, dl: 72 },
  { s: 46, l: 45, ds: 44, dl: 80 },
  { s: 72, l: 39, ds: 62, dl: 76 },
]

// Distinct, deterministic colors per sender: one hue circle per conversation
// starting from a hash of its participants, so adjacent chats differ.
export const buildSenderPalette = (senders) => {
  const unique = [...new Set((senders ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const palette = new Map()
  if (unique.length === 0) return palette
  const base = senderHue(unique.join('\u0000'))
  unique.forEach((sender, index) => {
    const hue = (base + (index * 360) / unique.length) % 360
    const tone = SENDER_TONES[index % SENDER_TONES.length]
    palette.set(sender, {
      light: `hsl(${hue} ${tone.s}% ${tone.l}%)`,
      dark: `hsl(${hue} ${tone.ds}% ${tone.dl}%)`,
    })
  })
  return palette
}

const URL_RE = /(https?:\/\/[^\s<]+)/g

// Splits a message body into text runs and links for rendering.
export const bodyParts = (text) => {
  const parts = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ href: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
