import { Breakable } from '@dscpln/ui-kit'

export default function KpiGrid({ kpis }) {
  return (
    <div className="kpi-grid">
      {kpis.map((kpi) => (
        <div className="kpi" key={kpi.label}>
          <span className="kpi__label" title={kpi.labelTitle}>{kpi.label}</span>
          <Breakable className="kpi__value" style={kpi.valueColor ? { color: kpi.valueColor } : undefined} text={kpi.valueText} />
          <span className={`kpi__delta ${kpi.delta.className}`} title={kpi.delta.title}>{kpi.delta.text}</span>
        </div>
      ))}
    </div>
  )
}
