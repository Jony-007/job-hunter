import React from 'react'

export default function StatsBar({ stats, lastUpdated }) {
  const statItems = [
    { label: 'Total', value: stats.total || 0, variant: '' },
    { label: 'New', value: stats.new || 0, variant: 'stat-accent' },
    { label: 'Applied', value: stats.applied || 0, variant: 'stat-blue' },
    { label: 'Interview', value: stats.interview || 0, variant: 'stat-warning' },
    { label: 'Offer', value: stats.offer || 0, variant: 'stat-success' }
  ]

  return (
    <>
      {lastUpdated && (
        <div className="last-updated">
          <span className="last-updated-dot" />
          Last updated {lastUpdated.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          })}
        </div>
      )}
      <div className="stats-bar">
        {statItems.map(item => (
          <div key={item.label} className={`stat ${item.variant}`}>
            <span className="stat-value">{item.value}</span>
            <span className="stat-label">{item.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}
