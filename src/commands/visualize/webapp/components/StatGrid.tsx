/// <reference lib="dom" />

interface StatItem {
  value: string
  label: string
}

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <div className="stat-grid">
      {items.map((item, i) => (
        <div key={i} className="stat-item">
          <div className="stat-value">{item.value}</div>
          <div className="stat-label">{item.label}</div>
        </div>
      ))}
    </div>
  )
}
