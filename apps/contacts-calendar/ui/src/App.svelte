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
        tone: '',
      }
    } catch (err) {
      status = { text: err.message, tone: 'error' }
    } finally {
      discovering = false
    }
  }
</script>

{#snippet settingsExtra({ draft, update })}
  <section>
    <h3>Collections</h3>
    <div class="collections-header">
      <small>Address books and calendars</small>
      <button class="secondary" disabled={discovering} onclick={() => discover($state.snapshot(draft), update)}
        data-testid="discover">Discover</button>
    </div>

    {#if !draft.collections?.length}
      <p><small>Press Discover to list address books and calendars from Nextcloud.</small></p>
    {/if}

    {#each draft.collections ?? [] as collection, index}
      <div class="collection-row">
        <input type="checkbox" checked={Boolean(collection.enabled)}
          onchange={(event) => update(`collections.${index}.enabled`, event.target.checked)} />
        <span>
          <strong>{collection.displayName || collection.href}</strong>
          <small> · {collection.type === 'addressbook' ? 'address book' : 'calendar'}</small>
        </span>
        <input value={collection.filename ?? ''}
          placeholder={collection.type === 'addressbook' ? 'Contacts.vcf' : 'Calendar.ics'}
          oninput={(event) => update(`collections.${index}.filename`, event.target.value)} />
      </div>
    {/each}

    {#if status.text}
      <p class={status.tone === 'error' ? 'error' : ''} data-testid="discover-status">{status.text}</p>
    {/if}
  </section>
{/snippet}

<Shell
  name="Contacts + Calendar"
  fields={FIELDS}
  settingsNotice="Discover lists your Nextcloud collections (enabled by default; uncheck the ones to skip) and lets you pick their file names. Save to apply."
  settingsExtra={settingsExtra}
/>

<style>
  .collections-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .collections-header button {
    width: auto;
    margin: 0;
  }
  .collection-row {
    display: grid;
    grid-template-columns: auto 1fr 12rem;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .collection-row input[type='checkbox'] {
    margin: 0;
  }
  .collection-row input[type='text'] {
    margin: 0;
  }
  .error {
    color: var(--pico-del-color);
  }
</style>
