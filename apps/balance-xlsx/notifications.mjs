'use strict'

// Monthly budget-limit notifications over the portal relay, which owns the
// ntfy URL + token (DSCPLN_PORTAL_URL).

import { Notifier } from '@dscpln/server-kit'

// Plain (unformatted) compact amount for notification text: 2 decimals at
// least, more for values below 1.
const plainAmount = (value) => {
    const amount = Number.isFinite(value) ? value : 0
    const decimals = Math.abs(amount) >= 1 ? 2 :
        Math.min(12, Math.max(2, 7 - Math.floor(Math.log10(Math.abs(amount) || 1))))
    const [integerPart, fractionPart = ''] = amount.toFixed(decimals).split('.')
    const trimmed = fractionPart.replace(/0+$/, '')
    return `${integerPart}.${trimmed.length < 2 ? fractionPart.slice(0, 2) : trimmed}`
}

const startNotifications = (config, dataProvider, options = {}) => {
    const { checkIntervalMinutes } = config.notifications
    const onlyWarnOnce = config.notifications.onlyWarnOnce !== false
    const relayUrl = options.relayUrl ?? process.env.DSCPLN_PORTAL_URL ?? ''
    if (!relayUrl) {
        return
    }
    const origin = String(process.env.DSCPLN_ORIGIN ?? '').trim().replace(/\/+$/, '')
    const clickUrl = /^https?:\/\//i.test(origin) ? `${origin}/balance` : ''
    const notifier = new Notifier({
        app: 'Balance XLSX',
        relayUrl,
        click: clickUrl,
    }, (line) => console.error(line))
    const intervalMs = Math.max(1, checkIntervalMinutes || 30) * 60 * 1000
    const warnedCurrencies = new Set()
    const previousSpend = new Map()

    const send = async (message, title) => {
        const result = await notifier.notify(message, { title, priority: 'default', tags: ['warning'] })
        if (!result.ok) {
            console.error(`Failed to send notification: ${result.error}`)
            return false
        }
        return true
    }

    const checkLimits = async () => {
        try {
            const overview = await dataProvider.getData()
            for (const entry of overview.currencies || []) {
                if (!entry || entry.monthlyBudget <= 0) {
                    continue
                }
                const overBudget = entry.monthsSpend >= entry.monthlyBudget
                const alreadyWarned = warnedCurrencies.has(entry.code) && onlyWarnOnce
                const unchanged = entry.monthsSpend === previousSpend.get(entry.code)
                let settled = true
                if (overBudget && !alreadyWarned && !unchanged) {
                    const symbol = entry.symbol || ''
                    settled = await send(
                        `${entry.code} ${symbol}${plainAmount(entry.monthsSpend)} of ${symbol}${plainAmount(entry.monthlyBudget)}`,
                        `D$CPLN - Balance XLSX: ${entry.code} over budget`)
                    if (settled) {
                        warnedCurrencies.add(entry.code)
                    }
                } else if (!overBudget) {
                    warnedCurrencies.delete(entry.code)
                }
                // Only remember a spend level once its notification settled, so
                // a failed send is retried on the next check.
                if (settled) {
                    previousSpend.set(entry.code, entry.monthsSpend)
                }
            }
        } catch (e) {
            console.error(e)
        }
    }

    checkLimits()
    setInterval(checkLimits, intervalMs)
}

export { startNotifications }
