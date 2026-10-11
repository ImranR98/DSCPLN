// Chart.js setup shared by the dashboard and insights pages. Defaults only;
// the look follows the theme through the CSS variables Pico defines.

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, Legend)

Chart.defaults.font.family = 'inherit'
Chart.defaults.color = () => getComputedStyle(document.documentElement).getPropertyValue('--pico-color') || '#333'

// Creates a fresh canvas inside `container` and returns a destroy function.
// Fresh canvases avoid the "can't acquire context" race when a chart is
// re-rendered before the previous one finished destroying.
export function mountChart(container, config) {
  const canvas = document.createElement('canvas')
  container.append(canvas)
  const chart = new Chart(canvas, config)
  return () => {
    chart.destroy()
    canvas.remove()
  }
}

export function currencyAxis() {
  return {
    ticks: {
      callback: (value) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value),
    },
  }
}
