<script>
  import { RefreshCw } from 'lucide-svelte'
  import { Shell, formatBytes, formatDateTime, getJson, postJson, showToast } from '@dscpln/ui-kit'

  let archives = $state({ destination: '', entries: [] })
  let archivesError = $state('')

  const FIELDS = [
    { path: 'destination', label: 'Destination folder', help: 'Archives land here (e.g. ~/compose_state_backups).' },
    { path: 'retention', label: 'Retention (archives kept per target)', type: 'number' },
  ]

  async function refreshArchives() {
    try {
      archives = await getJson('api/archives')
      archivesError = ''
    } catch (err) {
      archivesError = err.message
    }
  }

  async function regenerateKey(update) {
    try {
      const { sshPublicKey } = await postJson('api/key/regenerate', {})
      update('sshPublicKey', sshPublicKey)
      showToast('New SSH key generated — authorize it on vps0')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  refreshArchives()
  setInterval(refreshArchives, 30_000)
</script>

{#snippet settingsExtra({ draft, update })}
  <section class="settings-section">
    <h3>Targets</h3>
    <div class="target-list">
      {#each draft.targets ?? [] as _target, index}
        <div class="target-row">
          <input placeholder="name" value={draft.targets[index].name ?? ''}
            oninput={(event) => update(`targets.${index}.name`, event.target.value)} />
          <select value={draft.targets[index].mode ?? 'local'}
            onchange={(event) => update(`targets.${index}.mode`, event.target.value)}>
            <option value="local">local</option>
            <option value="ssh">ssh</option>
          </select>
          <input placeholder="host (ssh)" value={draft.targets[index].host ?? ''}
            oninput={(event) => update(`targets.${index}.host`, event.target.value)} />
          <input placeholder="path to compose_live_state" value={draft.targets[index].path ?? ''}
            oninput={(event) => update(`targets.${index}.path`, event.target.value)} />
          <button class="danger target-row__remove" title="Remove target" aria-label="Remove target"
            onclick={() => update('targets', draft.targets.filter((_, i) => i !== index))}>&times;</button>
        </div>
      {/each}
    </div>
    <button class="outline secondary"
      onclick={() => update('targets', [...(draft.targets ?? []), { name: '', mode: 'local', host: '', path: '' }])}>
      Add target
    </button>
  </section>

  <section class="settings-section">
    <h3>SSH key</h3>
    <p class="hint">Add this public key to the SSH target's ~/.ssh/authorized_keys (the app stores the private half on its volume).</p>
    <pre class="code-block key-block">{draft.sshPublicKey || '(no key yet)'}</pre>
    <div class="settings-row">
      <span></span>
      <button class="warning" onclick={() => regenerateKey(update)}>Regenerate key</button>
    </div>
  </section>
{/snippet}

<Shell
  name="Infra Compose State"
  fields={FIELDS}
  settingsNotice="Local targets run in this container; SSH targets stream the archive from a remote host. Retention keeps the newest N archives per target."
  settingsExtra={settingsExtra}
>
  <section class="card" id="archivesCard">
    <div class="card__header">
      <h2>Archives</h2>
      <span class="card__header-tools">
        <span class="card__context">{archives.destination}</span>
        <button class="outline secondary icon-button" title="Refresh archives" aria-label="Refresh archives" onclick={refreshArchives}>
          <RefreshCw size={16} strokeWidth={1.8} />
        </button>
      </span>
    </div>
    {#if archivesError}
      <p class="form-error">{archivesError}</p>
    {:else if !archives.entries?.length}
      <p class="muted">No archives yet.</p>
    {:else}
      <div class="archive-list">
        {#each archives.entries as entry (entry.name)}
          <div class="archive-row">
            <span class="archive-row__name">{entry.name}</span>
            <span class="muted">{entry.target}</span>
            <span class="muted">{formatBytes(entry.size)}</span>
            <span class="muted">{formatDateTime(entry.mtime)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</Shell>
