import { useState } from 'react'
import { Shell, postJson } from '@dscpln/ui-kit'

const FIELDS = [
  {
    path: 'musicDir',
    label: 'Music folder',
    type: 'text',
    help: 'Downloads and the playlist .m3u8 files land here (e.g. ~/Music).',
  },
  {
    path: 'browserJson',
    label: 'browser.json contents',
    type: 'textarea',
    rows: 10,
    className: 'mono',
    help: 'Paste the JSON from ytmusicapi’s browser.json (headers from a logged-in music.youtube.com session). It is stored on the app’s PVC and rewritten before every run.',
  },
  {
    path: 'notifySuccess',
    label: 'Notify when a run succeeds',
    type: 'checkbox',
    help: 'Failures always notify; notifications are sent through the portal’s ntfy settings.',
  },
]

export default function App() {
  const [testStatus, setTestStatus] = useState({ text: '', tone: '' })
  const [testing, setTesting] = useState(false)

  const testAuth = async (draft) => {
    setTesting(true)
    setTestStatus({ text: 'Testing…', tone: '' })
    try {
      const result = await postJson('api/test-auth', { browserJson: draft.browserJson })
      setTestStatus({ text: `Auth OK — ${result.playlists} playlist(s) visible.`, tone: 'ok' })
    } catch (err) {
      setTestStatus({ text: err.message, tone: 'error' })
    } finally {
      setTesting(false)
    }
  }

  const settingsExtra = ({ draft }) => (
    <section className="settings-section">
      <h3>Authentication</h3>
      <p className="hint">If runs start failing with "expired", log in to music.youtube.com again and paste fresh headers.</p>
      <div className="settings-row">
        <span></span>
        <button disabled={testing} onClick={() => testAuth(draft)} data-testid="test-auth">Test auth</button>
      </div>
      {testStatus.text ? (
        <p className={testStatus.tone === 'ok' ? 'msg ok' : testStatus.tone === 'error' ? 'form-error' : 'hint'}>{testStatus.text}</p>
      ) : null}
    </section>
  )

  return (
    <Shell
      name="YTMusic Downloads"
      fields={FIELDS}
      settingsNotice="The downloader writes browser.json into its working directory, runs ytmusic_dl.py, then validate_m3u8s.sh."
      settingsExtra={settingsExtra}
    />
  )
}
