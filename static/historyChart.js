'use strict'

// Shared monthly money in/out chart. Used by the dashboard (last 12 months)
// and by the insights page (the selected range). Months flagged `partial` are
// marked with an asterisk on the axis and noted below the chart.
//
// months: [{ year, month, partial?, currencies: { CODE: { spend, income,
//           convertedOut, convertedIn } } }]
;(function (global) {
    const { money, currencyColor, fractionDigitsFor } = DSCPLNFormat

    const SVG_NS = 'http://www.w3.org/2000/svg'
    const monthYearFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
    const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

    const toNumber = (value) => {
        const amount = Number.parseFloat(value)
        return Number.isFinite(amount) ? amount : 0
    }

    const svgElement = (tag, attributes = {}) => {
        const element = document.createElementNS(SVG_NS, tag)
        for (const [name, value] of Object.entries(attributes)) {
            element.setAttribute(name, value)
        }
        return element
    }

    const niceMax = (value) => {
        if (!Number.isFinite(value) || value <= 0) {
            return 0
        }
        const exponent = Math.floor(Math.log10(value))
        const base = 10 ** exponent
        const fraction = value / base
        const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
        return nice * base
    }

    const tickMoney = (value) => {
        const amount = Number.isFinite(value) ? value : 0
        const absolute = Math.abs(amount)
        if (absolute >= 1000) {
            return `$${compactNumberFormat.format(amount)}`
        }
        if (absolute >= 1) {
            return `$${Math.round(amount).toLocaleString()}`
        }
        const decimals = fractionDigitsFor(amount, 3)
        return `$${amount.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')}`
    }

    const historyMonthLabel = (entry, index) => {
        const date = new Date(entry.year, entry.month - 1, 1)
        const base = monthYearFormat.formatToParts(date).find((part) => part.type === 'month').value
        const label = index === 0 || entry.month === 1 ? `${base} '${String(entry.year).slice(-2)}` : base
        return entry.partial ? `${label}*` : label
    }

    const buildTooltip = (entry, activeCurrencies) => {
        const container = document.createElement('div')
        const title = document.createElement('strong')
        title.className = 'history-tooltip__title'
        title.textContent = entry.partial ?
            `${monthYearFormat.format(new Date(entry.year, entry.month - 1, 1))} (partial month)` :
            monthYearFormat.format(new Date(entry.year, entry.month - 1, 1))
        container.appendChild(title)
        for (const code of activeCurrencies) {
            const totals = entry.currencies[code] || { spend: 0, income: 0 }
            const row = document.createElement('div')
            row.className = 'history-tooltip__row'
            const codeEl = document.createElement('span')
            codeEl.className = 'history-tooltip__code'
            const dot = document.createElement('span')
            dot.className = 'history-tooltip__dot'
            const color = currencyColor(code)
            if (color) dot.style.background = color
            const codeText = document.createElement('span')
            codeText.textContent = code
            codeEl.append(dot, codeText)
            const outEl = document.createElement('span')
            outEl.className = 'history-tooltip__out'
            outEl.textContent = `${money(toNumber(totals.spend), code)} out`
            const inEl = document.createElement('span')
            inEl.className = 'history-tooltip__in'
            inEl.textContent = `+${money(toNumber(totals.income), code)} in`
            row.append(codeEl, outEl, inEl)
            container.appendChild(row)
            const convertedOut = toNumber(totals.convertedOut)
            const convertedIn = toNumber(totals.convertedIn)
            if (convertedOut > 0 || convertedIn > 0) {
                const converted = document.createElement('div')
                converted.className = 'history-tooltip__conv'
                const parts = []
                if (convertedOut > 0) {
                    parts.push(`−${money(convertedOut, code)}`)
                }
                if (convertedIn > 0) {
                    parts.push(`+${money(convertedIn, code)}`)
                }
                converted.textContent = `converted ${parts.join(' / ')}`
                container.appendChild(converted)
            }
        }
        return container
    }

    let measureHost = null
    const measureTextWidth = (text, className) => {
        const span = document.createElement('span')
        span.className = className
        span.textContent = text
        span.style.position = 'absolute'
        span.style.visibility = 'hidden'
        span.style.whiteSpace = 'nowrap'
        ;(measureHost || document.body).appendChild(span)
        const width = span.getBoundingClientRect().width
        span.remove()
        return width
    }

    const activeCodesFor = (months, codes) => {
        if (codes) {
            return codes.filter((code) => months.some((entry) => {
                const totals = entry.currencies && entry.currencies[code]
                return totals && (totals.spend > 0 || totals.income > 0 ||
                    totals.convertedOut > 0 || totals.convertedIn > 0)
            }))
        }
        const all = [...new Set(months.flatMap((entry) => Object.keys(entry.currencies || {})))]
        return all.filter((code) => months.some((entry) => {
            const totals = entry.currencies && entry.currencies[code]
            return totals && (totals.spend > 0 || totals.income > 0 ||
                totals.convertedOut > 0 || totals.convertedIn > 0)
        }))
    }

    const draw = (container, tooltipEl, months, active) => {
        const history = months
        const width = Math.max(240, Math.round(container.clientWidth || 720))
        const topPad = 6
        const laneHeight = 92
        const laneGap = 18
        const laneStride = laneHeight + laneGap
        const axisHeight = 26

        measureHost = container

        const laneMax = new Map()
        let maxTickWidth = 0
        for (const code of active) {
            const max = niceMax(Math.max(...history.map((entry) => {
                const totals = entry.currencies[code] || { spend: 0, income: 0 }
                return Math.max(totals.spend, totals.income)
            })))
            for (const factor of [0.5, 1]) {
                if (max > 0) {
                    maxTickWidth = Math.max(maxTickWidth, measureTextWidth(tickMoney(max * factor), 'history__tick'))
                }
            }
            laneMax.set(code, max)
        }

        // The Total column is capped (30% of the chart) so long fractional-currency
        // values can't shrink the plot. Values that don't fit wrap onto their own
        // line beneath the "out"/"in" label.
        const totalColumnCap = Math.max(84, Math.round(width * 0.3))
        const totalTextWidth = totalColumnCap - 12
        const totalLinesByCode = new Map()
        let maxTotalLineWidth = 0
        const breakTotalText = (text, className, maxWidth) => {
            if (measureTextWidth(text, className) <= maxWidth) return [text]
            const dotIndex = text.lastIndexOf('.')
            if (dotIndex > 0) {
                const whole = text.slice(0, dotIndex + 1)
                const fraction = text.slice(dotIndex + 1)
                if (measureTextWidth(whole, className) <= maxWidth && measureTextWidth(fraction, className) <= maxWidth) {
                    return [whole, fraction]
                }
            }
            const totalWidth = measureTextWidth(text, className)
            const lineCount = Math.ceil(totalWidth / maxWidth)
            const targetWidth = totalWidth / lineCount
            const parts = []
            let current = ''
            for (const char of text) {
                const candidate = current + char
                if (current && parts.length < lineCount - 1 && measureTextWidth(candidate, className) > targetWidth) {
                    parts.push(current)
                    current = char
                } else {
                    current = candidate
                }
            }
            if (current) parts.push(current)
            return parts
        }
        for (const code of active) {
            const totalSpend = Number.parseFloat(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).spend || 0), 0).toPrecision(12))
            const totalIncome = Number.parseFloat(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).income || 0), 0).toPrecision(12))
            const totalConvertedOut = Number.parseFloat(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).convertedOut || 0), 0).toPrecision(12))
            const totalConvertedIn = Number.parseFloat(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).convertedIn || 0), 0).toPrecision(12))
            const totalEntries = [
                { label: 'out', value: money(totalSpend, code), isIn: false },
                { label: 'in', value: `+${money(totalIncome, code)}`, isIn: true },
            ]
            if (totalConvertedOut > 0) {
                totalEntries.push({ label: 'conv out', value: `−${money(totalConvertedOut, code)}`, isConv: true })
            }
            if (totalConvertedIn > 0) {
                totalEntries.push({ label: 'conv in', value: `+${money(totalConvertedIn, code)}`, isConv: true })
            }
            const lines = []
            for (const entry of totalEntries) {
                const full = `${entry.label} ${entry.value}`
                if (measureTextWidth(full, 'history__total') <= totalTextWidth) {
                    lines.push({ text: full, isIn: entry.isIn, isConv: entry.isConv })
                } else {
                    lines.push({ text: entry.label, isIn: entry.isIn, isConv: entry.isConv })
                    for (const part of breakTotalText(entry.value, 'history__total', totalTextWidth)) {
                        lines.push({ text: part, isIn: entry.isIn, isConv: entry.isConv })
                    }
                }
            }
            for (const line of lines) {
                maxTotalLineWidth = Math.max(maxTotalLineWidth, measureTextWidth(line.text, 'history__total'))
            }
            totalLinesByCode.set(code, lines)
        }

        const leftPad = Math.max(40, Math.ceil(maxTickWidth) + 10)
        const rightPad = 6
        const totalColumnWidth = Math.min(Math.max(84, Math.ceil(maxTotalLineWidth) + 12), totalColumnCap)
        const plotWidth = Math.max(40, width - leftPad - rightPad - totalColumnWidth)
        const dividerX = leftPad + plotWidth
        const columnWidth = plotWidth / history.length
        const labelStep = columnWidth < 12 ? 6 : columnWidth < 20 ? 4 : columnWidth < 30 ? 3 : columnWidth < 40 ? 2 : 1
        const groupWidth = columnWidth * 0.7
        const barGap = 1.5
        const barWidth = Math.max(1, (groupWidth - barGap) / 2)
        const height = topPad + active.length * laneStride - laneGap + axisHeight

        const svg = svgElement('svg', {
            viewBox: `0 0 ${width} ${height}`,
            class: 'history__svg',
            role: 'img',
            'aria-label': `Monthly money in and out over ${history.length} months for ${active.join(', ')}`,
        })

        const band = svgElement('rect', {
            class: 'history__band',
            y: topPad,
            width: columnWidth,
            height: active.length * laneStride - laneGap,
        })
        band.style.display = 'none'
        svg.appendChild(band)

        active.forEach((code, laneIndex) => {
            const laneTop = topPad + laneIndex * laneStride
            const plotTop = laneTop + 24
            const baseline = laneTop + laneHeight - 8
            const plotHeight = baseline - plotTop
            const max = laneMax.get(code)

            const laneColor = currencyColor(code) || 'var(--accent)'
            const laneDot = svgElement('circle', {
                cx: 3.5,
                cy: laneTop + 6,
                r: 3.5,
                class: 'history__lane-dot',
                fill: laneColor,
            })
            svg.appendChild(laneDot)

            const laneLabel = svgElement('text', { x: 12, y: laneTop + 10, class: 'history__lane-label' })
            laneLabel.textContent = code
            svg.appendChild(laneLabel)

            for (const factor of [0, 0.5, 1]) {
                const y = baseline - plotHeight * factor
                svg.appendChild(svgElement('line', {
                    x1: leftPad,
                    x2: dividerX,
                    y1: y,
                    y2: y,
                    class: factor === 0 ? 'history__baseline' : 'history__grid',
                }))
                if (factor > 0 && max > 0) {
                    const tick = svgElement('text', { x: leftPad - 6, y: y + 3.5, class: 'history__tick' })
                    tick.textContent = tickMoney(max * factor)
                    svg.appendChild(tick)
                }
            }

            history.forEach((entry, monthIndex) => {
                const totals = entry.currencies[code] || { spend: 0, income: 0 }
                const groupLeft = leftPad + monthIndex * columnWidth + (columnWidth - groupWidth) / 2
                const outHeight = max > 0 ? (totals.spend / max) * plotHeight : 0
                const inHeight = max > 0 ? (totals.income / max) * plotHeight : 0
                if (outHeight > 0) {
                    const bar = svgElement('rect', {
                        x: groupLeft,
                        y: baseline - outHeight,
                        width: barWidth,
                        height: outHeight,
                        rx: Math.min(2.5, barWidth / 2).toFixed(2),
                        class: 'history__bar',
                    })
                    bar.style.fill = laneColor
                    svg.appendChild(bar)
                }
                if (inHeight > 0) {
                    const bar = svgElement('rect', {
                        x: groupLeft + barWidth + barGap,
                        y: baseline - inHeight,
                        width: barWidth,
                        height: inHeight,
                        rx: Math.min(2.5, barWidth / 2).toFixed(2),
                        class: 'history__bar history__bar--in',
                    })
                    bar.style.fill = laneColor
                    bar.style.stroke = laneColor
                    svg.appendChild(bar)
                }
                if (laneIndex === active.length - 1 && monthIndex % labelStep === 0) {
                    const label = svgElement('text', {
                        x: leftPad + monthIndex * columnWidth + columnWidth / 2,
                        y: height - 8,
                        class: 'history__label',
                    })
                    label.textContent = historyMonthLabel(entry, monthIndex)
                    svg.appendChild(label)
                }
            })

            const totalLines = totalLinesByCode.get(code)
            const totalLineHeight = 14
            const totalStartY = laneTop + (laneHeight - totalLines.length * totalLineHeight) / 2 + 11
            totalLines.forEach((line, lineIndex) => {
                const totalText = svgElement('text', {
                    x: width - rightPad,
                    y: totalStartY + lineIndex * totalLineHeight,
                    class: line.isConv ? 'history__total history__total--conv' :
                        line.isIn ? 'history__total history__total--in' : 'history__total',
                })
                totalText.textContent = line.text
                svg.appendChild(totalText)
            })
        })

        svg.appendChild(svgElement('line', {
            x1: dividerX,
            x2: dividerX,
            y1: topPad,
            y2: topPad + active.length * laneStride - laneGap,
            class: 'history__divider',
        }))
        const totalHeader = svgElement('text', {
            x: dividerX + totalColumnWidth / 2,
            y: height - 7,
            class: 'history__label',
        })
        totalHeader.textContent = 'Total'
        svg.appendChild(totalHeader)

        history.forEach((entry, monthIndex) => {
            const hit = svgElement('rect', {
                x: leftPad + monthIndex * columnWidth,
                y: topPad,
                width: columnWidth,
                height: active.length * laneStride - laneGap,
                class: 'history__hit',
            })
            const show = (event) => {
                band.style.display = ''
                band.setAttribute('x', leftPad + monthIndex * columnWidth)
                tooltipEl.textContent = ''
                tooltipEl.appendChild(buildTooltip(entry, active))
                tooltipEl.hidden = false
                const cardRect = tooltipEl.parentElement.getBoundingClientRect()
                const tooltipWidth = tooltipEl.offsetWidth
                const tooltipHeight = tooltipEl.offsetHeight
                const relativeX = event.clientX - cardRect.left
                const relativeY = event.clientY - cardRect.top
                const left = Math.max(4, Math.min(relativeX + 12, cardRect.width - tooltipWidth - 4))
                const top = Math.max(4, Math.min(relativeY + 12, cardRect.height - tooltipHeight - 4))
                tooltipEl.style.left = `${left}px`
                tooltipEl.style.top = `${top}px`
            }
            hit.addEventListener('mouseenter', show)
            hit.addEventListener('mousemove', show)
            hit.addEventListener('mouseleave', () => {
                band.style.display = 'none'
                tooltipEl.hidden = true
            })
            svg.appendChild(hit)
        })

        container.appendChild(svg)
        if (history.some((entry) => entry.partial)) {
            const note = document.createElement('p')
            note.className = 'history__note muted'
            note.textContent = '* partial month (the selected range covers only part of it)'
            container.appendChild(note)
        }
    }

    // Renders (or re-renders) the chart into `container`, using `tooltipEl`
    // (inside a positioned ancestor) for hover details. Re-renders when the
    // container's width changes.
    const render = (container, tooltipEl, options = {}) => {
        const months = options.months || []
        tooltipEl.hidden = true
        container.textContent = ''
        if (months.length === 0) {
            if (container.__historyObserver) {
                container.__historyObserver.disconnect()
                container.__historyObserver = null
            }
            return false
        }
        const active = activeCodesFor(months, options.codes)
        if (active.length === 0) {
            if (container.__historyObserver) {
                container.__historyObserver.disconnect()
                container.__historyObserver = null
            }
            return false
        }

        let lastWidth = 0
        const redraw = () => {
            container.textContent = ''
            tooltipEl.hidden = true
            draw(container, tooltipEl, months, active)
            lastWidth = container.clientWidth
        }
        redraw()

        if (container.__historyObserver) {
            container.__historyObserver.disconnect()
        }
        const observer = new ResizeObserver(() => {
            if (Math.abs(container.clientWidth - lastWidth) > 0.5) {
                redraw()
            }
        })
        observer.observe(container)
        container.__historyObserver = observer
        return true
    }

    const api = { render }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api
    }
    global.DSCPLNHistory = api
})(typeof window !== 'undefined' ? window : globalThis)
