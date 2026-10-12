<script>
  import { Shell, formatBytes, formatDateTime, getJson, postJson } from '@dscpln/ui-kit'

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
    } catch (err) {
      archivesError = err.message
    }
  }

  setInterval(refreshArchives, 30_000)
  refreshArchives()
</script>

{#snippet settingsExtra({ draft, update })}
  <section>
    <h3>Targets</h3>
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
        <button class="secondary remove" title="Remove target"
          onclick={() => update('targets', draft.targets.filter((_, i) => i !== index))}>&times;</button>
      </div>
    {/each}
    <button class="secondary"
      onclick={() => update('targets', [...(draft.targets ?? []), { name: '', mode: 'local', host: '', path: '' }])}>
      Add target
    </button>
  </section>

  <section>
    <h3>SSH key</h3>
    <p><small>Add this public key to your SSH target's ~/.ssh/authorized_keys (the app stores the private half on its volume).</small></p>
    <pre class="code-block">{draft.sshPublicKey || '(no key yet)'}</pre>
    <button class="secondary" onclick={() => regenerateKey(update)}>Regenerate key</button>
  </section>
{/snippet}

<Shell
  name="Infra Compose State"
  fields={FIELDS}
  settingsNotice="Local targets run in this container; SSH targets stream the archive from a remote host. Retention keeps the newest N archives per target."
  settingsExtra={settingsExtra}
>
  <article>
    <header>
      <strong>Archives</strong>
      <small>{archives.destination}</small>
    </header>
    {#if archivesError}<p class="error">{archivesError}</p>{/if}
    {#if !archives.entries?.length}
      <p>No archives yet.</p>
    {:else}
      <table>
        <thead>
          <tr><th>Archive</th><th>Target</th><th>Size</th><th>Written</th></tr>
        </thead>
        <tbody>
          {#each archives.entries as entry (entry.name)}
            <tr>
              <td>{entry.name}</td>
              <td>{entry.target}</td>
              <td>{formatBytes(entry.size)}</td>
              <td>{formatDateTime(entry.mtime)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <footer><button class="secondary" onclick={refreshArchives}>Refresh</button></footer>
  </article>
</Shell>

<style>
  .target-row {
    display: grid;
    grid-template-columns: 1fr 6rem 1fr 2fr auto;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .target-row input,
  .target-row select {
    margin: 0;
  }
  .remove {
    width: auto;
    margin: 0;
  }
  .code-block {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-size: 0.8rem;
  }
  .error {
    color: var(--pico-del-color);
  }
</style>
