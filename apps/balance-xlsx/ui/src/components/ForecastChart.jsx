import { useEffect, useRef, useState } from 'react'
import { formats, parseIso } from '@dscpln/ui-kit'

const HEIGHT = 210
const PADDING = { top: 12, right: 12, bottom: 26, left: 56 }

const monthDiff = (start, end) =>
  (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())

const monthLabel = (date) => formats.monthYear.format(date)

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export default function ForecastChart({ chart, money }) {
  const hostRef = useRef(null)
  const [width, setWidth] = useState(720)
  const [activePoint, setActivePoint] = useState(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const update = () => setWidth(Math.max(260, Math.round(host.clientWidth || 720)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  if (!chart || chart.months.length === 0) {
    return <p className="muted">Add a baseline and a horizon to see the projection.</p>
  }

  const startDate = parseIso(chart.start.date)
  const endDate = parseIso(chart.horizonEnd)
  const totalMonths = Math.max(1, monthDiff(startDate, endDate) + 1)
  const plotWidth = width - PADDING.left - PADDING.right
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom
  const xStart = PADDING.left
  const xForMonthEnd = (iso) => {
    const date = parseIso(iso)
    return PADDING.left + ((monthDiff(startDate, date) + 1) / totalMonths) * plotWidth
  }

  const bands = (chart.uncertainty || []).filter((band) => band.p10 != null && band.p90 != null)
  const bandByDate = new Map((chart.uncertainty || []).map((band) => [band.date, band]))
  const values = [
    chart.start.balance,
    ...chart.months.map((month) => month.closing),
    ...chart.months.map((month) => month.closingWithoutEvents),
    ...bands.flatMap((band) => [band.p10, band.p90]),
  ]
  if (chart.target != null) values.push(chart.target)
  values.push(0)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    min -= 1
    max += 1
  }
  const span = max - min
  min -= span * 0.06
  max += span * 0.06
  const yFor = (value) => PADDING.top + ((max - value) / (max - min)) * plotHeight

  const points = chart.months.map((month, index) => ({
    month,
    index,
    band: bandByDate.get(month.date) || null,
    x: xForMonthEnd(month.date),
    y: yFor(month.closing),
    withoutY: yFor(month.closingWithoutEvents),
  }))
  const withEvents = [
    { x: xStart, y: yFor(chart.start.balance) },
    ...points,
  ]
  const withoutEvents = [
    { x: xStart, y: yFor(chart.start.balance) },
    ...points.map((point) => ({ x: point.x, y: point.withoutY })),
  ]
  const pathFor = (pathPoints) => pathPoints.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
  const bandTop = bands.map((band) => ({ x: xForMonthEnd(band.date), y: yFor(band.p90) }))
  const bandBottom = bands.map((band) => ({ x: xForMonthEnd(band.date), y: yFor(band.p10) })).reverse()
  const bandPath = bandTop.length
    ? `${pathFor(bandTop)} ${bandBottom.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`
    : ''

  const tickCount = 2
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = min + ((max - min) * index) / tickCount
    return { value, y: yFor(value) }
  })
  const compact = (value) => `${chart.symbol || ''}${formats.compact.format(value)}`
  const monthTickCandidates = width < 480
    ? [0, chart.months.length - 1]
    : [0, Math.floor((chart.months.length - 1) / 2), chart.months.length - 1]
  const monthTicks = monthTickCandidates
    .filter((value, index, list) => value >= 0 && list.indexOf(value) === index)

  const eventMarkers = (chart.events || []).map((event) => {
    const date = parseIso(event.date)
    const offset = Math.max(0, Math.min(totalMonths - 1, monthDiff(startDate, date)))
    const month = chart.months.find((entry) => entry.date >= event.date) || chart.months[Math.min(offset, chart.months.length - 1)]
    return {
      ...event,
      x: PADDING.left + ((offset + 0.5) / totalMonths) * plotWidth,
      y: yFor(month?.closing ?? chart.start.balance),
    }
  })

  const targetDate = chart.targetDate ? parseIso(chart.targetDate) : null
  const targetWithin = Boolean(targetDate && targetDate >= startDate && targetDate <= endDate)
  const targetDayFraction = targetWithin
    ? (targetDate.getDate() - 1) / new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate()
    : 0
  const targetX = targetWithin
    ? PADDING.left + ((monthDiff(startDate, targetDate) + targetDayFraction) / totalMonths) * plotWidth
    : null

  const tooltip = activePoint ? {
    ...activePoint,
    left: clamp(activePoint.x, 78, width - 78),
    top: Math.max(52, activePoint.y - 8),
  } : null

  return (
    <>
      <div className="forecast-chart" ref={hostRef}>
        <svg
          className="forecast-chart__svg"
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Projected balance through ${monthLabel(endDate)}${targetDate ? `; target reached ${monthLabel(targetDate)}` : ''}`}
        >
          {ticks.map((tick) => (
            <g key={tick.value}>
              <line className="forecast-chart__grid" x1={PADDING.left} x2={width - PADDING.right} y1={tick.y} y2={tick.y} />
              <text className="forecast-chart__tick" x={PADDING.left - 8} y={tick.y + 4} textAnchor="end">
                {compact(tick.value)}
              </text>
            </g>
          ))}
          {min < 0 ? (
            <line
              className="forecast-chart__zero"
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={yFor(0)}
              y2={yFor(0)}
            />
          ) : null}
          {chart.target != null ? (
            <g>
              <line
                className="forecast-chart__target"
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={yFor(chart.target)}
                y2={yFor(chart.target)}
              />
              <text className="forecast-chart__target-label" x={width - PADDING.right} y={yFor(chart.target) - 6} textAnchor="end">
                Target {money(chart.target, chart.currency)}
              </text>
            </g>
          ) : null}
          {targetX != null ? (
            <g>
              <line
                className="forecast-chart__target-date"
                x1={targetX}
                x2={targetX}
                y1={PADDING.top}
                y2={HEIGHT - PADDING.bottom}
              />
              <text className="forecast-chart__target-date-label" x={clamp(targetX, 48, width - 48)} y={PADDING.top - 2} textAnchor="middle">
                Reached {monthLabel(targetDate)}
              </text>
            </g>
          ) : null}
          {bandPath ? <path className="forecast-chart__band" d={bandPath} style={{ fill: chart.color }} /> : null}
          <path className="forecast-chart__line forecast-chart__line--without" d={pathFor(withoutEvents)} />
          <path className="forecast-chart__line" d={pathFor(withEvents)} style={{ stroke: chart.color }} />
          {eventMarkers.map((event, index) => (
            <circle
              className={`forecast-chart__event forecast-chart__event--${event.kind}`}
              key={`${event.date}-${event.details}-${index}`}
              cx={event.x}
              cy={event.y}
              r={3.5}
            >
              <title>{`${event.details}: ${event.kind === 'income' ? '+' : '−'}${money(event.amount, chart.currency)} on ${event.date}`}</title>
            </circle>
          ))}
          {points.map((point) => {
            const band = point.band
            const label = `${monthLabel(parseIso(point.month.date))}: projected ${money(point.month.closing, chart.currency)}`
            const title = [
              label,
              `without one-time events ${money(point.month.closingWithoutEvents, chart.currency)}`,
              band ? `80% range ${money(band.p10, chart.currency)} – ${money(band.p90, chart.currency)}` : '',
            ].filter(Boolean).join(' · ')
            return (
              <circle
                className="forecast-chart__hit"
                key={`hit-${point.month.date}`}
                cx={point.x}
                cy={point.y}
                r={10}
                tabIndex={0}
                role="img"
                aria-label={title}
                onPointerEnter={() => setActivePoint(point)}
                onPointerLeave={() => setActivePoint(null)}
                onFocus={() => setActivePoint(point)}
                onBlur={() => setActivePoint(null)}
                onClick={() => setActivePoint(point)}
              >
                <title>{title}</title>
              </circle>
            )
          })}
          {monthTicks.map((index) => {
            const month = chart.months[index]
            if (!month) return null
            return (
              <text
                className="forecast-chart__tick forecast-chart__tick--x"
                key={month.date}
                x={xForMonthEnd(month.date)}
                y={HEIGHT - 8}
                textAnchor={index === 0 ? 'start' : index === chart.months.length - 1 ? 'end' : 'middle'}
              >
                {monthLabel(parseIso(month.date))}
              </text>
            )
          })}
        </svg>
        {tooltip ? (
          <div
            className="forecast-chart__tooltip"
            style={{ left: `${(tooltip.left / width) * 100}%`, top: `${(tooltip.top / HEIGHT) * 100}%` }}
            role="status"
          >
            <strong>{monthLabel(parseIso(tooltip.month.date))}</strong>
            <span>Projected {money(tooltip.month.closing, chart.currency)}</span>
            <span>Without one-time events {money(tooltip.month.closingWithoutEvents, chart.currency)}</span>
            {tooltip.band ? (
              <span>80% range {money(tooltip.band.p10, chart.currency)} – {money(tooltip.band.p90, chart.currency)}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="forecast-chart__legend">
        <span className="forecast-chart__legend-item">
          <span className="forecast-chart__swatch" style={{ background: chart.color }}></span>
          Projected balance
        </span>
        <span className="forecast-chart__legend-item">
          <span className="forecast-chart__swatch forecast-chart__swatch--dashed"></span>
          Without one-time events
        </span>
        {chart.target != null ? (
          <span className="forecast-chart__legend-item">
            <span className="forecast-chart__swatch forecast-chart__swatch--target"></span>
            Target
          </span>
        ) : null}
        {targetWithin ? (
          <span className="forecast-chart__legend-item">
            <span className="forecast-chart__swatch forecast-chart__swatch--target-date"></span>
            Target reached
          </span>
        ) : null}
        {bands.length ? (
          <span className="forecast-chart__legend-item">
            <span className="forecast-chart__swatch forecast-chart__swatch--band"></span>
            80% range
          </span>
        ) : null}
      </div>
    </>
  )
}
