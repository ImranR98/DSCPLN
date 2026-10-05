'use strict'

// SVG charts: the shared monthly money in/out chart (dashboard and insights)
// and the cumulative spent/earned line chart used by the insights sections.
;(function (global) {
    const { formats, number, clean, currencyColor, fractionDigits, moneyFor } = DSCPLN

    const SVG_NS = 'http://www.w3.org/2000/svg'
    const monthYearFormat = formats.monthYear
    const compactNumberFormat = formats.compact

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
        const decimals = fractionDigits(amount, 3)
        return `$${amount.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')}`
    }

    const historyMonthLabel = (entry, index) => {
        const base = formats.monthShort.format(new Date(entry.year, entry.month - 1, 1))
        const label = index === 0 || entry.month === 1 ? `${base} '${String(entry.year).slice(-2)}` : base
        return entry.partial ? `${label}*` : label
    }

    const buildTooltip = (entry, activeCurrencies, money) => {
        const container = document.createElement('div')
        const title = document.createElement('strong')
        title.className = 'chart-tooltip__title'
        title.textContent = entry.partial ?
            `${monthYearFormat.format(new Date(entry.year, entry.month - 1, 1))} (partial month)` :
            monthYearFormat.format(new Date(entry.year, entry.month - 1, 1))
        container.appendChild(title)
        for (const code of activeCurrencies) {
            const totals = entry.currencies[code] || { spend: 0, income: 0 }
            const row = document.createElement('div')
            row.className = 'chart-tooltip__row'
            const codeEl = document.createElement('span')
            codeEl.className = 'chart-tooltip__code'
            const dot = document.createElement('span')
            dot.className = 'chart-tooltip__dot'
            const color = currencyColor(code)
            if (color) dot.style.background = color
            const codeText = document.createElement('span')
            codeText.textContent = code
            codeEl.append(dot, codeText)
            const outEl = document.createElement('span')
            outEl.className = 'chart-tooltip__out'
            outEl.textContent = `${money(number(totals.spend), code)} out`
            const inEl = document.createElement('span')
            inEl.className = 'chart-tooltip__in'
            inEl.textContent = `+${money(number(totals.income), code)} in`
            row.append(codeEl, outEl, inEl)
            container.appendChild(row)
            const convertedOut = number(totals.convertedOut)
            const convertedIn = number(totals.convertedIn)
            if (convertedOut > 0 || convertedIn > 0) {
                const converted = document.createElement('div')
                converted.className = 'chart-tooltip__conv'
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
        const candidates = codes || [...new Set(months.flatMap((entry) => Object.keys(entry.currencies || {})))]
        return candidates.filter((code) => months.some((entry) => {
            const totals = entry.currencies && entry.currencies[code]
            return totals && (totals.spend > 0 || totals.income > 0 ||
                totals.convertedOut > 0 || totals.convertedIn > 0)
        }))
    }

    const draw = (container, tooltipEl, months, active, money) => {
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
                    maxTickWidth = Math.max(maxTickWidth, measureTextWidth(tickMoney(max * factor), 'chart__tick'))
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
            const totalSpend = clean(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).spend || 0), 0))
            const totalIncome = clean(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).income || 0), 0))
            const totalConvertedOut = clean(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).convertedOut || 0), 0))
            const totalConvertedIn = clean(history.reduce((sum, entry) =>
                sum + ((entry.currencies[code] || {}).convertedIn || 0), 0))
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
                if (measureTextWidth(full, 'chart__total') <= totalTextWidth) {
                    lines.push({ text: full, isIn: entry.isIn, isConv: entry.isConv })
                } else {
                    lines.push({ text: entry.label, isIn: entry.isIn, isConv: entry.isConv })
                    for (const part of breakTotalText(entry.value, 'chart__total', totalTextWidth)) {
                        lines.push({ text: part, isIn: entry.isIn, isConv: entry.isConv })
                    }
                }
            }
            for (const line of lines) {
                maxTotalLineWidth = Math.max(maxTotalLineWidth, measureTextWidth(line.text, 'chart__total'))
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
            class: 'chart__svg',
            role: 'img',
            'aria-label': `Monthly money in and out over ${history.length} months for ${active.join(', ')}`,
        })

        const band = svgElement('rect', {
            class: 'chart__band',
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
                class: 'chart__lane-dot',
                fill: laneColor,
            })
            svg.appendChild(laneDot)

            const laneLabel = svgElement('text', { x: 12, y: laneTop + 10, class: 'chart__lane-label' })
            laneLabel.textContent = code
            svg.appendChild(laneLabel)

            for (const factor of [0, 0.5, 1]) {
                const y = baseline - plotHeight * factor
                svg.appendChild(svgElement('line', {
                    x1: leftPad,
                    x2: dividerX,
                    y1: y,
                    y2: y,
                    class: factor === 0 ? 'chart__baseline' : 'chart__grid',
                }))
                if (factor > 0 && max > 0) {
                    const tick = svgElement('text', { x: leftPad - 6, y: y + 3.5, class: 'chart__tick' })
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
                        class: 'chart__bar',
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
                        class: 'chart__bar chart__bar--in',
                    })
                    bar.style.fill = laneColor
                    bar.style.stroke = laneColor
                    svg.appendChild(bar)
                }
                if (laneIndex === active.length - 1 && monthIndex % labelStep === 0) {
                    const label = svgElement('text', {
                        x: leftPad + monthIndex * columnWidth + columnWidth / 2,
                        y: height - 8,
                        class: 'chart__label',
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
                    class: line.isConv ? 'chart__total chart__total--conv' :
                        line.isIn ? 'chart__total chart__total--in' : 'chart__total',
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
            class: 'chart__divider',
        }))
        const totalHeader = svgElement('text', {
            x: dividerX + totalColumnWidth / 2,
            y: height - 7,
            class: 'chart__label',
        })
        totalHeader.textContent = 'Total'
        svg.appendChild(totalHeader)

        history.forEach((entry, monthIndex) => {
            const hit = svgElement('rect', {
                x: leftPad + monthIndex * columnWidth,
                y: topPad,
                width: columnWidth,
                height: active.length * laneStride - laneGap,
                class: 'chart__hit',
            })
            const show = (event) => {
                band.style.display = ''
                band.setAttribute('x', leftPad + monthIndex * columnWidth)
                tooltipEl.textContent = ''
                tooltipEl.appendChild(buildTooltip(entry, active, money))
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
            note.className = 'chart__note muted'
            note.textContent = '* partial month'
            container.appendChild(note)
        }
    }

    // Re-draws whenever the element's width changes (charts are drawn at real
    // pixel sizes, so they must re-render rather than scale).
    const observeWidth = (element, redraw) => {
        let lastWidth = element.clientWidth
        if (element.__widthObserver) {
            element.__widthObserver.disconnect()
        }
        const observer = new ResizeObserver(() => {
            if (Math.abs(element.clientWidth - lastWidth) > 0.5) {
                lastWidth = element.clientWidth
                redraw()
            }
        })
        observer.observe(element)
        element.__widthObserver = observer
    }

    /* ---------- Public drawing ---------- */

    // Draws at the host's real width on the next frame, then re-draws whenever
    // the width changes.
    const queue = (host, drawAtWidth) => {
        window.requestAnimationFrame(() => {
            const redraw = () => drawAtWidth(Math.max(240, Math.round(host.clientWidth || 480)))
            redraw()
            observeWidth(host, redraw)
        })
    }

    // The multi-currency monthly bars with lane labels, a Total column and a
    // hover tooltip. Returns false when there is nothing to draw.
    const renderMonthly = (container, tooltipEl, options = {}) => {
        const months = options.months || []
        const money = options.money || moneyFor(() => false)
        tooltipEl.hidden = true
        container.textContent = ''
        if (container.__widthObserver) {
            container.__widthObserver.disconnect()
            container.__widthObserver = null
        }
        const active = activeCodesFor(months, options.codes)
        if (months.length === 0 || active.length === 0) {
            return false
        }
        const redraw = () => {
            container.textContent = ''
            tooltipEl.hidden = true
            draw(container, tooltipEl, months, active, money)
        }
        redraw()
        observeWidth(container, redraw)
        return true
    }

    // Cumulative spent/earned lines for one currency with the comparison
    // baselines (dashed).
    const renderCumulative = (host, data) => {
        queue(host, (width) => {
            host.textContent = ''
            const height = 210
            const pad = { top: 12, right: 10, bottom: 26, left: 48 }
            const plotWidth = width - pad.left - pad.right
            const plotHeight = height - pad.top - pad.bottom
            const baselineSpend = data.baselineSpend || []
            const baselineIncome = data.baselineIncome || []
            const max = niceMax(Math.max(
                ...data.spendCumulative,
                ...data.incomeCumulative,
                ...baselineSpend,
                ...baselineIncome,
                0
            )) || 1
            const svg = svgElement('svg', {
                viewBox: `0 0 ${width} ${height}`,
                class: 'chart-line',
                role: 'img',
                'aria-label': `Cumulative spent and earned for ${data.currency}`,
            })
            const x = (index) => pad.left + (index / (data.daily.length - 1 || 1)) * plotWidth
            const y = (value) => pad.top + plotHeight - (value / max) * plotHeight

            for (const factor of [0, 0.5, 1]) {
                const lineY = y(max * factor)
                svg.appendChild(svgElement('line', {
                    x1: pad.left, x2: pad.left + plotWidth, y1: lineY, y2: lineY,
                    class: factor === 0 ? 'chart__baseline' : 'chart__grid',
                }))
                const tick = svgElement('text', { x: pad.left - 6, y: lineY + 3.5, class: 'chart__tick' })
                tick.textContent = tickMoney(max * factor)
                svg.appendChild(tick)
            }

            if (baselineSpend.length > 0) {
                const points = baselineSpend.map((value, index) => `${x(index)},${y(value)}`).join(' ')
                svg.appendChild(svgElement('polyline', { points, class: 'chart-line__baseline' }))
            }
            if (baselineIncome.length > 0) {
                const points = baselineIncome.map((value, index) => `${x(index)},${y(value)}`).join(' ')
                svg.appendChild(svgElement('polyline', { points, class: 'chart-line__baseline chart-line__baseline--earned' }))
            }

            const spendPoints = data.spendCumulative.map((value, index) => `${x(index)},${y(value)}`)
            if (spendPoints.length > 0) {
                svg.appendChild(svgElement('polyline', { points: spendPoints.join(' '), class: 'chart-line__line' }))
            }
            const incomePoints = data.incomeCumulative.map((value, index) => `${x(index)},${y(value)}`)
            if (incomePoints.length > 0) {
                svg.appendChild(svgElement('polyline', { points: incomePoints.join(' '), class: 'chart-line__line chart-line__line--earned' }))
            }

            const labelIndexes = [0, Math.floor((data.daily.length - 1) / 2), data.daily.length - 1]
            const axisLabels = data.axisLabels || []
            labelIndexes.forEach((index, position) => {
                const label = svgElement('text', {
                    x: x(index), y: height - 8, class: 'chart__label',
                    'text-anchor': index === 0 ? 'start' : index === data.daily.length - 1 ? 'end' : 'middle',
                })
                label.textContent = axisLabels[position] || String(index + 1)
                svg.appendChild(label)
            })
            host.appendChild(svg)
        })
    }

    global.DSCPLN.chart = { renderMonthly, renderCumulative }
})(typeof window !== 'undefined' ? window : globalThis)
