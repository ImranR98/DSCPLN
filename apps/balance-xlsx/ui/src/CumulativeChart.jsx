import { useEffect, useRef } from 'react'
import { renderCumulative } from './lib/chart.js'

export default function CumulativeChart({ data }) {
  const hostRef = useRef(null)

  useEffect(() => {
    if (hostRef.current && data) {
      renderCumulative(hostRef.current, data)
    }
  }, [data])

  return <div className="insights-chart-host" ref={hostRef}></div>
}
