import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Shell, formatBytes, formatDateTime, getJson } from '@dscpln/ui-kit'

const FIELDS = [
  { path: 'destination', label: 'Restic repository', help: 'Repository path, e.g. /home/imranr/Main/Infra/state_backups/restic.' },
  { path: 'appDataRoot', label: 'App-data root', help: 'Host directory containing nfs-apps/<namespace>/<pvc>.' },
  { path: 'retention', label: 'Snapshots kept', type: 'number', help: 'restic forget --keep-last N --prune after each successful run.' },
  { path: 'resticPassword', label: 'Restic password', type: 'password', help: 'Leave the masked value to keep the current password. Clear it to use the built-in default.' },
  { path: 'notifySuccess', label: 'Notify when a run succeeds', type: 'checkbox', help: 'Failures always notify; notifications are sent through the portal.' },
]

export default function App() {
  const [snapshots, setSnapshots] = useState({ repository: '', entries: [] })
  const [snapshotsError, setSnapshotsError] = useState('')

  const refreshSnapshots = async () => {
    try {
      setSnapshots(await getJson('api/snapshots'))
      setSnapshotsError('')
    } catch (err) {
      setSnapshotsError(err.message)
    }
  }

  useEffect(() => {
    refreshSnapshots()
    const timer = setInterval(refreshSnapshots, 30_000)
    return () => clearInterval(timer)
  }, [])

  const settingsExtra = ({ draft, update }) => (
    <>
      <section className="settings-section">
        <h3>Compose targets</h3>
        <p className="hint">Local targets are read in this container. SSH targets are fetched with the mounted vps0 key.</p>
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
        <h3>vps0 SSH key</h3>
        <p className="hint">The deployment mounts the existing vps0 key from a Secret. The public half is shown here for reference.</p>
        <pre className="code-block key-block">{draft.sshPublicKey || '(no key mounted)'}</pre>
      </section>
    </>
  )

  return (
    <Shell
      name="State Backups"
      fields={FIELDS}
      settingsNotice="Backups include the labelled K3s app PVCs and the configured Compose state. Restore is a separate operator command; this app is backup-only."
      settingsExtra={settingsExtra}
    >
      <section className="card" id="snapshotsCard">
        <div className="card__header">
          <h2>Snapshots</h2>
          <span className="card__header-tools">
            <span className="card__context">{snapshots.repository}</span>
            <button className="outline secondary icon-button" title="Refresh snapshots" aria-label="Refresh snapshots" onClick={refreshSnapshots}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
          </span>
        </div>
        {snapshotsError ? (
          <p className="form-error">{snapshotsError}</p>
        ) : !snapshots.entries?.length ? (
          <p className="muted">No snapshots yet.</p>
        ) : (
          <div className="archive-list">
            {snapshots.entries.map((entry) => (
              <div className="archive-row" key={entry.id ?? `${entry.time}:${entry.hostname}`}>
                <span className="archive-row__name">{entry.id}</span>
                <span className="muted">{entry.hostname}</span>
                <span className="muted">{entry.paths?.length ?? 0} path(s)</span>
                <span className="muted">{entry.size == null ? '—' : formatBytes(entry.size)}</span>
                <span className="muted">{formatDateTime(entry.time)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Shell>
  )
}
