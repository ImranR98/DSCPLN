'use strict'

// Settings: show the external API token, copy it, or regenerate it.
const { requestJson, initTheme, showToast } = DSCPLN

const els = {
    themeButton: document.getElementById('themeButton'),
    tokenInput: document.getElementById('apiTokenInput'),
    copyButton: document.getElementById('copyTokenButton'),
    regenerateButton: document.getElementById('regenerateTokenButton'),
    example: document.getElementById('apiExample'),
    editExample: document.getElementById('editExample'),
    toasts: document.getElementById('toasts'),
}

const toast = (message, type = 'success') => showToast(els.toasts, message, type)

const exampleText = (token) => `curl -X POST ${location.origin}/api/transactions \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":-12.34,"details":"Groceries","currency":"CAD"}'`

const editExampleText = () => `curl -X PATCH ${location.origin}/api/transactions/$EDIT_TOKEN \\
  -H "Authorization: Bearer $API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"category":"Food Weekly"}'`

function show(token) {
    els.tokenInput.value = token
    els.example.textContent = exampleText(token)
    els.editExample.textContent = editExampleText()
}

async function load() {
    try {
        const { token } = await requestJson('/token')
        show(token)
    } catch (e) {
        console.error(e)
        toast('Could not load the API token', 'error')
    } finally {
        document.body.classList.remove('is-loading')
    }
}

els.copyButton.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(els.tokenInput.value)
        toast('Token copied')
    } catch (e) {
        els.tokenInput.select()
        toast('Press Ctrl/Cmd+C to copy the selected token', 'error')
    }
})

els.regenerateButton.addEventListener('click', async () => {
    if (!window.confirm('Regenerate the API token? The current token will stop working.')) {
        return
    }
    els.regenerateButton.disabled = true
    try {
        const { token } = await requestJson('/token/regenerate', { method: 'POST', body: '{}' })
        show(token)
        toast('API token regenerated')
    } catch (e) {
        console.error(e)
        toast('Could not regenerate the API token', 'error')
    } finally {
        els.regenerateButton.disabled = false
    }
})

initTheme(els.themeButton)
load()
