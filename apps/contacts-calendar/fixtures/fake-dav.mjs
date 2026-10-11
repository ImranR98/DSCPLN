// Tiny fake Nextcloud DAV server for tests: PROPFIND discovery + ?export.
import http from 'node:http'

const XML = (body) => `<?xml version="1.0" encoding="utf-8" ?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav">
${body}
</d:multistatus>`

const response = (href, props) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`

export async function startFakeDav({ username = 'imran', password = 'app-pass' } = {}) {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      handle(req, res, Buffer.concat(chunks).toString('utf8'))
    })
  })

  const handle = (req, res, body) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push({ method: req.method, path: url.pathname, search: url.search, authorization: req.headers.authorization, body })
    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    if (req.headers.authorization !== expected) {
      res.writeHead(401).end('unauthorized')
      return
    }
    const path = url.pathname
    const send = (xml, code = 207) => {
      res.writeHead(code, { 'Content-Type': 'application/xml; charset=utf-8' })
      res.end(xml)
    }
    if (req.method === 'PROPFIND' && path === '/remote.php/dav/') {
      send(XML(response('/remote.php/dav/principals/users/imran/', '<d:current-user-principal><d:href>/remote.php/dav/principals/users/imran/</d:href></d:current-user-principal>')))
      return
    }
    if (req.method === 'PROPFIND' && path === '/remote.php/dav/principals/users/imran/') {
      // Namespace-strict like real SabreDAV: the home-set properties are only
      // returned when requested in the CalDAV/CardDAV namespaces.
      const cal = body.includes('<cal:calendar-home-set/>')
        ? '<cal:calendar-home-set><d:href>/remote.php/dav/calendars/imran/</d:href></cal:calendar-home-set>'
        : '<d:calendar-home-set/>'
      const card = body.includes('<card:addressbook-home-set/>')
        ? '<card:addressbook-home-set><d:href>/remote.php/dav/addressbooks/users/imran/</d:href></card:addressbook-home-set>'
        : '<d:addressbook-home-set/>'
      send(XML(response(path, cal + card)))
      return
    }
    if (req.method === 'PROPFIND' && path === '/remote.php/dav/calendars/imran/') {
      send(XML(
        response('/remote.php/dav/calendars/imran/', '<d:resourcetype><d:collection/></d:resourcetype><d:displayname>imran</d:displayname>') +
        response('/remote.php/dav/calendars/imran/personal/', '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Personal</d:displayname>') +
        response('/remote.php/dav/calendars/imran/todo/', '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>TODO</d:displayname>'),
      ))
      return
    }
    if (req.method === 'PROPFIND' && path === '/remote.php/dav/addressbooks/users/imran/') {
      send(XML(
        response('/remote.php/dav/addressbooks/users/imran/', '<d:resourcetype><d:collection/></d:resourcetype>') +
        response('/remote.php/dav/addressbooks/users/imran/contacts/', '<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>My Contacts</d:displayname>'),
      ))
      return
    }
    if (req.method === 'GET' && url.search === '?export') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(`EXPORT ${path}`)
      return
    }
    res.writeHead(404).end('not found')
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
