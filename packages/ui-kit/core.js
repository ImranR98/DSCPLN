'use strict'

// Shared browser primitives for every D$CPLN app: base-path-aware URLs, DOM
// building, JSON requests, dates, formatters, money, theme and toasts.
//
// Browser usage: one global, `DSCPLN.*` (loaded before every other script).
// Node usage: `require('@dscpln/ui-kit/core')` (used by insights-math for dates).
//
// All fetch/EventSource/asset URLs must go through `apiUrl()` so the apps work
// both at the host root (local dev) and under a BASE_PATH prefix.
;(function (global) {
    /* ---------- Base path ---------- */

    // The prefix the app is served under: '' at the root, '/media' in k8s.
    const basePath = (() => {
        const injected = global.DSCPLN_BASE
        if (typeof injected === 'string') {
            return injected === '/' ? '' : injected.replace(/\/+$/, '')
        }
        return ''
    })()

    // Resolves `path` against the document base (which the server injects as
    // `<base href="<basePath>/">`); falls back to the injected base path.
    const apiUrl = (path) => {
        const raw = String(path == null ? '' : path)
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
            return raw
        }
        const clean = raw.replace(/^\/+/, '')
        if (typeof document !== 'undefined' && document.baseURI) {
            return new URL(clean, document.baseURI).toString()
        }
        return `${basePath}/${clean}`
    }

    /* ---------- Dates ---------- */

    const DAY_MS = 24 * 60 * 60 * 1000

    const dates = {
        parseIso(value) {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value))
            if (!match) {
                return null
            }
            const [year, month, day] = match.slice(1).map(Number)
            const date = new Date(year, month - 1, day)
            return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
        },
        iso(date) {
            const pad = (value) => String(value).padStart(2, '0')
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        },
        sameDay(a, b) {
            return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
        },
        startOfDay(date) {
            return new Date(date.getFullYear(), date.getMonth(), date.getDate())
        },
        addDays(date, days) {
            return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
        },
        startOfMonth(date) {
            return new Date(date.getFullYear(), date.getMonth(), 1)
        },
        endOfMonth(date) {
            return new Date(date.getFullYear(), date.getMonth() + 1, 0)
        },
        daysBetween(start, end) {
            return Math.round((end - start) / DAY_MS) + 1
        },
    }

    /* ---------- Formatters ---------- */

    const formats = {
        monthShort: new Intl.DateTimeFormat(undefined, { month: 'short' }),
        monthYear: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }),
        monthName: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }),
        weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        dayMonth: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
        time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
        year: new Intl.DateTimeFormat(undefined, { year: 'numeric' }),
        compact: new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }),
    }

    const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const formatTime = (ms) => (Number.isFinite(ms) ? timeFormat.format(new Date(ms)) : '—')
    const formatDateTime = (ms) => (Number.isFinite(ms) ? dateTimeFormat.format(new Date(ms)) : '—')

    const formatDuration = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '—'
        }
        if (seconds < 60) {
            return `${Math.round(seconds)}s`
        }
        if (seconds < 3600) {
            return `${Math.round(seconds / 60)}m`
        }
        return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`
    }

    const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    const formatBytes = (value) => {
        let n = Number(value)
        if (!Number.isFinite(n)) {
            return '—'
        }
        let i = 0
        while (n >= 1024 && i < BYTE_UNITS.length - 1) {
            n /= 1024
            i += 1
        }
        return `${n.toFixed(i === 0 ? 0 : 1)} ${BYTE_UNITS[i]}`
    }

    const humanAgo = (ms) => {
        const delta = (Date.now() - Number(ms)) / 1000
        if (!Number.isFinite(delta)) return '—'
        if (delta < 60) return 'just now'
        if (delta < 3600) return `${Math.floor(delta / 60)} min ago`
        if (delta < 86400) return `${Math.floor(delta / 3600)} hr ago`
        if (delta < 30 * 86400) return `${Math.floor(delta / 86400)} days ago`
        if (delta < 365 * 86400) return `${Math.floor(delta / (30 * 86400))} months ago`
        return `${Math.floor(delta / (365 * 86400))} years ago`
    }

    /* ---------- Numbers and money ---------- */

    const number = (value) => {
        const parsed = Number.parseFloat(value)
        return Number.isFinite(parsed) ? parsed : 0
    }

    // Trims floating point noise without forcing a fixed number of decimals.
    const clean = (value) => Number.parseFloat(Number(value).toPrecision(12))

    const moneyFormatters = new Map()

    // Enough decimals to keep `significantDigits` significant, at least 2 and
    // at most 12, without excessive trailing zeros.
    const fractionDigits = (value, significantDigits) => {
        const absolute = Math.abs(value)
        if (!Number.isFinite(absolute) || absolute === 0) {
            return 2
        }
        return Math.min(12, Math.max(2, significantDigits - 1 - Math.floor(Math.log10(absolute))))
    }

    // Returns a `money(value, code)` formatter whose precision follows whether
    // the currency needs sub-cent digits (e.g. XMR). `symbolFor` supplies the
    // currency's symbol; currencies without one render with no prefix (their
    // code is shown elsewhere in the UI).
    const moneyFor = (isFractional, symbolFor = () => null) => (value, code) => {
        const amount = Number.isFinite(value) ? value : 0
        const decimals = isFractional(code) ?
            fractionDigits(amount, 12) :
            (Math.abs(amount) < 1 ? fractionDigits(amount, 8) : 2)
        let formatter = moneyFormatters.get(decimals)
        if (!formatter) {
            formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals })
            moneyFormatters.set(decimals, formatter)
        }
        const symbol = (code && symbolFor(code)) || ''
        return `${amount < 0 ? '−' : ''}${symbol}${formatter.format(Math.abs(amount))}`
    }

    /* ---------- Currency colors ---------- */

    const CURRENCY_COLORS = {
        CAD: '#dc2626',
        USD: '#16a34a',
        GBP: '#2563eb',
        TZS: '#d4a017',
        XMR: '#ea7a1a',
    }
    const FALLBACK_COLORS = ['#7c3aed', '#0891b2', '#db2777', '#65a30d', '#9333ea', '#0d9488', '#f59e0b', '#4f46e5']

    const colorFrom = (palette, key) => {
        let hash = 0
        for (const char of String(key)) {
            hash = (hash * 31 + char.charCodeAt(0)) >>> 0
        }
        return palette[hash % palette.length]
    }

    // Stable accent per currency (known codes get hand-picked colors).
    const currencyColor = (code) => (code ? CURRENCY_COLORS[code] || colorFrom(FALLBACK_COLORS, code) : null)

    // Inserts <wbr> after thousands separators, the decimal point and every
    // third fraction digit, so long money values wrap at sensible points.
    const setBreakableText = (element, text) => {
        element.textContent = ''
        let start = 0
        let inFraction = false
        let sinceBreak = 0
        const addBreak = (index) => {
            element.append(document.createTextNode(text.slice(start, index + 1)))
            element.append(document.createElement('wbr'))
            start = index + 1
        }
        for (let i = 0; i < text.length; i++) {
            const char = text[i]
            if (char === ',' || char === '.') {
                inFraction = char === '.'
                sinceBreak = 0
                addBreak(i)
            } else if (inFraction && char >= '0' && char <= '9') {
                sinceBreak += 1
                if (sinceBreak === 3) {
                    sinceBreak = 0
                    addBreak(i)
                }
            }
        }
        element.append(document.createTextNode(text.slice(start)))
    }

    /* ---------- DOM building ---------- */

    // el('span', { class: 'muted', text: 'Hi' }, childNode, 'more text')
    const el = (tag, props, ...children) => {
        const node = document.createElement(tag)
        for (const [key, value] of Object.entries(props || {})) {
            if (value == null) {
                continue
            }
            if (key === 'class') {
                node.className = value
            } else if (key === 'text') {
                node.textContent = value
            } else if (key === 'html') {
                node.innerHTML = value
            } else if (key === 'dataset') {
                Object.assign(node.dataset, value)
            } else if (key === 'style') {
                for (const [prop, styleValue] of Object.entries(value)) {
                    if (styleValue == null) {
                        continue
                    }
                    if (prop.startsWith('--')) {
                        node.style.setProperty(prop, styleValue)
                    } else {
                        node.style[prop] = styleValue
                    }
                }
            } else if (key.startsWith('on') && typeof value === 'function') {
                node.addEventListener(key.slice(2).toLowerCase(), value)
            } else if (key in node) {
                node[key] = value
            } else {
                node.setAttribute(key, value)
            }
        }
        for (const child of children.flat()) {
            if (child == null || child === false) {
                continue
            }
            node.append(child instanceof Node ? child : document.createTextNode(String(child)))
        }
        return node
    }

    /* ---------- JSON requests ---------- */

    // Fetches JSON; on failure throws an Error carrying the server's `error`
    // message when available (and `status` for callers that special-case it).
    const requestJson = async (url, options = {}) => {
        const headers = { Accept: 'application/json' }
        if (options.body) {
            headers['Content-Type'] = 'application/json'
        }
        const response = await fetch(apiUrl(url), { ...options, headers: { ...headers, ...options.headers } })
        const text = await response.text().catch(() => '')
        if (!response.ok) {
            let message = text.trim() || `Request failed (${response.status})`
            try {
                const parsed = JSON.parse(text)
                if (parsed && typeof parsed.error === 'string') {
                    message = parsed.error
                }
            } catch (e) { }
            const error = new Error(message)
            error.status = response.status
            throw error
        }
        return text ? JSON.parse(text) : null
    }

    /* ---------- Theme and toasts ---------- */

    const THEME_KEY = 'dscpln-theme'
    const THEME_ORDER = ['auto', 'light', 'dark']
    const THEME_ICONS = {
        auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
        light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
        dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    }
    const TOAST_ICONS = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 12v4M12 8h.01"/></svg>',
    }
    const stroke = ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
    const ICONS = {
        pause: `<svg viewBox="0 0 24 24"${stroke}><path d="M8 5v14M16 5v14"/></svg>`,
        play: `<svg viewBox="0 0 24 24"${stroke}><path d="M7 4.5 19 12 7 19.5z"/></svg>`,
        dry: `<svg viewBox="0 0 24 24"${stroke}><path d="M9 3h6"/><path d="M10 3v6l-5.2 9.3A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 1.8-2.7L14 9V3"/></svg>`,
        archive: `<svg viewBox="0 0 24 24"${stroke}><path d="M3 7h18v13H3z"/><path d="M2 4h20v3H2z"/><path d="M10 12h4"/></svg>`,
        trash: `<svg viewBox="0 0 24 24"${stroke}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>`,
        settings: `<svg viewBox="0 0 24 24"${stroke}><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24"${stroke}><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>`,
        bolt: `<svg viewBox="0 0 24 24"${stroke}><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>`,
        retry: `<svg viewBox="0 0 24 24"${stroke}><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/></svg>`,
        restore: `<svg viewBox="0 0 24 24"${stroke}><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/></svg>`,
        wrench: `<svg viewBox="0 0 24 24"${stroke}><path d="M14.7 6.3a4.6 4.6 0 0 0-6.1 6.1L3 18l3 3 5.6-5.6a4.6 4.6 0 0 0 6.1-6.1l-3 3-3-3z"/></svg>`,
        calendar: `<svg viewBox="0 0 24 24"${stroke}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>`,
        import: `<svg viewBox="0 0 24 24"${stroke}><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`,
        plus: `<svg viewBox="0 0 24 24"${stroke}><path d="M12 5v14M5 12h14"/></svg>`,
        close: `<svg viewBox="0 0 24 24"${stroke}><path d="M6 6l12 12M18 6 6 18"/></svg>`,
        edit: `<svg viewBox="0 0 24 24"${stroke}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
        delete: `<svg viewBox="0 0 24 24"${stroke}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>`,
    }

    // Cycles the theme button auto -> light -> dark and applies the stored
    // choice immediately.
    const initTheme = (button) => {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')
        let theme = 'auto'
        try {
            const stored = localStorage.getItem(THEME_KEY)
            theme = THEME_ORDER.includes(stored) ? stored : 'auto'
        } catch (e) { }
        const apply = () => {
            const dark = theme === 'dark' || (theme === 'auto' && prefersDark.matches)
            document.documentElement.dataset.theme = dark ? 'dark' : 'light'
            document.documentElement.classList.toggle('sl-theme-dark', dark)
            button.innerHTML = THEME_ICONS[theme]
            button.title = `Theme: ${theme}`
            button.setAttribute('aria-label', `Theme: ${theme}. Click to change.`)
        }
        button.addEventListener('click', () => {
            theme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
            try {
                localStorage.setItem(THEME_KEY, theme)
            } catch (e) { }
            apply()
        })
        prefersDark.addEventListener('change', () => {
            if (theme === 'auto') {
                apply()
            }
        })
        apply()
    }

    const showToast = (container, message, type = 'success') => {
        const host = typeof container === 'string' ? document.querySelector(container) : container
        if (!host) {
            return null
        }
        const toastEl = document.createElement('div')
        toastEl.className = `toast toast--${type}`
        toastEl.setAttribute('role', 'status')
        const icon = document.createElement('span')
        icon.className = 'toast__icon'
        icon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.success
        const text = document.createElement('span')
        text.textContent = message
        toastEl.append(icon, text)
        host.appendChild(toastEl)
        window.setTimeout(() => {
            toastEl.classList.add('toast--leaving')
            window.setTimeout(() => toastEl.remove(), 350)
        }, 3500)
        return toastEl
    }

    // Standard toast host every page should have: <div id="toasts" class="toasts">.
    const toast = (message, type = 'success') => showToast(document.getElementById('toasts'), message, type)

    const api = {
        basePath,
        apiUrl,
        dates,
        formats,
        number,
        clean,
        moneyFor,
        fractionDigits,
        colorFrom,
        currencyColor,
        icons: ICONS,
        formatBytes,
        formatTime,
        formatDateTime,
        formatDuration,
        humanAgo,
        setBreakableText,
        el,
        requestJson,
        initTheme,
        showToast,
        toast,
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api
    }
    global.DSCPLN = api
})(typeof window !== 'undefined' ? window : globalThis)
