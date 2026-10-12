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

<dialog bind:this={dialog} class="wide-dialog">
  <article>
    <header class="card__header">
      <h2>Settings</h2>
      <span class="card__header-tools">
        <button class="outline secondary icon-button" aria-label="Close" onclick={() => dialog.close()}>&times;</button>
      </span>
    </header>

    <div class="settings-body">
      {#if notice}<p class="hint">{notice}</p>{/if}

      {#if schedule}
        <section class="settings-section">
          <h3>Schedule</h3>
          <div class="settings-row">
            <span>Enabled</span>
            <input type="checkbox" checked={Boolean(draft.schedule.enabled)}
              onchange={(event) => (draft.schedule.enabled = event.target.checked)} />
          </div>
          <div class="settings-row">
            <span>Catch up missed runs</span>
            <input type="checkbox" checked={draft.schedule.catchUp !== false}
              onchange={(event) => (draft.schedule.catchUp = event.target.checked)} />
          </div>
          <div class="field">
            <span class="field__label">At</span>
            <input type="time" value={draft.schedule.at ?? '03:00'}
              oninput={(event) => (draft.schedule.at = event.target.value)} />
          </div>
          <p class="hint">No days selected = every day.</p>
          <div class="settings-days">
            {#each DAYS as day, index}
              <label>
                <input type="checkbox" checked={(draft.schedule.days ?? []).includes(index)}
                  onchange={(event) => toggleDay(index, event.target.checked)} />
                {day}
              </label>
            {/each}
          </div>
        </section>
      {/if}

      {#each fields as field (field.path)}
        <div class="field">
          {#if field.type === 'checkbox'}
            <label>
              <input type="checkbox" checked={Boolean(value(field.path))}
                onchange={(event) => update(field.path, event.target.checked)} />
              {field.label ?? field.path}
            </label>
          {:else}
            <span class="field__label">{field.label ?? field.path}</span>
            {#if field.type === 'textarea'}
              <textarea rows={field.rows ?? 5} placeholder={field.placeholder} spellcheck="false" class={field.className}
                value={value(field.path)} oninput={(event) => update(field.path, event.target.value)}></textarea>
            {:else if field.type === 'select'}
              <select value={value(field.path)} onchange={(event) => update(field.path, event.target.value)}>
                {#each field.options ?? [] as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            {:else}
              <input type={field.type === 'password' ? 'password' : field.type ?? 'text'} placeholder={field.placeholder}
                autocomplete="off" value={value(field.path)}
                oninput={(event) => update(field.path, field.type === 'number' ? Number(event.target.value) : event.target.value)} />
            {/if}
            {#if field.help}<p class="hint">{field.help}</p>{/if}
          {/if}
        </div>
      {/each}

      {@render extra?.({ draft, update })}

      {#if error}<p class="form-error">{error}</p>{/if}
    </div>

    <div class="dialog-actions">
      <button class="outline secondary" onclick={() => dialog.close()}>Cancel</button>
      <button onclick={save}>Save</button>
    </div>
  </article>
</dialog>
