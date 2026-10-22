// Minimal CardDAV/CalDAV client: PROPFIND discovery and collection export.
// No XML library: Nextcloud's DAV responses are regular enough that targeted
// regex extraction is stable and dependency-free.

const XML_HEADER = '<?xml version="1.0" encoding="utf-8" ?>'

const NS = {
  d: 'DAV:',
  cal: 'urn:ietf:params:xml:ns:caldav',
  card: 'urn:ietf:params:xml:ns:carddav',
}

export function normalizeBaseUrl(url) {
  const trimmed = String(url ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Nextcloud URL must start with http:// or https://')
  }
  return trimmed
}

function authHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export async function davRequest(url, { method = 'PROPFIND', username, password, depth = '0', body = null, timeoutMs = 30_000 } = {}) {
  const headers = {
    Authorization: authHeader(username, password),
    Depth: String(depth),
  }
  if (method === 'PROPFIND') {
    headers['Content-Type'] = 'application/xml; charset=utf-8'
  }
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  })
  if (response.status === 401) throw new Error('Nextcloud authentication failed (check the username and app password)')
  if (!response.ok) throw new Error(`${method} ${url} -> HTTP ${response.status}`)
  return response
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function tagContent(xml, tag) {
  const match = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i').exec(xml)
  return match ? decodeXml(match[1]).trim() : null
}

// Parses a 207 Multi-Status body into [{href, type, displayName}] where type is
// 'calendar' | 'addressbook' | 'collection'.
export function parsePropfind(xml) {
  const entries = []
  const blocks = xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? []
  for (const block of blocks) {
    const href = tagContent(block, 'href')
    if (!href) continue
    const resourceType = tagContent(block, 'resourcetype') ?? ''
    let type = 'collection'
    if (/calendar/i.test(resourceType)) type = 'calendar'
    else if (/addressbook/i.test(resourceType)) type = 'addressbook'
    const displayName = tagContent(block, 'displayname')
    entries.push({
      href: href.endsWith('/') ? href : `${href}/`,
      type,
      displayName: displayName || decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? ''),
    })
  }
  return entries
}

// Properties are given as "prefix:name" (default prefix d). The namespace
// matters: SabreDAV (Nextcloud) answers 404 for calendar-home-set requested in
// the DAV: namespace instead of CalDAV/CardDAV.
export async function propfind(baseUrl, path, { username, password, depth, properties }) {
  const body = `${XML_HEADER}
<d:propfind xmlns:d="${NS.d}" xmlns:cal="${NS.cal}" xmlns:card="${NS.card}">
  <d:prop>${properties.map((p) => {
    const [prefix, name] = p.includes(':') ? p.split(':') : ['d', p]
    if (!NS[prefix]) throw new Error(`unknown namespace prefix ${prefix}`)
    return `<${prefix}:${name}/>`
  }).join('')}</d:prop>
</d:propfind>`
  const response = await davRequest(`${baseUrl}${path}`, { username, password, depth, body })
  return response.text()
}

// Discovers the user's calendar and address book collections.
export async function discoverCollections({ nextcloudUrl, username, appPassword }) {
  const base = normalizeBaseUrl(nextcloudUrl)
  if (!username) throw new Error('username is required')

  const principalXml = await propfind(base, '/remote.php/dav/', {
    username,
    password: appPassword,
    depth: '0',
    properties: ['current-user-principal'],
  })
  const principalHref = tagContent(
    /<(?:[\w-]+:)?current-user-principal\b[\s\S]*?<\/(?:[\w-]+:)?current-user-principal>/i.exec(principalXml)?.[0] ?? '',
    'href',
  )
  if (!principalHref) throw new Error('could not find the DAV principal (is the URL a Nextcloud server?)')

  const homeXml = await propfind(base, principalHref, {
    username,
    password: appPassword,
    depth: '0',
    properties: ['cal:calendar-home-set', 'card:addressbook-home-set'],
  })
  const calendarHome = tagContent(
    /<(?:[\w-]+:)?calendar-home-set\b[\s\S]*?<\/(?:[\w-]+:)?calendar-home-set>/i.exec(homeXml)?.[0] ?? '',
    'href',
  )
  const addressbookHome = tagContent(
    /<(?:[\w-]+:)?addressbook-home-set\b[\s\S]*?<\/(?:[\w-]+:)?addressbook-home-set>/i.exec(homeXml)?.[0] ?? '',
    'href',
  )

  const collections = []
  for (const home of [calendarHome, addressbookHome]) {
    if (!home) continue
    const listing = await propfind(base, home, {
      username,
      password: appPassword,
      depth: '1',
      properties: ['resourcetype', 'displayname'],
    })
    for (const entry of parsePropfind(listing)) {
      if (entry.type === 'calendar' || entry.type === 'addressbook') {
        collections.push(entry)
      }
    }
  }
  // The home itself may also be listed; drop duplicate/self entries.
  const seen = new Set()
  return collections.filter((entry) => {
    if (entry.href === calendarHome || entry.href === addressbookHome) return false
    if (seen.has(entry.href)) return false
    seen.add(entry.href)
    return true
  })
}

// Exports one collection as ICS/VCF bytes (Nextcloud's `?export` endpoint).
export async function exportCollection({ nextcloudUrl, username, appPassword, href }) {
  const base = normalizeBaseUrl(nextcloudUrl)
  const url = `${base}${href.replace(/\/+$/, '')}/?export`
  const response = await davRequest(url, { method: 'GET', username, password: appPassword, timeoutMs: 120_000 })
  return Buffer.from(await response.arrayBuffer())
}
