<script>
  import { Shell, postJson } from '@dscpln/ui-kit'

  const FIELDS = [
    { path: 'nextcloudUrl', label: 'Nextcloud URL', type: 'text', help: 'In-cluster address, e.g. http://nextcloud:80' },
    { path: 'username', label: 'Username', type: 'text' },
    { path: 'appPassword', label: 'App password', type: 'password', help: 'Create a device password in Nextcloud → Personal settings → Security.' },
    { path: 'destination', label: 'Destination folder', type: 'text', help: 'Exports are written here and git-committed.' },
    { path: 'git.enabled', label: 'Git commit after export', type: 'checkbox' },
    { path: 'git.message', label: 'Custom commit message', type: 'text' },
  ]

  let status = $state({ text: '', tone: '' })
  let discovering = $state(false)

  async function discover(draft, update) {
    discovering = true
    status = { text: 'Discovering…', tone: '' }
    try {
      const { collections } = await postJson('api/discover', {
        nextcloudUrl: draft.nextcloudUrl,
        username: draft.username,
        appPassword: draft.appPassword,
        collections: draft.collections,
      })
      update('collections', collections)
      status = {
        text: `${collections.length} collection${collections.length === 1 ? '' : 's'} found — all enabled. Uncheck any to skip, then Save.`,
        tone: 'ok',
      }
    } catch (err) {
      status = { text: err.message, tone: 'error' }
    } finally {
      discovering = false
    }
  }
</script>

{#snippet settingsExtra({ draft, update })}
  <section class="settings-section">
    <h3>Collections</h3>
    <div class="settings-row">
      <span class="muted">Address books and calendars</span>
      <button disabled={discovering} onclick={() => discover($state.snapshot(draft), update)} data-testid="discover">
        Discover
      </button>
    </div>

    <div class="collection-list">
      {#if !draft.collections?.length}
        <p class="hint">Press Discover to list address books and calendars from Nextcloud.</p>
      {/if}

      {#each draft.collections ?? [] as collection, index}
        <div class="collection-row">
          <input type="checkbox" checked={Boolean(collection.enabled)}
            onchange={(event) => update(`collections.${index}.enabled`, event.target.checked)} />
          <span class="collection-row__name">
            <strong>{collection.displayName || collection.href}</strong>
            <span class="muted"> · {collection.type === 'addressbook' ? 'address book' : 'calendar'}</span>
          </span>
          <input value={collection.filename ?? ''}
            placeholder={collection.type === 'addressbook' ? 'Contacts.vcf' : 'Calendar.ics'}
            oninput={(event) => update(`collections.${index}.filename`, event.target.value)} />
        </div>
      {/each}
    </div>

    {#if status.text}
      <p class={status.tone === 'error' ? 'form-error' : 'hint'} data-testid="discover-status">{status.text}</p>
    {/if}
  </section>
{/snippet}

<Shell
  name="Contacts + Calendar"
  fields={FIELDS}
  settingsNotice="Discover lists your Nextcloud collections (enabled by default; uncheck the ones to skip) and lets you pick their file names. Save to apply."
  settingsExtra={settingsExtra}
/>
