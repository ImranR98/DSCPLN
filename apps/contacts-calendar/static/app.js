'use strict'

// Contacts + Calendar settings page: schedule + Nextcloud credentials, plus a
// Discover workflow that lists the user's address books / calendars with
// per-collection enable + filename controls.
;(function () {
    const { el, requestJson } = window.DSCPLN

    function renderCollections(container, config) {
        container.textContent = ''
        const collections = config.collections ?? []
        if (collections.length === 0) {
            container.append(el('p', { class: 'hint', text: 'Press Discover to list address books and calendars from Nextcloud.' }))
            return
        }
        for (const [index, collection] of collections.entries()) {
            const row = el('div', { class: 'collection-row' },
                el('sl-checkbox', {
                    checked: Boolean(collection.enabled),
                    dataset: { path: `collections.${index}.enabled`, type: 'checkbox' },
                }),
                el('span', { class: 'collection-row__name' },
                    el('strong', { text: collection.displayName || collection.href }),
                    el('span', { class: 'muted', text: ` · ${collection.type === 'addressbook' ? 'address book' : 'calendar'}` })),
                el('sl-input', {
                    size: 'small',
                    value: collection.filename ?? '',
                    dataset: { path: `collections.${index}.filename`, type: 'text' },
                    placeholder: collection.type === 'addressbook' ? 'Contacts.vcf' : 'Calendar.ics',
                }))
            container.append(row)
        }
    }

    const shell = window.DSCPLNShell.mount({
        name: 'Contacts + Calendar',
        showRun: true,
        fields: [
            { path: 'nextcloudUrl', label: 'Nextcloud URL', type: 'text', help: 'In-cluster address, e.g. http://nextcloud:80' },
            { path: 'username', label: 'Username', type: 'text' },
            { path: 'appPassword', label: 'App password', type: 'password', help: 'Create a device password in Nextcloud → Personal settings → Security.' },
            { path: 'destination', label: 'Destination folder', type: 'text', help: 'Exports are written here and git-committed.' },
            { path: 'git.enabled', label: 'Git commit after export', type: 'checkbox' },
            { path: 'git.message', label: 'Custom commit message', type: 'text' },
        ],
        settingsNotice: 'Discover lists your Nextcloud collections; enable the ones to export and pick their file names. Save to apply.',
        settingsExtra(container, config) {
            const section = el('section', { class: 'settings-section' },
                el('h3', { text: 'Collections' }))
            const list = el('div', { class: 'collection-list' })
            const status = el('p', { class: 'hint', text: '' })
            const discover = el('sl-button', { size: 'small' }, 'Discover')
            const header = el('div', { class: 'settings-row' },
                el('span', { class: 'muted', text: 'Address books and calendars' }),
                discover)
            section.append(header, list, status)
            container.append(section)

            const render = () => renderCollections(list, config)
            discover.addEventListener('click', async () => {
                discover.disabled = true
                status.className = 'hint'
                status.textContent = 'Discovering…'
                try {
                    const current = window.DSCPLNShell.readForm(container, config)
                    const { collections } = await requestJson('api/discover', {
                        method: 'POST',
                        body: JSON.stringify({
                            nextcloudUrl: current.nextcloudUrl,
                            username: current.username,
                            appPassword: current.appPassword,
                            collections: current.collections,
                        }),
                    })
                    config.collections = collections
                    render()
                    status.textContent = `${collections.length} collection${collections.length === 1 ? '' : 's'} found. Enable the ones to export, then Save.`
                } catch (err) {
                    status.className = 'form-error'
                    status.textContent = err.message
                } finally {
                    discover.disabled = false
                }
            })
            render()
        },
        onState() {},
    })

    document.body.classList.remove('is-loading')
    shell.refresh()
})()
