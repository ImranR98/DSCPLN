<script>
  import { Shell, postJson } from '@dscpln/ui-kit'

  const FIELDS = [
    {
      path: 'musicDir',
      label: 'Music folder',
      type: 'text',
      help: 'Downloads and the playlist .m3u8 files land here (e.g. ~/Main/Media/Music).',
    },
    {
      path: 'browserJson',
      label: 'browser.json contents',
      type: 'textarea',
      rows: 10,
      help: 'Paste the JSON from ytmusicapi’s browser.json (headers from a logged-in music.youtube.com session). It is stored on the app’s PVC and rewritten before every run.',
    },
  ]

  let testStatus = $state({ text: '', tone: '' })
  let testing = $state(false)

  async function testAuth(draft) {
    testing = true
    testStatus = { text: 'Testing…', tone: '' }
    try {
      const result = await postJson('api/test-auth', { browserJson: draft.browserJson })
      testStatus = { text: `Auth OK — ${result.playlists} playlist(s) visible.`, tone: 'ok' }
    } catch (err) {
      testStatus = { text: err.message, tone: 'error' }
    } finally {
      testing = false
    }
  }
</script>

{#snippet settingsExtra({ draft })}
  <section>
    <h3>Authentication</h3>
    <p><small>If runs start failing with "expired", log in to music.youtube.com again and paste fresh headers.</small></p>
    <button class="secondary" disabled={testing} onclick={() => testAuth($state.snapshot(draft))} data-testid="test-auth">
      Test auth
    </button>
    {#if testStatus.text}
      <p class={testStatus.tone === 'ok' ? 'status-ok' : testStatus.tone === 'error' ? 'error' : ''}>{testStatus.text}</p>
    {/if}
  </section>
{/snippet}

<Shell
  name="YTMusic Downloads"
  fields={FIELDS}
  settingsNotice="The downloader writes browser.json into its working directory, runs ytmusic_dl.py, then validate_m3u8s.sh."
  settingsExtra={settingsExtra}
/>

<style>
  .error {
    color: var(--pico-del-color);
  }
</style>
