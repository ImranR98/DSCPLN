import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverCollections, exportCollection, parsePropfind } from '../dav.mjs'
import { startFakeDav } from '../fixtures/fake-dav.mjs'

test('parsePropfind extracts hrefs, types and names', () => {
  const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/imran/personal/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <d:displayname>Personal</d:displayname>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/addressbooks/users/imran/contacts/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
      <d:displayname>My &amp; Contacts</d:displayname>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/imran/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
</d:multistatus>`
  const entries = parsePropfind(xml)
  assert.equal(entries.length, 3)
  assert.deepEqual(entries[0], { href: '/remote.php/dav/calendars/imran/personal/', type: 'calendar', displayName: 'Personal' })
  assert.equal(entries[1].type, 'addressbook')
  assert.equal(entries[1].displayName, 'My & Contacts')
  assert.equal(entries[2].type, 'collection')
})

test('discoverCollections follows principal + homes and lists calendars/address books', async (t) => {
  const dav = await startFakeDav()
  t.after(() => dav.close())
  const collections = await discoverCollections({
    nextcloudUrl: dav.url,
    username: 'imran',
    appPassword: 'app-pass',
  })
  assert.deepEqual(
    collections.map((c) => [c.type, c.displayName]),
    [['calendar', 'Personal'], ['calendar', 'TODO'], ['addressbook', 'My Contacts']],
  )
  assert.ok(dav.requests.every((r) => r.authorization?.startsWith('Basic ')))
})

test('exportCollection fetches the ?export endpoint', async (t) => {
  const dav = await startFakeDav()
  t.after(() => dav.close())
  const data = await exportCollection({
    nextcloudUrl: dav.url,
    username: 'imran',
    appPassword: 'app-pass',
    href: '/remote.php/dav/calendars/imran/personal/',
  })
  assert.match(data.toString(), /EXPORT \/remote.php\/dav\/calendars\/imran\/personal\//)
})

test('wrong credentials surface a clear error', async (t) => {
  const dav = await startFakeDav()
  t.after(() => dav.close())
  await assert.rejects(
    () => discoverCollections({ nextcloudUrl: dav.url, username: 'imran', appPassword: 'wrong' }),
    /authentication failed/,
  )
})
