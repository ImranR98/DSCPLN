'use strict'

// Settings: show the external API token, copy it, or regenerate it.
const { requestJson, initTheme, showToast } = DSCPLN

const els = {
    themeButton: document.getElementById('themeButton'),
    tokenInput: document.getElementById('apiTokenInput'),
    copyButton: document.getElementById('copyTokenButton'),
    regenerateButton: document.getElementById('regenerateTokenButton'),
    example: document.getElementById('apiExample'),
    listExample: document.getElementById('listExample'),
    scoreExample: document.getElementById('scoreExample'),
    reference: document.getElementById('apiReference'),
    copyReferenceButton: document.getElementById('copyReferenceButton'),
    toasts: document.getElementById('toasts'),
}

const toast = (message, type = 'success') => showToast(els.toasts, message, type)

/* ---------- API reference export ---------- */

const cleanText = (value) => value.replace(/\s+/g, ' ').trim()

// Renders inline markup (code pills) as backticks.
const inlineMarkdown = (node) => [...node.childNodes].map((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
        return child.textContent
    }
    if (child.tagName === 'CODE') {
        return `\`${child.textContent}\``
    }
    return inlineMarkdown(child)
}).join('')

const tableMarkdown = (table) => {
    const rows = [...table.rows].map((row) => [...row.cells].map((cell) => cleanText(inlineMarkdown(cell))))
    return [
        `| ${rows[0].join(' | ')} |`,
        `| ${rows[0].map(() => '---').join(' | ')} |`,
        ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
    ].join('\n')
}

// Serializes the visible reference card, swapping the live token for a
// placeholder so the copied Markdown is safe to share.
const referenceMarkdown = () => {
    const blocks = [...els.reference.children]
        .filter((node) => node.matches('h3, p, pre, table'))
        .map((node) => {
            if (node.tagName === 'H3') {
                return `## ${cleanText(node.textContent)}`
            }
            if (node.tagName === 'PRE') {
                return `\`\`\`sh\n${node.textContent.trim()}\n\`\`\``
            }
            if (node.tagName === 'TABLE') {
                return tableMarkdown(node)
            }
            return cleanText(inlineMarkdown(node))
        })
    const markdown = `# D$CPLN API reference\n\n${blocks.join('\n\n')}\n`
    const token = els.tokenInput.value
    return token ? markdown.replaceAll(token, '$API_TOKEN') : markdown
}

const exampleText = (token) => `curl -X POST ${location.origin}/api/transactions \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":-12.34,"details":"Groceries","currency":"CAD","category":"Food Weekly"}'`

const listExampleText = () => `curl ${location.origin}/api/categories \\
  -H "Authorization: Bearer $API_TOKEN"`

const scoreExampleText = () => `curl -G ${location.origin}/api/categories \\
  -H "Authorization: Bearer $API_TOKEN" \\
  --data-urlencode "details=Coffee beans" \\
  --data-urlencode "kind=expense"`

function show(token) {
    els.tokenInput.value = token
    els.example.textContent = exampleText(token)
    els.listExample.textContent = listExampleText()
    els.scoreExample.textContent = scoreExampleText()
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

els.copyReferenceButton.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(referenceMarkdown())
        toast('API reference copied as Markdown')
    } catch (e) {
        console.error(e)
        toast('Could not copy the API reference', 'error')
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
