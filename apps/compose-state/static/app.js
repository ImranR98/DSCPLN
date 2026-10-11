'use strict'

// Infra Compose State: targets + SSH key in Settings, archive list in a card.
;(function () {
    const { el, requestJson, formatBytes, formatDateTime, toast } = window.DSCPLN

    function renderTargets(container, config) {
        container.textContent = ''
        const targets = config.targets ?? []
        targets.forEach((target, index) => {
            const row = el('div', { class: 'target-row' },
                el('sl-input', { size: 'small', value: target.name ?? '', placeholder: 'name', dataset: { path: `targets.${index}.name`, type: 'text' } }),
                (() => {
                    const select = el('sl-select', { size: 'small', value: target.mode ?? 'local', dataset: { path: `targets.${index}.mode`, type: 'text' } },
                        el('sl-option', { value: 'local' }, 'local'),
                        el('sl-option', { value: 'ssh' }, 'ssh'))
                    return select
                })(),
                el('sl-input', { size: 'small', value: target.host ?? '', placeholder: 'host (ssh)', dataset: { path: `targets.${index}.host`, type: 'text' } }),
                el('sl-input', { size: 'small', value: target.path ?? '', placeholder: 'path to compose_live_state', dataset: { path: `targets.${index}.path`, type: 'text' } }),
                el('sl-button', {
                    size: 'small', variant: 'danger', class: 'target-row__remove', title: 'Remove target',
                    onclick: () => {
                        config.targets.splice(index, 1)
                        renderTargets(container, config)
                    },
                }, '✕'))
            container.append(row)
        })
        container.append(el('sl-button', {
            size: 'small',
            onclick: () => {
                config.targets = [...(config.targets ?? []), { name: '', mode: 'local', host: '', path: '' }]
                renderTargets(container, config)
            },
        }, 'Add target'))
    }

    const shell = window.DSCPLNShell.mount({
        name: 'Infra Compose State',
        fields: [
            { path: 'destination', label: 'Destination folder', type: 'text', help: 'Archives land here (e.g. ~/Main/Infra/compose_state_backups).' },
            { path: 'retention', label: 'Retention (archives kept per target)', type: 'number' },
        ],
        settingsNotice: 'Local targets run on srv0; SSH targets stream the archive from the remote host. Retention keeps the newest N archives per target.',
        settingsExtra(container, config) {
            const targets = el('div', { class: 'target-list' })
            container.append(el('section', { class: 'settings-section' },
                el('h3', { text: 'Targets' }),
                targets))
            renderTargets(targets, config)

            const keyBlock = el('pre', { class: 'code-block key-block', text: config.sshPublicKey || '(no key yet)' })
            const regenerate = el('sl-button', { size: 'small', variant: 'warning' }, 'Regenerate key')
            regenerate.addEventListener('click', async () => {
                regenerate.disabled = true
                try {
                    const { sshPublicKey } = await requestJson('api/key/regenerate', { method: 'POST', body: '{}' })
                    config.sshPublicKey = sshPublicKey
                    keyBlock.textContent = sshPublicKey
                    toast('New SSH key generated — authorize it on vps0')
                } catch (err) {
                    toast(err.message, 'error')
                } finally {
                    regenerate.disabled = false
                }
            })
            container.append(el('section', { class: 'settings-section' },
                el('h3', { text: 'SSH key' }),
                el('p', { class: 'hint', text: 'Add this public key to ~/.ssh/authorized_keys on vps0 (the app stores the private half on its PVC).' }),
                keyBlock,
                el('div', { class: 'settings-row' }, el('span'), regenerate)))
        },
    })

    /* Archives card */
    const list = el('div', { class: 'archive-list' })
    const destinationLabel = el('span', { class: 'card__context' })
    const refreshButton = el('sl-button', { size: 'small', class: 'icon-button', title: 'Refresh archives' })
    refreshButton.innerHTML = window.DSCPLN.icons.refresh
    const card = el('section', { class: 'card', id: 'archivesCard' },
        el('div', { class: 'card__header' },
            el('h2', { text: 'Archives' }),
            el('span', { class: 'card__header-tools' }, destinationLabel, refreshButton)),
        list)
    document.querySelector('main')?.append(card)

    async function refreshArchives() {
        try {
            const { destination, entries } = await requestJson('api/archives')
            destinationLabel.textContent = destination
            list.textContent = ''
            if (!entries.length) {
                list.append(el('p', { class: 'muted', text: 'No archives yet.' }))
                return
            }
            for (const entry of entries) {
                list.append(el('div', { class: 'archive-row' },
                    el('span', { class: 'archive-row__name', text: entry.name }),
                    el('span', { class: 'muted', text: entry.target }),
                    el('span', { class: 'muted', text: formatBytes(entry.size) }),
                    el('span', { class: 'muted', text: formatDateTime(entry.mtime) })))
            }
        } catch (err) {
            list.textContent = err.message
        }
    }
    refreshButton.addEventListener('click', refreshArchives)

    shell.refresh().then(refreshArchives)
    setInterval(refreshArchives, 30_000)
})()
