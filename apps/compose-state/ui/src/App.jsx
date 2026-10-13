import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Shell, formatBytes, formatDateTime, getJson, postJson, showToast } from '@dscpln/ui-kit'

const FIELDS = [
  { path: 'destination', label: 'Destination folder', help: 'Archives land here (e.g. ~/compose_state_backups).' },
  { path: 'retention', label: 'Retention (archives kept per target)', type: 'number' },
]

export default function App() {
  const [archives, setArchives] = useState({ destination: '', entries: [] })
  const [archivesError, setArchivesError] = useState('')

  const refreshArchives = async () => {
    try {
      setArchives(await getJson('api/archives'))
      setArchivesError('')
    } catch (err) {
      setArchivesError(err.message)
    }
  }

  const regenerateKey = async (update) => {
    try {
      const { sshPublicKey } = await postJson('api/key/regenerate', {})
      update('sshPublicKey', sshPublicKey)
      showToast('New SSH key generated — authorize it on vps0')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  useEffect(() => {
    refreshArchives()
    const timer = setInterval(refreshArchives, 30_000)
    return () => clearInterval(timer)
  }, [])

  const settingsExtra = ({ draft, update }) => (
    <>
      <section className="settings-section">
        <h3>Targets</h3>
        <div className="target-list">
          {(draft.targets ?? []).map((_target, index) => (
            <div className="target-row" key={index}>
              <input placeholder="name" value={draft.targets[index].name ?? ''}
                onChange={(event) => update(`targets.${index}.name`, event.target.value)} />
              <select value={draft.targets[index].mode ?? 'local'}
                onChange={(event) => update(`targets.${index}.mode`, event.target.value)}>
                <option value="local">local</option>
                <option value="ssh">ssh</option>
              </select>
              <input placeholder="host (ssh)" value={draft.targets[index].host ?? ''}
                onChange={(event) => update(`targets.${index}.host`, event.target.value)} />
              <input placeholder="path to compose_live_state" value={draft.targets[index].path ?? ''}
                onChange={(event) => update(`targets.${index}.path`, event.target.value)} />
              <button className="danger target-row__remove" title="Remove target" aria-label="Remove target"
                onClick={() => update('targets', draft.targets.filter((_, i) => i !== index))}>&times;</button>
            </div>
          ))}
        </div>
        <button className="outline secondary"
          onClick={() => update('targets', [...(draft.targets ?? []), { name: '', mode: 'local', host: '', path: '' }])}>
          Add target
        </button>
      </section>

      <section className="settings-section">
        <h3>SSH key</h3>
        <p className="hint">Add this public key to the SSH target's ~/.ssh/authorized_keys (the app stores the private half on its volume).</p>
        <pre className="code-block key-block">{draft.sshPublicKey || '(no key yet)'}</pre>
        <div className="settings-row">
          <span></span>
          <button className="warning" onClick={() => regenerateKey(update)}>Regenerate key</button>
        </div>
      </section>
    </>
  )

  return (
    <Shell
      name="Infra Compose State"
      fields={FIELDS}
      settingsNotice="Local targets run in this container; SSH targets stream the archive from a remote host. Retention keeps the newest N archives per target."
      settingsExtra={settingsExtra}
    >
      <section className="card" id="archivesCard">
        <div className="card__header">
          <h2>Archives</h2>
          <span className="card__header-tools">
            <span className="card__context">{archives.destination}</span>
            <button className="outline secondary icon-button" title="Refresh archives" aria-label="Refresh archives" onClick={refreshArchives}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
          </span>
        </div>
        {archivesError ? (
          <p className="form-error">{archivesError}</p>
        ) : !archives.entries?.length ? (
          <p className="muted">No archives yet.</p>
        ) : (
          <div className="archive-list">
            {archives.entries.map((entry) => (
              <div className="archive-row" key={entry.name}>
                <span className="archive-row__name">{entry.name}</span>
                <span className="muted">{entry.target}</span>
                <span className="muted">{formatBytes(entry.size)}</span>
                <span className="muted">{formatDateTime(entry.mtime)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Shell>
  )
}
