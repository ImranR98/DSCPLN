'use strict'

// Shared formatting helpers for the dashboard and insights pages. Loaded as a
// plain script (window.DSCPLNFormat) and also exported for Node tests.
;(function (global) {
    const CURRENCY_ACCENTS = {
        CAD: '#dc2626',
        USD: '#16a34a',
        GBP: '#2563eb',
        TZS: '#d4a017',
        XMR: '#ea7a1a',
    }
    const FALLBACK_ACCENTS = ['#7c3aed', '#0891b2', '#db2777', '#65a30d', '#9333ea', '#0d9488', '#f59e0b', '#4f46e5']
    const moneyFormatters = new Map()

    // Shows at least 2 decimals and enough more to keep the value's significant
    // digits (e.g. fractional XMR), without excessive trailing zeros.
    function fractionDigitsFor(value, significantDigits) {
        const absolute = Math.abs(value)
        if (!Number.isFinite(absolute) || absolute === 0) {
            return 2
        }
        return Math.min(12, Math.max(2, significantDigits - 1 - Math.floor(Math.log10(absolute))))
    }

    function hasSubCentPrecision(value) {
        const amount = Number(value)
        return Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6
    }

    function money(value, code, isFractional) {
        const amount = Number.isFinite(value) ? value : 0
        const decimals = isFractional ?
            fractionDigitsFor(amount, 12) :
            (Math.abs(amount) < 1 ? fractionDigitsFor(amount, 8) : 2)
        let formatter = moneyFormatters.get(decimals)
        if (!formatter) {
            formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals })
            moneyFormatters.set(decimals, formatter)
        }
        return `$${formatter.format(amount)}`
    }

    // Deterministic accent per currency so cards, chips and chart lanes stay
    // recognizable; known currencies get hand-picked colors.
    function currencyColor(code) {
        if (!code) return null
        if (CURRENCY_ACCENTS[code]) return CURRENCY_ACCENTS[code]
        let hash = 0
        for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
        return FALLBACK_ACCENTS[hash % FALLBACK_ACCENTS.length]
    }

    // Inserts <wbr> after thousands separators, decimal points and every third
    // fraction digit, so long money values wrap at sensible points instead of
    // mid-digit when space is tight.
    function setBreakableText(element, text) {
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

    const api = { fractionDigitsFor, hasSubCentPrecision, money, currencyColor, setBreakableText }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api
    }
    global.DSCPLNFormat = api
})(typeof window !== 'undefined' ? window : globalThis)
