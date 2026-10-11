'use strict'

// YTMusic Downloads: music dir + pasted browser.json in Settings, with a
// "Test auth" button that asks ytmusicapi to fetch one playlist.
;(function () {
    const { el, requestJson } = window.DSCPLN

    window.DSCPLNShell.mount({
        name: 'YTMusic Downloads',
        fields: [
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
        ],
        settingsNotice: 'The downloader writes browser.json into its working directory, runs ytmusic_dl.py, then validate_m3u8s.sh.',
        settingsExtra(container, config) {
            const status = el('p', { class: 'hint' })
            const testButton = el('sl-button', { size: 'small', variant: 'primary' }, 'Test auth')
            testButton.addEventListener('click', async () => {
                testButton.disabled = true
                status.className = 'hint'
                status.textContent = 'Testing…'
                try {
                    const current = window.DSCPLNShell.readForm(container, config)
                    const result = await requestJson('api/test-auth', {
                        method: 'POST',
                        body: JSON.stringify({ browserJson: current.browserJson }),
                    })
                    status.className = 'msg ok'
                    status.textContent = `Auth OK — ${result.playlists} playlist(s) visible.`
                } catch (err) {
                    status.className = 'form-error'
                    status.textContent = err.message
                } finally {
                    testButton.disabled = false
                }
            })
            container.append(el('section', { class: 'settings-section' },
                el('h3', { text: 'Authentication' }),
                el('p', { class: 'hint', text: 'If runs start failing with "expired", log in to music.youtube.com again and paste fresh headers.' }),
                el('div', { class: 'settings-row' }, el('span'), testButton),
                status))
        },
    })
})()
