'use strict'

// Monthly budget-limit notifications over an ntfy-compatible endpoint.

const axios = require('axios')

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

const startNotifications = (config, dataProvider) => {
    const { monthlyLimitUrl, ntfyToken, checkIntervalMinutes } = config.notifications
    const onlyWarnOnce = config.notifications.onlyWarnOnce !== false
    if (!monthlyLimitUrl) {
        return
    }
    const authHeader = ntfyToken ? `Basic ${Buffer.from(`:${ntfyToken}`).toString('base64')}` : null
    const intervalMs = Math.max(1, checkIntervalMinutes || 30) * 60 * 1000
    const warnedCurrencies = new Set()
    const previousSpend = new Map()

    const send = async (message, title) => {
        try {
            await axios.post(monthlyLimitUrl, message, {
                headers: { Title: title, Authorization: authHeader },
                timeout: 10000,
            })
            return true
        } catch (e) {
            console.error(`Failed to send notification: ${e.message}`)
            return false
        }
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
                        `Monthly Budget Limit Reached (${entry.code})`)
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

module.exports = { startNotifications }
