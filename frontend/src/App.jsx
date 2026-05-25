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
              <div className="content-header">
                <div>
                  <h1>Dashboard</h1>
                  <p className="content-header-sub">Track and manage your job opportunities</p>
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

              <StatsBar stats={stats} lastUpdated={lastUpdated} />

              <div className="custom-scraper-widget">
                <div className="widget-header">
                  <span className="widget-icon">⚡</span>
                  <div>
                    <h4>Custom Scraper Engine</h4>
                    <p className="widget-sub">Launch dynamic playbooks to aggregate any job role and location in real time.</p>
                  </div>
                </div>
                
                <div className="widget-inputs-row">
                  <div className="input-wrap">
                    <span className="input-icon">🎯</span>
                    <input 
                      type="text" 
                      placeholder="Job role (e.g. Frontend Developer)"
                      value={customQuery}
                      onChange={e => setCustomQuery(e.target.value)}
                    />
                  </div>
                  <div className="input-wrap">
                    <span className="input-icon">📍</span>
                    <input 
                      type="text" 
                      placeholder="Location (e.g. Toronto, ON)"
                      value={customLoc}
                      onChange={e => setCustomLoc(e.target.value)}
                    />
                  </div>
                  
                  <button 
                    className="btn-trigger-custom"
                    disabled={scrapingCustom || (!customQuery.trim() && !customLoc.trim())}
                    onClick={async () => {
                      setScrapingCustom(true)
                      await handleScrapeNow(customQuery.trim(), customLoc.trim())
                      setCustomQuery('')
                      setCustomLoc('')
                      setTimeout(() => setScrapingCustom(false), 5000)
                    }}
                  >
                    {scrapingCustom ? 'Scraping Targets...' : '🚀 Scrape Target'}
                  </button>
                </div>
              </div>

              <div className="search-area">
                <div className="search-bar">
                  <span className="search-bar-icon">🔍</span>
                  <input
                    type="text"
                    placeholder="Search jobs by title, company, or keywords..."
                    value={searchText}
                    onChange={e => handleSearch(e.target.value)}
                  />
                </div>
              </div>

              <AiFilter
                jobs={jobs}
                onFilter={handleAiFilter}
                addToast={addToast}
              />

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
                <div className="jobs-list">
                  {displayJobs.map((job, index) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      index={index}
                      isNew={newJobIds.has(job.id)}
                      isAiFiltered={aiFilteredIds.has(job.id)}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                      onTailorResume={(jobId) => {
                        setActiveTailorJobId(jobId)
                        setCurrentView('resume-tailor')
                      }}
                    />
                  ))}
                </div>
              )}

              <Pagination
                totalJobs={totalJobs}
                currentCount={displayJobs.length}
                hasMore={hasMore}
                onLoadMore={handleLoadMore}
                loading={loadingMore}
              />
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
