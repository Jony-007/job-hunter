import React, { useState, useEffect, useRef, useCallback } from 'react'

const FILTERS = [
  { key: 'all',       emoji: '📋', label: 'All Jobs' },
  { key: 'new',       emoji: '🆕', label: 'New' },
  { key: 'saved',     emoji: '💾', label: 'Saved' },
  { key: 'applied',   emoji: '📤', label: 'Applied' },
  { key: 'interview', emoji: '🎯', label: 'Interview' },
  { key: 'offer',     emoji: '🎉', label: 'Offer' },
  { key: 'rejected',  emoji: '❌', label: 'Rejected' },
  { key: 'ghosted',   emoji: '👻', label: 'Ghosted' }
]

function formatScrapeTime(dateVal) {
  if (!dateVal) return 'Never'
  let dateString = dateVal
  if (typeof dateVal === 'object') {
    dateString = dateVal.finished_at || dateVal.started_at || null
  }
  if (!dateString) return 'Never'
  const d = new Date(dateString)
  if (isNaN(d.getTime())) return 'Never'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

export default function Sidebar({
  user,
  onLogout,
  stats,
  statusFilter,
  onFilterChange,
  onScrapeNow,
  autoRefresh,
  onAutoRefreshToggle,
  isOpen,
  onToggle,
  currentView = 'dashboard',
  onViewChange
}) {
  const [scraping, setScraping] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [sidebarQuery, setSidebarQuery] = useState('')
  const [sidebarLoc, setSidebarLoc] = useState('')
  const countdownRef = useRef(null)

  // ── Countdown Timer ───────────────────────────────────────
  useEffect(() => {
    if (!autoRefresh) {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(30)
      return
    }

    setCountdown(30)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 30
        return prev - 1
      })
    }, 1000)

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [autoRefresh])

  // ── Scrape Handler ────────────────────────────────────────
  const handleScrape = useCallback(async () => {
    setScraping(true)
    await onScrapeNow(sidebarQuery.trim(), sidebarLoc.trim())
    setTimeout(() => setScraping(false), 3000)
  }, [onScrapeNow, sidebarQuery, sidebarLoc])

  const getCount = (key) => {
    if (key === 'all') return stats.total || 0
    return stats[key] || 0
  }

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      {/* Logo */}
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">💼</span>
          <span>Job<span className="logo-accent">Hunter</span></span>
        </div>
      </div>

      {/* User Card */}
      {user && (
        <div className="sidebar-user-card">
          <img
            src={user.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80'}
            alt={user.name}
            className="sidebar-user-avatar"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80';
            }}
          />
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-email">{user.email}</div>
          </div>
        </div>
      )}

      {/* View Switcher Navigation */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Views</div>
        <div className="sidebar-nav">
          <button
            className={`nav-btn ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => {
              onViewChange && onViewChange('dashboard')
              if (isOpen) onToggle()
            }}
          >
            <span className="nav-btn-emoji">📊</span>
            <span className="nav-btn-label">Dashboard</span>
          </button>
          <button
            className={`nav-btn ${currentView === 'resume-tailor' ? 'active' : ''}`}
            onClick={() => {
              onViewChange && onViewChange('resume-tailor')
              if (isOpen) onToggle()
            }}
          >
            <span className="nav-btn-emoji">📝</span>
            <span className="nav-btn-label">Resume Tailor</span>
          </button>
        </div>
      </div>

      {/* Config */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Configuration Target</div>
        <div className="sidebar-config-form">
          <div className="sidebar-input-group">
            <span className="sidebar-input-icon">🎯</span>
            <input 
              type="text" 
              placeholder="Job role (e.g. IT Analyst)"
              value={sidebarQuery}
              onChange={(e) => setSidebarQuery(e.target.value)}
            />
          </div>
          <div className="sidebar-input-group" style={{ marginTop: 8 }}>
            <span className="sidebar-input-icon">📍</span>
            <input 
              type="text" 
              placeholder="Location (e.g. Regina, SK)"
              value={sidebarLoc}
              onChange={(e) => setSidebarLoc(e.target.value)}
            />
          </div>
          <div className="config-item" style={{ padding: '8px 2px 0 2px' }}>
            <span className="config-item-icon">🌐</span>
            <div>
              <div className="config-item-text">LinkedIn · Indeed (Glassdoor skipped for custom targets)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Scrape Controls */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Controls</div>
        <button
          className="btn-scrape"
          onClick={handleScrape}
          disabled={scraping}
        >
          {scraping ? (
            <>
              <span className="spinner" />
              Scraping...
            </>
          ) : (
            <>🚀 Scrape Now</>
          )}
        </button>

        <div className="switch-row" style={{ marginTop: 14 }}>
          <span className="switch-label">Auto-refresh</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={onAutoRefreshToggle}
            />
            <span className="slider" />
          </label>
        </div>

        {autoRefresh && (
          <div className="countdown">
            Next refresh in <span className="countdown-value">{countdown}s</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="sidebar-section flex-grow">
        <div className="sidebar-section-title">Filter by Status</div>
        <div className="sidebar-filters-scroll">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`filter-btn ${statusFilter === f.key ? 'active' : ''}`}
              onClick={() => {
                onFilterChange(f.key)
                onViewChange && onViewChange('dashboard')
                if (isOpen) onToggle()
              }}
            >
              <span className="filter-btn-emoji">{f.emoji}</span>
              <span className="filter-btn-label">{f.label}</span>
              <span className="filter-btn-count">{getCount(f.key)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Last Scrape */}
      <div className="sidebar-section sidebar-status-section">
        <div className="scrape-status">
          <span className="scrape-status-dot" />
          System Active
        </div>
        <div className="last-scrape">
          Last scrape: <span className="last-scrape-time">{formatScrapeTime(stats.last_scrape)}</span>
        </div>
      </div>

      {/* Logout button */}
      {onLogout && (
        <div className="sidebar-footer">
          <button className="btn-logout" onClick={onLogout}>
            <span className="btn-logout-icon">🚪</span>
            <span>Log Out</span>
          </button>
        </div>
      )}
    </aside>
  )
}
