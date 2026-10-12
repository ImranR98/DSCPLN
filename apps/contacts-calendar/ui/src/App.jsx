import { useState } from 'react'
import { Shell, postJson } from '@dscpln/ui-kit'

const FIELDS = [
  { path: 'nextcloudUrl', label: 'Nextcloud URL', type: 'text', help: 'In-cluster address, e.g. http://nextcloud:80' },
  { path: 'username', label: 'Username', type: 'text' },
  { path: 'appPassword', label: 'App password', type: 'password', help: 'Create a device password in Nextcloud → Personal settings → Security.' },
  { path: 'destination', label: 'Destination folder', type: 'text', help: 'Exports are written here and git-committed.' },
  { path: 'git.enabled', label: 'Git commit after export', type: 'checkbox' },
  { path: 'git.message', label: 'Custom commit message', type: 'text' },
]

export default function App() {
  const [status, setStatus] = useState({ text: '', tone: '' })
  const [discovering, setDiscovering] = useState(false)

  const discover = async (draft, update) => {
    setDiscovering(true)
    setStatus({ text: 'Discovering…', tone: '' })
    try {
      const { collections } = await postJson('api/discover', {
        nextcloudUrl: draft.nextcloudUrl,
        username: draft.username,
        appPassword: draft.appPassword,
        collections: draft.collections,
      })
      update('collections', collections)
      setStatus({
        text: `${collections.length} collection${collections.length === 1 ? '' : 's'} found — all enabled. Uncheck any to skip, then Save.`,
        tone: 'ok',
      })
    } catch (err) {
      setStatus({ text: err.message, tone: 'error' })
    } finally {
      setDiscovering(false)
    }
  }

  const settingsExtra = ({ draft, update }) => (
    <section className="settings-section">
      <h3>Collections</h3>
      <div className="settings-row">
        <span className="muted">Address books and calendars</span>
        <button disabled={discovering} onClick={() => discover(draft, update)} data-testid="discover">
          Discover
        </button>
      </div>

      <div className="collection-list">
        {!draft.collections?.length ? (
          <p className="hint">Press Discover to list address books and calendars from Nextcloud.</p>
        ) : null}

        {(draft.collections ?? []).map((collection, index) => (
          <div className="collection-row" key={index}>
            <input type="checkbox" checked={Boolean(collection.enabled)}
              onChange={(event) => update(`collections.${index}.enabled`, event.target.checked)} />
            <span className="collection-row__name">
              <strong>{collection.displayName || collection.href}</strong>
              <span className="muted"> · {collection.type === 'addressbook' ? 'address book' : 'calendar'}</span>
            </span>
            <input value={collection.filename ?? ''}
              placeholder={collection.type === 'addressbook' ? 'Contacts.vcf' : 'Calendar.ics'}
              onChange={(event) => update(`collections.${index}.filename`, event.target.value)} />
          </div>
        ))}
      </div>

      {status.text ? (
        <p className={status.tone === 'error' ? 'form-error' : 'hint'} data-testid="discover-status">{status.text}</p>
      ) : null}
    </section>
  )

  return (
    <Shell
      name="Contacts + Calendar"
      fields={FIELDS}
      settingsNotice="Discover lists your Nextcloud collections (enabled by default; uncheck the ones to skip) and lets you pick their file names. Save to apply."
      settingsExtra={settingsExtra}
    />
  )
}
