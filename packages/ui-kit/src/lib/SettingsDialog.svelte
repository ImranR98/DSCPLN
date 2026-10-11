<script>
  import { getPath, setPath } from './paths.js'

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  let { fields = [], schedule = true, notice = null, onsave, extra } = $props()

  let dialog = $state(null)
  let draft = $state({ schedule: { enabled: false, days: [], at: '03:00', catchUp: true } })
  let error = $state('')

  export function show(config) {
    draft = structuredClone($state.snapshot(config ?? {}))
    if (schedule) {
      draft.schedule ??= { enabled: false, days: [], at: '03:00', catchUp: true }
      draft.schedule.days ??= []
    }
    error = ''
    dialog.showModal()
  }

  function value(path) {
    const current = getPath(draft, path)
    return current == null ? '' : current
  }

  function update(path, next) {
    setPath(draft, path, next)
    draft = draft
  }

  function toggleDay(index, checked) {
    const days = new Set(draft.schedule.days ?? [])
    if (checked) days.add(index)
    else days.delete(index)
    draft.schedule.days = [...days].sort()
  }

  async function save() {
    try {
      await onsave($state.snapshot(draft))
      dialog.close()
    } catch (err) {
      error = err.message
    }
  }
</script>

<dialog bind:this={dialog}>
  <article>
    <header>
      <strong>Settings</strong>
      <button class="close" aria-label="Close" onclick={() => dialog.close()}>&times;</button>
    </header>

    {#if notice}<p><small>{notice}</small></p>{/if}

    {#if schedule}
      <fieldset>
        <legend>Schedule</legend>
        <label>
          <input type="checkbox" checked={Boolean(draft.schedule.enabled)}
            onchange={(event) => (draft.schedule.enabled = event.target.checked)} />
          Enabled
        </label>
        <div class="row">
          <label>At <input type="time" value={draft.schedule.at ?? '03:00'}
            oninput={(event) => (draft.schedule.at = event.target.value)} /></label>
          <label>
            <input type="checkbox" checked={draft.schedule.catchUp !== false}
              onchange={(event) => (draft.schedule.catchUp = event.target.checked)} />
            Catch up missed runs
          </label>
        </div>
        <div class="days">
          {#each DAYS as day, index}
            <label>
              <input type="checkbox" checked={(draft.schedule.days ?? []).includes(index)}
                onchange={(event) => toggleDay(index, event.target.checked)} />
              {day}
            </label>
          {/each}
        </div>
        <small>No days selected = every day.</small>
      </fieldset>
    {/if}

    {#each fields as field (field.path)}
      <label>
        {#if field.type === 'checkbox'}
          <input type="checkbox" checked={Boolean(value(field.path))}
            onchange={(event) => update(field.path, event.target.checked)} />
          {field.label ?? field.path}
        {:else if field.type === 'textarea'}
          {field.label ?? field.path}
          <textarea rows={field.rows ?? 5} placeholder={field.placeholder} spellcheck="false"
            value={value(field.path)} oninput={(event) => update(field.path, event.target.value)}></textarea>
        {:else if field.type === 'select'}
          {field.label ?? field.path}
          <select value={value(field.path)} onchange={(event) => update(field.path, event.target.value)}>
            {#each field.options ?? [] as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        {:else}
          {field.label ?? field.path}
          <input type={field.type === 'password' ? 'password' : field.type ?? 'text'} placeholder={field.placeholder}
            autocomplete="off" value={value(field.path)}
            oninput={(event) => update(field.path, field.type === 'number' ? Number(event.target.value) : event.target.value)} />
        {/if}
        {#if field.help && field.type !== 'checkbox'}<small>{field.help}</small>{/if}
      </label>
    {/each}

    {@render extra?.({ draft, update })}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <button class="secondary" onclick={() => dialog.close()}>Cancel</button>
      <button onclick={save}>Save</button>
    </footer>
  </article>
</dialog>

<style>
  dialog article {
    width: min(44rem, 92vw);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .row {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }
  .days {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .error {
    color: var(--pico-del-color);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
