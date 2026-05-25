import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  fetchJobs,
  fetchStats,
  updateStatus,
  deleteJob as deleteJobApi,
  triggerScrape,
  subscribeToEvents,
  aiFilter,
  logoutCustom
} from './api'
import Sidebar from './components/Sidebar'
import StatsBar from './components/StatsBar'
import JobCard from './components/JobCard'
import AiFilter from './components/AiFilter'
import Pagination from './components/Pagination'
import OfflineBanner from './components/OfflineBanner'
import LandingPage from './components/LandingPage'
import ResumeTailorView from './components/ResumeTailorView'

const PAGE_SIZE = 50

function timeAgo(dateString) {
  if (!dateString) return 'Recent'
  const now = new Date()
  const date = new Date(dateString)
  const seconds = Math.floor((now - date) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getResponsibilitiesList(description) {
  if (!description) return [
    "Collaborate with engineering teams to build secure infrastructure.",
    "Implement automated continuous integration and delivery pipelines.",
    "Troubleshoot operational issues and optimize system performance.",
    "Document and maintain technical standards and specifications."
  ]
  const parsed = []
  const lines = description.split('\n')
  for (let line of lines) {
    const clean = line.replace(/^[•\-\*\s]+/, '').trim()
    if (clean.length > 25 && clean.length < 130 && !clean.includes(':')) {
      parsed.push(clean)
      if (parsed.length >= 4) break
    }
  }
  if (parsed.length >= 3) return parsed
  
  const sentences = description.split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 150)
    .slice(0, 4)
  return sentences.length >= 2 ? sentences : [
    "Manage technical dependencies and system architectures.",
    "Diagnose system issues and lead continuous optimization.",
    "Provide guidance and alignment on software deployments.",
    "Maintain high levels of security and procedural standards."
  ]
}

export default function App() {
  // Authentication states
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem('user')
      return u ? JSON.parse(u) : null
    } catch {
      return null
    }
  })

  const [jobs, setJobs] = useState([])
  const [stats, setStats] = useState({
    total: 0, active: 0, new: 0, saved: 0, applied: 0,
    interview: 0, offer: 0, rejected: 0, ghosted: 0,
    last_scrape: null
  })
  const [isOnline, setIsOnline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [aiFilteredIds, setAiFilteredIds] = useState(new Set())
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [newJobIds, setNewJobIds] = useState(new Set())
  const [totalJobs, setTotalJobs] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [toasts, setToasts] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [customQuery, setCustomQuery] = useState('')
  const [customLoc, setCustomLoc] = useState('')
  const [scrapingCustom, setScrapingCustom] = useState(false)
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('notifications_history')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [showNotificationsMenu, setShowNotificationsMenu] = useState(false)
  const [currentView, setCurrentView] = useState('dashboard')
  const [activeTailorJobId, setActiveTailorJobId] = useState('')
  const [selectedJobId, setSelectedJobId] = useState(null)
  
  const sseRef = useRef(null)
  const pollRef = useRef(null)
  const debounceRef = useRef(null)
  const notifMenuRef = useRef(null)

  // ── Toast System ──────────────────────────────────────────
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── Verify URL Interceptor ─────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verification = params.get('verification')
    if (verification) {
      if (verification === 'success') {
        const name = params.get('name') || 'User'
        addToast(`🎉 Account verified! Welcome, ${decodeURIComponent(name)}. You can now log in.`, 'success')
      } else if (verification === 'failed') {
        addToast('❌ Verification failed. The activation link was invalid or has expired.', 'error')
      }
      // Clean up the URL search query parameters dynamically for clean aesthetic look
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [addToast])

  // Close notification dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target)) {
        setShowNotificationsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Debounced Search ──────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchText)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchText])

  // ── Fetch Jobs ────────────────────────────────────────────
  const loadJobs = useCallback(async (pageNum = 0, append = false) => {
    if (!token) return
    
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }

    const result = await fetchJobs({
      status: statusFilter,
      limit: PAGE_SIZE,
      offset: pageNum * PAGE_SIZE,
      search: debouncedSearch || undefined,
      active_only: false
    })

    if (result.error) {
      setIsOnline(false)
      if (!append) setLoading(false)
      setLoadingMore(false)
      return
    }

    setIsOnline(true)
    const jobList = result.jobs || result || []
    const total = result.total ?? jobList.length

    if (append) {
      setJobs(prev => [...prev, ...jobList])
    } else {
      setJobs(jobList)
    }

    setTotalJobs(total)
    setHasMore(((pageNum + 1) * PAGE_SIZE) < total)
    setLastUpdated(new Date())
    setLoading(false)
    setLoadingMore(false)
  }, [statusFilter, debouncedSearch, token])

  // ── Fetch Stats ───────────────────────────────────────────
  const loadStats = useCallback(async () => {
    if (!token) return
    const result = await fetchStats()
    if (!result.error) {
      setStats(prev => ({ ...prev, ...result }))
      setIsOnline(true)
    } else {
      setIsOnline(false)
    }
  }, [token])

  // ── On Mount / Token load ─────────────────────────────────
  useEffect(() => {
    if (token) {
      loadStats()
      loadJobs(0)
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── SSE + Fallback Polling ────────────────────────────────
  useEffect(() => {
    if (!token || !autoRefresh) {
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    let sseConnected = false

    try {
      sseRef.current = subscribeToEvents(
        (statsData) => {
          sseConnected = true
          setStats(prev => ({ ...prev, ...statsData }))
          setIsOnline(true)
          setLastUpdated(new Date())
        },
        (newJobsData) => {
          sseConnected = true
          const incomingJobs = newJobsData.jobs || newJobsData || []

          if (incomingJobs.length > 0) {
            setJobs(prev => {
              const existingIds = new Set(prev.map(j => j.id))
              const filteredIncoming = incomingJobs.filter(j => !existingIds.has(j.id))
              
              if (filteredIncoming.length > 0) {
                const newIds = new Set(filteredIncoming.map(j => j.id))
                
                // Escape fiber scheduling cycle for asynchronous sibling updates
                setTimeout(() => {
                  setNewJobIds(prevNew => new Set([...prevNew, ...newIds]))
                  setTotalJobs(prevTotal => prevTotal + filteredIncoming.length)
                  addToast(`${filteredIncoming.length} new job${filteredIncoming.length > 1 ? 's' : ''} found!`, 'success')
                  
                  const newNotif = {
                    id: Date.now() + Math.random(),
                    title: `${filteredIncoming.length} new job${filteredIncoming.length > 1 ? 's' : ''} found!`,
                    message: `Scraped ${filteredIncoming.length} fresh opportunities matching your criteria.`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    read: false,
                    count: filteredIncoming.length
                  }
                  setNotifications(prevNotif => {
                    const next = [newNotif, ...prevNotif]
                    localStorage.setItem('notifications_history', JSON.stringify(next))
                    return next
                  })
                }, 0)

                setTimeout(() => {
                  setNewJobIds(prevNew => {
                    const next = new Set(prevNew)
                    newIds.forEach(id => next.delete(id))
                    return next
                  })
                }, 15000)

                return [...filteredIncoming, ...prev]
              }
              return prev
            })
          }
        },
        token
      )
    } catch {
      // SSE not supported or failed
    }

    // Fallback polling
    pollRef.current = setInterval(() => {
      if (!sseConnected) {
        loadStats()
        loadJobs(0)
      }
    }, 30000)

    return () => {
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [autoRefresh, token, addToast, loadStats, loadJobs])

  // ── Re-fetch on filter/search change ──────────────────────
  useEffect(() => {
    if (token) {
      setPage(0)
      loadJobs(0)
    }
  }, [statusFilter, debouncedSearch, loadJobs, token])

  // ── Handlers ──────────────────────────────────────────────
  const handleStatusChange = useCallback(async (id, newStatus) => {
    const prevJobs = [...jobs]
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: newStatus } : j))

    const result = await updateStatus(id, newStatus)
    if (result.error) {
      setJobs(prevJobs)
      addToast('Failed to update status', 'error')
    } else {
      addToast(`Status updated to ${newStatus}`, 'success')
      loadStats()
    }
  }, [jobs, addToast, loadStats])

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this job listing?')) return

    const prevJobs = [...jobs]
    setJobs(prev => prev.filter(j => j.id !== id))
    setTotalJobs(prev => prev - 1)

    const result = await deleteJobApi(id)
    if (result.error) {
      setJobs(prevJobs)
      setTotalJobs(prev => prev + 1)
      addToast('Failed to delete job', 'error')
    } else {
      addToast('Job deleted', 'info')
      loadStats()
    }
  }, [jobs, addToast, loadStats])

  const handleScrapeNow = useCallback(async (query, location) => {
    if (query || location) {
      addToast(`Dispatched scraper for "${query || 'Any Role'}" in "${location || 'Any Location'}"...`, 'info')
    } else {
      addToast('Dispatched standard scraper...', 'info')
    }
    const result = await triggerScrape(query, location)
    if (result.error) {
      addToast('Failed to trigger scrape — backend offline', 'error')
    } else {
      addToast('Scraper agent successfully launched! Dynamic results will stream shortly.', 'success')
    }
  }, [addToast])

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1
    setPage(nextPage)
    loadJobs(nextPage, true)
  }, [page, loadJobs])

  const handleSearch = useCallback((text) => {
    setSearchText(text)
  }, [])

  const handleAiFilter = useCallback((ids) => {
    setAiFilteredIds(new Set(ids))
  }, [])

  const handleAutoRefreshToggle = useCallback(() => {
    setAutoRefresh(prev => !prev)
  }, [])

  const handleFilterChange = useCallback((filter) => {
    setStatusFilter(filter)
  }, [])

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen(prev => !prev)
  }, [])

  const handleLoginSuccess = useCallback(({ token: newToken, user: newUser }) => {
    setToken(newToken)
    setUser(newUser)
    addToast(`Welcome back, ${newUser.name}!`, 'success')
  }, [addToast])

  const handleLogout = useCallback(() => {
    logoutCustom() // Clear secure session HttpOnly cookie on backend
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
    setJobs([])
    setStats({
      total: 0, active: 0, new: 0, saved: 0, applied: 0,
      interview: 0, offer: 0, rejected: 0, ghosted: 0,
      last_scrape: null
    })
    addToast('Logged out successfully', 'info')
  }, [addToast])

  // ── Filter out AI-filtered jobs from display ──────────────
  const displayJobs = jobs.filter(j => !aiFilteredIds.has(j.id))

  // Auto-select first job from filtered opportunities list
  useEffect(() => {
    if (displayJobs.length > 0) {
      if (!selectedJobId || !displayJobs.some(j => j.id === selectedJobId)) {
        setSelectedJobId(displayJobs[0].id)
      }
    } else {
      setSelectedJobId(null)
    }
  }, [displayJobs, selectedJobId])

  // ── Toast Icons ───────────────────────────────────────────
  const toastIcons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌'
  }

  // ── Render ────────────────────────────────────────────────
  if (!token || !user) {
    return (
      <>
        <LandingPage onLoginSuccess={handleLoginSuccess} />
        {/* Toast Container for authentication alerts */}
        <div className="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <span className="toast-icon">{toastIcons[toast.type]}</span>
              <span className="toast-message">{toast.message}</span>
              <button className="toast-close" onClick={() => removeToast(toast.id)}>×</button>
            </div>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <OfflineBanner />

      <button
        className={`hamburger ${sidebarOpen ? 'open' : ''}`}
        onClick={handleSidebarToggle}
        aria-label="Toggle sidebar"
      >
        <span className="hamburger-line" />
        <span className="hamburger-line" />
        <span className="hamburger-line" />
      </button>

      {sidebarOpen && (
        <div
          className="sidebar-overlay visible"
          onClick={handleSidebarToggle}
        />
      )}

      <div className="app-layout">
        <Sidebar
          user={user}
          onLogout={handleLogout}
          stats={stats}
          statusFilter={statusFilter}
          onFilterChange={handleFilterChange}
          onScrapeNow={handleScrapeNow}
          autoRefresh={autoRefresh}
          onAutoRefreshToggle={handleAutoRefreshToggle}
          isOpen={sidebarOpen}
          onToggle={handleSidebarToggle}
          currentView={currentView}
          onViewChange={setCurrentView}
        />

        <main className="main-content">
          {currentView === 'resume-tailor' ? (
            <ResumeTailorView
              jobs={jobs}
              activeJobId={activeTailorJobId}
              onBackToDashboard={() => setCurrentView('dashboard')}
              addToast={addToast}
            />
          ) : (
            <>
              {/* Premium Header Content: Top Control Deck (Unified search card & stats togglers) */}
              <div className="content-header">
                <div>
                  <h1>Apex Careers</h1>
                  <p className="content-header-sub">Accelerate your professional growth with precise AI analytics</p>
                </div>
                
                {/* Premium Local Notification Center Trigger */}
                <div className="notification-center-container" ref={notifMenuRef}>
                  <button 
                    className={`notification-bell-btn ${showNotificationsMenu ? 'active' : ''}`}
                    onClick={() => setShowNotificationsMenu(prev => !prev)}
                    aria-label="Toggle notifications center"
                  >
                    <span className="bell-icon-wrapper">🔔</span>
                    {notifications.some(n => !n.read) && (
                      <span className="bell-badge">
                        {notifications.filter(n => !n.read).length}
                      </span>
                    )}
                  </button>
                  
                  {showNotificationsMenu && (
                    <div className="notifications-dropdown glassmorphic-panel">
                      <div className="dropdown-header">
                        <h3>Scraper Notifications</h3>
                        <div className="dropdown-actions">
                          <button 
                            onClick={() => {
                              setNotifications(prev => {
                                const next = prev.map(n => ({ ...n, read: true }))
                                localStorage.setItem('notifications_history', JSON.stringify(next))
                                return next
                              })
                            }}
                            className="btn-text-action"
                            disabled={!notifications.some(n => !n.read)}
                          >
                            Mark all read
                          </button>
                          <button 
                            onClick={() => {
                              setNotifications([])
                              localStorage.removeItem('notifications_history')
                            }}
                            className="btn-text-action danger"
                            disabled={notifications.length === 0}
                          >
                            Clear all
                          </button>
                        </div>
                      </div>
                      
                      <div className="notifications-list">
                        {notifications.length === 0 ? (
                          <div className="notifications-empty">
                            <span className="empty-bell">🔔</span>
                            <p>All caught up!</p>
                            <span>No recent alerts found.</span>
                          </div>
                        ) : (
                          notifications.map(n => (
                            <div 
                              key={n.id} 
                              className={`notification-item ${n.read ? 'read' : 'unread'}`}
                              onClick={() => {
                                setNotifications(prev => {
                                  const next = prev.map(item => item.id === n.id ? { ...item, read: true } : item)
                                  localStorage.setItem('notifications_history', JSON.stringify(next))
                                  return next
                                })
                              }}
                            >
                              <div className="item-header">
                                <span className="item-badge">scraped</span>
                                <span className="item-time">{n.timestamp}</span>
                              </div>
                              <h4 className="item-title">{n.title}</h4>
                              <p className="item-msg">{n.message}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Unified Scraper Target and Status Counter Top Deck */}
              <div className="unified-top-control-deck glassmorphic-panel">
                {/* Search / Scrape Input Section */}
                <div className="scrape-search-card">
                  <div className="scrape-input-wrapper">
                    <span className="deck-input-icon">💼</span>
                    <input 
                      type="text" 
                      placeholder="Job title..."
                      value={customQuery}
                      onChange={e => setCustomQuery(e.target.value)}
                    />
                  </div>
                  
                  <div className="deck-divider" />
                  
                  <div className="scrape-input-wrapper">
                    <span className="deck-input-icon">📍</span>
                    <input 
                      type="text" 
                      placeholder="Location..."
                      value={customLoc}
                      onChange={e => setCustomLoc(e.target.value)}
                    />
                  </div>
                  
                  <button 
                    className="deck-scrape-btn"
                    disabled={scrapingCustom || (!customQuery.trim() && !customLoc.trim())}
                    onClick={async () => {
                      setScrapingCustom(true)
                      addToast("🚀 Launching scraper playbooks for targets...", "info")
                      await handleScrapeNow(customQuery.trim(), customLoc.trim())
                      setCustomQuery('')
                      setCustomLoc('')
                      setScrapingCustom(false)
                    }}
                  >
                    {scrapingCustom ? (
                      <>
                        <span className="spinner-mini" />
                        Scraping...
                      </>
                    ) : (
                      <>🚀 Scrape Now</>
                    )}
                  </button>
                </div>

                {/* Status Chips Filter Row */}
                <div className="deck-status-chips">
                  <button 
                    className={`status-chip-btn ${statusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => handleFilterChange('all')}
                  >
                    <span className="chip-count">{stats.total || 0}</span>
                    <span className="chip-label">Jobs</span>
                  </button>

                  <button 
                    className={`status-chip-btn ${statusFilter === 'saved' ? 'active' : ''}`}
                    onClick={() => handleFilterChange('saved')}
                  >
                    <span className="chip-count">{stats.saved || 0}</span>
                    <span className="chip-label">Saved</span>
                  </button>

                  <button 
                    className={`status-chip-btn ${statusFilter === 'applied' ? 'active' : ''}`}
                    onClick={() => handleFilterChange('applied')}
                  >
                    <span className="chip-count">{stats.applied || 0}</span>
                    <span className="chip-label">Applied</span>
                  </button>

                  <button 
                    className={`status-chip-btn ${statusFilter === 'rejected' ? 'active' : ''}`}
                    onClick={() => handleFilterChange('rejected')}
                  >
                    <span className="chip-count">{stats.rejected || 0}</span>
                    <span className="chip-label">Denied</span>
                  </button>
                </div>
              </div>

              {/* AI Priority Filter Row */}
              <div className="ai-filter-wrapper-card">
                <AiFilter
                  jobs={jobs}
                  onFilter={handleAiFilter}
                  addToast={addToast}
                />
              </div>

              {/* Dual-Column Master-Detail Dashboard View Split */}
              <div className="dashboard-split-layout">
                {/* Left Master Column: Opportunities Matches list */}
                <div className="matches-column">
                  <div className="matches-column-header">
                    <div className="matches-header-top">
                      <h2>Recent Matches</h2>
                      <span className="sort-label">Sorted by Match %</span>
                    </div>
                    <div className="matches-local-search">
                      <span className="local-search-icon">🔍</span>
                      <input 
                        type="text" 
                        placeholder="Filter matches list..."
                        value={searchText}
                        onChange={e => handleSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  {loading ? (
                    <div className="loading-spinner">
                      <div className="spinner-ring" />
                      <span>Loading jobs...</span>
                    </div>
                  ) : displayJobs.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon">📭</div>
                      <div className="empty-state-title">No jobs found</div>
                      <p className="empty-state-text">
                        {searchText
                          ? 'Try adjusting your search terms or clearing filters.'
                          : 'Run a scrape to start discovering new opportunities.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="jobs-list">
                        {displayJobs.map((job, index) => (
                          <JobCard
                            key={job.id}
                            job={job}
                            index={index}
                            isNew={newJobIds.has(job.id)}
                            isAiFiltered={aiFilteredIds.has(job.id)}
                            isSelected={selectedJobId === job.id}
                            onClick={setSelectedJobId}
                          />
                        ))}
                      </div>

                      <Pagination
                        totalJobs={totalJobs}
                        currentCount={displayJobs.length}
                        hasMore={hasMore}
                        onLoadMore={handleLoadMore}
                        loading={loadingMore}
                      />
                    </>
                  )}
                </div>

                {/* Right Detail Column: Selected Opportunity analytics details */}
                <div className="details-column">
                  {activeJob ? (
                    <div className="job-details-panel glassmorphic-panel">
                      {/* Details Header Row */}
                      <div className="details-panel-header">
                        <div className="details-header-logo-area">
                          <div 
                            className="details-logo-block" 
                            style={{ 
                              backgroundColor: 
                                activeJob.company
                                  ? [
                                      '#1b3a4b', '#2b1b4b', '#1b4b3e', '#4b321b', 
                                      '#4b1b2b', '#3b4b1b', '#1b1b4b', '#383a59'
                                    ][
                                      Math.abs(
                                        activeJob.company
                                          .split('')
                                          .reduce((acc, c) => acc + c.charCodeAt(0), 0)
                                      ) % 8
                                    ]
                                  : 'var(--surface-container-high)' 
                            }}
                          >
                            <span className="details-logo-initials">
                              {activeJob.company
                                ? activeJob.company
                                    .split(/\s+/)
                                    .map(w => w[0])
                                    .slice(0, 2)
                                    .join('')
                                    .toUpperCase()
                                : '??'}
                            </span>
                          </div>
                          <div className="details-title-group">
                            <h2 className="details-title">{activeJob.title}</h2>
                            <p className="details-company-meta">
                              {activeJob.company || 'Unknown Company'}
                            </p>
                          </div>
                        </div>

                        {/* Top action triggers */}
                        <div className="details-action-triggers">
                          <button 
                            className={`btn-details-save ${activeJob.status === 'saved' ? 'saved' : ''}`}
                            onClick={handleToggleSave}
                            title={activeJob.status === 'saved' ? 'Unsave opportunity' : 'Save opportunity'}
                          >
                            {activeJob.status === 'saved' ? '★ Saved' : '☆ Save Job'}
                          </button>

                          {activeJob.url && (
                            <button 
                              className="btn-details-apply"
                              onClick={handleApplyClick}
                            >
                              Easy Apply
                            </button>
                          )}

                          <button 
                            className="btn-details-tailor"
                            onClick={handleTailorClick}
                          >
                            ⚡ Tailor Resume
                          </button>
                        </div>
                      </div>

                      {/* Smart Match Analytics Progress Bars Grid */}
                      <div className="details-match-insights-card">
                        <div className="insights-metrics-split">
                          <div className="insights-progress-bars">
                            <h4 className="insights-sec-title">📊 Smart Match Insights</h4>
                            
                            {/* Bar 1 */}
                            <div className="insight-bar-group">
                              <div className="insight-bar-label-row">
                                <span className="bar-lbl">Skill Alignment</span>
                                <span className="bar-pct font-mono">{matchDetails.baseScore}%</span>
                              </div>
                              <div className="insight-bar-track">
                                <div 
                                  className="insight-bar-fill" 
                                  style={{ width: `${matchDetails.baseScore}%` }}
                                />
                              </div>
                            </div>

                            {/* Bar 2 */}
                            <div className="insight-bar-group">
                              <div className="insight-bar-label-row">
                                <span className="bar-lbl">Experience Match</span>
                                <span className="bar-pct font-mono">{matchDetails.expScore}%</span>
                              </div>
                              <div className="insight-bar-track">
                                <div 
                                  className="insight-bar-fill" 
                                  style={{ width: `${matchDetails.expScore}%` }}
                                />
                              </div>
                            </div>

                            {/* Bar 3 */}
                            <div className="insight-bar-group">
                              <div className="insight-bar-label-row">
                                <span className="bar-lbl">Culture Fit</span>
                                <span className="bar-pct font-mono">{matchDetails.culScore}%</span>
                              </div>
                              <div className="insight-bar-track">
                                <div 
                                  className="insight-bar-fill" 
                                  style={{ width: `${matchDetails.culScore}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Right Highlight Box */}
                          <div className="insights-highlight-box">
                            <span className="big-pct font-mono">{matchDetails.baseScore}%</span>
                            <span className="top-badge-label">TOP 1% APPLICANT</span>
                            <p className="insight-highlight-desc">
                              {matchDetails.summaryText}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Main detail text split */}
                      <div className="details-body-split">
                        {/* Left column: About & parsed check list */}
                        <div className="details-body-main">
                          <div className="details-section">
                            <h3>About the Role</h3>
                            <p className="details-about-text">
                              {activeJob.description || activeJob.snippet || 'No role description provided.'}
                            </p>
                          </div>

                          <div className="details-section" style={{ marginTop: 24 }}>
                            <h3>Key Responsibilities</h3>
                            <ul className="details-checklist">
                              {matchDetails.responsibilities.map((resp, i) => (
                                <li key={i} className="checklist-item">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="chk-svg">
                                    <path d="M5 13l4 4L19 7"/>
                                  </svg>
                                  <span>{resp}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {activeJob.is_active === false && (
                            <div className="details-inactive-alert">
                              ⚠ This opportunity listing has been marked as inactive or expired.
                            </div>
                          )}

                          <div className="details-management-row">
                            <div className="details-status-selector">
                              <span className="status-sel-lbl">Pipeline Status:</span>
                              <select
                                className="status-sel-dropdown"
                                value={activeJob.status || 'new'}
                                onChange={e => handleStatusChange(activeJob.id, e.target.value)}
                              >
                                <option value="new">🆕 New</option>
                                <option value="saved">💾 Saved</option>
                                <option value="applied">📤 Applied</option>
                                <option value="interview">🎯 Interview</option>
                                <option value="offer">🎉 Offer</option>
                                <option value="rejected">❌ Denied</option>
                                <option value="ghosted">👻 Ghosted</option>
                              </select>
                            </div>
                            <button 
                              className="btn-details-delete"
                              onClick={async () => {
                                if (window.confirm("Are you sure you want to delete this opportunity?")) {
                                  await handleDelete(activeJob.id)
                                  addToast("Opportunity deleted successfully", "success")
                                }
                              }}
                            >
                              🗑 Delete Opportunity
                            </button>
                          </div>
                        </div>

                        {/* Right column: Sticky Quick facts card & skyline asset */}
                        <div className="details-body-facts">
                          <div className="quick-facts-card">
                            <h4 className="facts-title">Quick Facts</h4>
                            
                            <div className="fact-row">
                              <span className="fact-icon">📍</span>
                              <div className="fact-info">
                                <span className="fact-label">LOCATION</span>
                                <span className="fact-val">{activeJob.location || 'Not Specified'}</span>
                              </div>
                            </div>

                            <div className="fact-row">
                              <span className="fact-icon">💰</span>
                              <div className="fact-info">
                                <span className="fact-label">SALARY BANDS</span>
                                <span className="fact-val">{activeJob.salary || 'Not Disclosed'}</span>
                              </div>
                            </div>

                            <div className="fact-row">
                              <span className="fact-icon">🕐</span>
                              <div className="fact-info">
                                <span className="fact-label">POSTED ON</span>
                                <span className="fact-val">
                                  {activeJob.date_posted || activeJob.scraped_at 
                                    ? timeAgo(activeJob.date_posted || activeJob.scraped_at) 
                                    : 'Recent'}
                                </span>
                              </div>
                            </div>

                            <div className="fact-row">
                              <span className="fact-icon">🌐</span>
                              <div className="fact-info">
                                <span className="fact-label">ORIGIN</span>
                                <span className="fact-val font-mono">{activeJob.source || 'Scraper'}</span>
                              </div>
                            </div>
                            
                            {/* Skyline visual asset block */}
                            <div className="facts-skyline-visual">
                              <img 
                                src="/assets/skyline.png" 
                                alt="City Skyline" 
                                className="skyline-img-block"
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.style.display = 'none';
                                }}
                              />
                              <div className="visual-overlay-accent" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-details-panel glassmorphic-panel">
                      <div className="empty-details-icon">💼</div>
                      <h3>No Opportunity Selected</h3>
                      <p>Start scraping to load jobs, or click any opportunity from the "Recent Matches" list to evaluate matching insights.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Toast Container */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">{toastIcons[toast.type]}</span>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => removeToast(toast.id)}>×</button>
          </div>
        ))}
      </div>
    </>
  )
}
