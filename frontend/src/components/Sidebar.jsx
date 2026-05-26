import React, { useState } from 'react'

export default function Sidebar({
  user,
  onLogout,
  currentView = 'dashboard',
  onViewChange
}) {
  const [showDropdown, setShowDropdown] = useState(false)

  // Get initials for profile fallback
  const userInitials = React.useMemo(() => {
    if (!user || !user.name) return 'U'
    return user.name
      .split(/\s+/)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }, [user])

  return (
    <aside className="sidebar-narrow">
      {/* Caret Apex Logo */}
      <div className="sidebar-logo-container">
        <svg 
          viewBox="0 0 100 100" 
          className="apex-logo-svg"
          title="Apex Careers"
        >
          <polygon 
            points="50,15 15,80 85,80" 
            fill="none" 
            stroke="var(--accent)" 
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <polygon 
            points="50,35 30,70 70,70" 
            fill="var(--accent-glow)" 
            stroke="var(--accent)" 
            strokeWidth="4"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Navigation Icons Group */}
      <div className="sidebar-nav-icons">
        <button
          className={`sidebar-icon-btn ${currentView === 'dashboard' ? 'active' : ''}`}
          onClick={() => onViewChange && onViewChange('dashboard')}
          title="Dashboard Grid"
        >
          <span className="icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          <span className="icon-tooltip">Dashboard</span>
        </button>

        <button
          className={`sidebar-icon-btn ${currentView === 'resume-tailor' ? 'active' : ''}`}
          onClick={() => onViewChange && onViewChange('resume-tailor')}
          title="AI Resume Tailor Workspace"
        >
          <span className="icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </span>
          <span className="icon-tooltip">Resume Tailor</span>
        </button>

        <button
          className={`sidebar-icon-btn ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => onViewChange && onViewChange('settings')}
          title="Account & Scraper Settings"
        >
          <span className="icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          <span className="icon-tooltip">Settings</span>
        </button>
      </div>

      {/* Footer Section: User Profile & Actions */}
      <div className="sidebar-footer-container">
        {user && (
          <div className="user-profile-wrapper">
            <button 
              className={`avatar-trigger-btn ${showDropdown ? 'active' : ''}`}
              onClick={() => setShowDropdown(prev => !prev)}
            >
              {user.picture ? (
                <img 
                  src={user.picture} 
                  alt={user.name} 
                  className="user-profile-avatar"
                />
              ) : (
                <div className="avatar-fallback">{userInitials}</div>
              )}
            </button>

            {showDropdown && (
              <div className="profile-glass-dropdown">
                <div className="dropdown-user-header">
                  <div className="dropdown-user-name">{user.name}</div>
                  <div className="dropdown-user-email">{user.email}</div>
                </div>
                <div className="dropdown-divider" />
                <button 
                  className="dropdown-action-btn danger"
                  onClick={() => {
                    setShowDropdown(false)
                    onLogout && onLogout()
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="btn-logout-svg">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
                  </svg>
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
