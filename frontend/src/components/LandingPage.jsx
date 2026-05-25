import React, { useState, useEffect, useCallback } from 'react'
import { loginWithGoogle, signUpCustom, loginCustom } from '../api'

export default function LandingPage({ onLoginSuccess }) {
  const [error, setError] = useState(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [googleAvailable, setGoogleAvailable] = useState(false)
  const [stats, setStats] = useState({ jobs: 0, active: 0, rate: 0 })
  const [showConfig, setShowConfig] = useState(false)
  const [customClientId, setCustomClientId] = useState(() => localStorage.getItem('google_client_id') || '')

  // Custom Authentication states
  const [activeTab, setActiveTab] = useState('login') // 'login' or 'signup'
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  
  const [verificationPending, setVerificationPending] = useState(false)
  const [developerActivationCode, setDeveloperActivationCode] = useState('')
  const [verifyingInstant, setVerifyingInstant] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationError, setVerificationError] = useState('')
  const [verifyingCode, setVerifyingCode] = useState(false)

  // Animate mock stats ticker on mount
  useEffect(() => {
    const duration = 2000 // ms
    const steps = 60
    const interval = duration / steps
    let step = 0

    const timer = setInterval(() => {
      step++
      setStats({
        jobs: Math.floor((1420 / steps) * step),
        active: Math.floor((94 / steps) * step),
        rate: Math.floor((98 / steps) * step)
      })
      if (step >= steps) {
        clearInterval(timer)
        setStats({ jobs: 1420, active: 94, rate: 98 })
      }
    }, interval)

    return () => clearInterval(timer)
  }, [])

  // Google ID Token response handler
  const handleCredentialResponse = useCallback(async (response) => {
    setAuthLoading(true)
    setError(null)
    const res = await loginWithGoogle(response.credential)
    if (res.error) {
      setError(res.error)
      setAuthLoading(false)
    } else {
      localStorage.setItem('token', res.token)
      localStorage.setItem('user', JSON.stringify(res.user))
      onLoginSuccess({ token: res.token, user: res.user })
    }
  }, [onLoginSuccess])

  // Try to initialise Google Sign-In when SDK loads
  useEffect(() => {
    let checkInterval
    const initGoogle = () => {
      /* global google */
      if (typeof google !== 'undefined') {
        setGoogleAvailable(true)
        clearInterval(checkInterval)
        try {
          const activeClientId = localStorage.getItem('google_client_id') || "688220038936-3a1fivb8jmdc4t7qflgff831hml9i1h4.apps.googleusercontent.com"
          google.accounts.id.initialize({
            client_id: activeClientId,
            callback: handleCredentialResponse,
            auto_select: false
          })
          google.accounts.id.renderButton(
            document.getElementById("google-signin-btn"),
            {
              theme: "filled_dark",
              size: "large",
              text: "continue_with",
              shape: "pill",
              width: "280"
            }
          )
        } catch (err) {
          console.warn("Failed to initialize Google One Tap", err)
        }
      }
    }

    initGoogle()
    // Poll to check if SDK script loads
    checkInterval = setInterval(initGoogle, 500)
    return () => clearInterval(checkInterval)
  }, [handleCredentialResponse])

  // Local demo login handler to facilitate offline testing / local run
  const handleDemoLogin = async () => {
    setAuthLoading(true)
    setError(null)
    const res = await loginWithGoogle('demo-token')
    if (res.error) {
      setError(res.error)
      setAuthLoading(false)
    } else {
      localStorage.setItem('token', res.token)
      localStorage.setItem('user', JSON.stringify(res.user))
      onLoginSuccess({ token: res.token, user: res.user })
    }
  }

  // Custom Signup Handler
  const handleSignupSubmit = async (e) => {
    e.preventDefault()
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) {
      setError('Please fill in all signup fields.')
      return
    }
    setAuthLoading(true)
    setError(null)
    
    const res = await signUpCustom(signupName.trim(), signupEmail.trim(), signupPassword)
    setAuthLoading(false)
    
    if (res.error) {
      setError(res.error)
    } else {
      setDeveloperActivationCode(res.developer_activation_code || '')
      setVerificationPending(true)
    }
  }

  // Custom Login Handler
  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setError('Please enter your email and password.')
      return
    }
    setAuthLoading(true)
    setError(null)
    
    const res = await loginCustom(loginEmail.trim(), loginPassword)
    setAuthLoading(false)
    
    if (res.error) {
      setError(res.error)
    } else {
      localStorage.setItem('token', res.token)
      localStorage.setItem('user', JSON.stringify(res.user))
      onLoginSuccess({ token: res.token, user: res.user })
    }
  }

  // Helper to trigger code verification dynamically
  const triggerAutoVerify = async (code) => {
    setVerifyingCode(true)
    setVerificationError('')
    try {
      const { verifyCodeCustom } = await import('../api')
      const res = await verifyCodeCustom(signupEmail.trim(), code)
      setVerifyingCode(false)
      
      if (res.error) {
        setVerificationError(res.error)
      } else {
        localStorage.setItem('token', res.token)
        localStorage.setItem('user', JSON.stringify(res.user))
        onLoginSuccess({ token: res.token, user: res.user })
      }
    } catch (err) {
      setVerificationError('Verification failed. Try again.')
      setVerifyingCode(false)
    }
  }

  // Verification code submit handler
  const handleVerifyCodeSubmit = async (e) => {
    if (e) e.preventDefault()
    if (verificationCode.trim().length !== 6) {
      setVerificationError('Please enter a valid 6-digit code.')
      return
    }
    await triggerAutoVerify(verificationCode.trim())
  }

  // Instant Developer Activation Handler
  const handleInstantActivation = async () => {
    if (!developerActivationCode) return
    setVerifyingInstant(true)
    setVerificationError('')
    try {
      const { verifyCodeCustom } = await import('../api')
      const res = await verifyCodeCustom(signupEmail.trim(), developerActivationCode)
      setVerifyingInstant(false)
      
      if (res.error) {
        setVerificationError(res.error)
      } else {
        localStorage.setItem('token', res.token)
        localStorage.setItem('user', JSON.stringify(res.user))
        onLoginSuccess({ token: res.token, user: res.user })
      }
    } catch (err) {
      setVerificationError('Instant activation failed. Please check backend logs.')
      setVerifyingInstant(false)
    }
  }

  // Save the custom client ID configuration
  const handleSaveConfig = () => {
    if (customClientId.trim()) {
      localStorage.setItem('google_client_id', customClientId.trim())
    } else {
      localStorage.removeItem('google_client_id')
    }
    setShowConfig(false)
    window.location.reload()
  }

  return (
    <div className="landing-container">
      {/* Dynamic glow overlays */}
      <div className="glow-orb orb-1"></div>
      <div className="glow-orb orb-2"></div>
      <div className="glow-orb orb-3"></div>

      <header className="landing-header">
        <div className="logo">
          <span className="logo-icon">💼</span>
          <span>Job<span className="logo-accent">Hunter</span></span>
        </div>
        <div className="header-badge">v1.3.0 • Cloud Ready</div>
      </header>

      <main className="landing-hero-section">
        <div className="hero-text-container">
          <h1 className="hero-title">
            Automate Your <br />
            <span className="gradient-text">Job Pipeline</span>
          </h1>
          <p className="hero-subtitle">
            Smart job aggregator and real-time application tracker for IT Support, System Administrators, and Cloud Professionals.
          </p>

          <div className="stats-ticker">
            <div className="ticker-item">
              <span className="ticker-num">{stats.jobs}+</span>
              <span className="ticker-label">Scraped Listings</span>
            </div>
            <div className="ticker-item">
              <span className="ticker-num">{stats.active}%</span>
              <span className="ticker-label">Success Rate</span>
            </div>
            <div className="ticker-item">
              <span className="ticker-num">{stats.rate}%</span>
              <span className="ticker-label">Time Saved</span>
            </div>
          </div>
        </div>

        {/* Auth Panel */}
        <div className="auth-card">
          <div className="auth-card-inner">
            <div className="auth-card-badge">SECURE AUTH</div>
            
            {/* Tabs Header */}
            <div className="auth-tabs">
              <button 
                className={`auth-tab-btn ${activeTab === 'login' ? 'active' : ''}`}
                onClick={() => { setActiveTab('login'); setError(null); }}
              >
                Sign In
              </button>
              <button 
                className={`auth-tab-btn ${activeTab === 'signup' ? 'active' : ''}`}
                onClick={() => { setActiveTab('signup'); setError(null); }}
              >
                Sign Up
              </button>
            </div>

            {error && (
              <div className="auth-error">
                <span>⚠️</span> {error}
              </div>
            )}

            <div className="auth-action-container">
              {authLoading ? (
                <div className="auth-loading">
                  <div className="spinner"></div>
                  <span>Securing Session...</span>
                </div>
              ) : (
                <>
                  {activeTab === 'login' ? (
                    // Log In Form
                    <form className="auth-form" onSubmit={handleLoginSubmit}>
                      <div className="form-group">
                        <label>Email Address</label>
                        <input 
                          type="email" 
                          placeholder="you@domain.com"
                          value={loginEmail}
                          onChange={e => setLoginEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Password</label>
                        <input 
                          type="password" 
                          placeholder="••••••••"
                          value={loginPassword}
                          onChange={e => setLoginPassword(e.target.value)}
                          required
                        />
                      </div>
                      <button type="submit" className="btn-auth-submit">
                        Sign In with Password
                      </button>
                    </form>
                  ) : (
                    // Sign Up Form
                    <form className="auth-form" onSubmit={handleSignupSubmit}>
                      <div className="form-group">
                        <label>Full Name</label>
                        <input 
                          type="text" 
                          placeholder="John Doe"
                          value={signupName}
                          onChange={e => setSignupName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Email Address</label>
                        <input 
                          type="email" 
                          placeholder="you@domain.com"
                          value={signupEmail}
                          onChange={e => setSignupEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Password</label>
                        <input 
                          type="password" 
                          placeholder="••••••••"
                          value={signupPassword}
                          onChange={e => setSignupPassword(e.target.value)}
                          required
                        />
                      </div>
                      <button type="submit" className="btn-auth-submit">
                        Create Account
                      </button>
                    </form>
                  )}

                  <div className="divider-row" style={{ margin: '16px 0 12px 0' }}>
                    <span>or continue with</span>
                  </div>

                  <div id="google-signin-btn" className="google-btn-wrapper"></div>
                  
                  {!googleAvailable && (
                    <div className="gsi-loading-status">
                      Connecting to Google Identity Services...
                    </div>
                  )}

                  <div className="client-id-config-link" onClick={() => setShowConfig(true)}>
                    ⚙️ Configure Google Client ID
                  </div>

                  <div className="divider-row" style={{ margin: '14px 0 10px 0' }}>
                    <span>or sandbox</span>
                  </div>

                  <button className="btn-demo-auth" onClick={handleDemoLogin}>
                    <span className="btn-demo-glow"></span>
                    <span className="btn-demo-content">
                      ⚡ Access Demo Environment
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Feature Section */}
      <section className="features-grid-section">
        <h2 className="section-title">Engineered for Efficiency</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🔍</div>
            <h4>Multi-Location Agent</h4>
            <p>Aggregates IT jobs from Indeed, LinkedIn, and Glassdoor across multiple cities or fully Remote in under 30 seconds.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">🤖</div>
            <h4>Claude AI Watchdog</h4>
            <p>Applies custom LLM rules using Claude Sonnet to automatically identify and screen out irrelevant listings.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h4>Real-time Synchronization</h4>
            <p>Server-Sent Events push new listings and application statistics directly to your client without polling bottlenecks.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">🛡️</div>
            <h4>Personalized Pipeline</h4>
            <p>Isolate your statuses. Saved, applied, and interview tracking remain uniquely yours on shared scraped database indexes.</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <p>© 2026 JobHunter. Fully automated job agent and pipeline system. Open Source.</p>
      </footer>

      {/* Email Verification Pending Modal Overlay */}
      {verificationPending && (
        <div className="config-overlay">
          <div className="config-modal verification-modal" onClick={e => e.stopPropagation()}>
            <span className="verification-icon">📨</span>
            <h4>Enter Verification Code</h4>
            <p className="verification-text">
              We have sent a 6-digit verification code to <strong style={{ color: '#00ffcc' }}>{signupEmail}</strong>. 
              Please enter it below to activate your account:
            </p>
            
            <form onSubmit={handleVerifyCodeSubmit} style={{ width: '100%', marginTop: 16 }}>
              <div className="form-group" style={{ textAlign: 'center', marginBottom: 20 }}>
                <input 
                  type="text" 
                  maxLength={6}
                  placeholder="000000"
                  value={verificationCode}
                  onChange={e => {
                    const val = e.target.value.replace(/[^0-9]/g, '')
                    setVerificationCode(val)
                    if (val.length === 6) {
                      setTimeout(() => triggerAutoVerify(val), 10)
                    }
                  }}
                  style={{
                    fontSize: 32,
                    fontWeight: 'bold',
                    letterSpacing: 8,
                    textAlign: 'center',
                    backgroundColor: '#1f2430',
                    border: '1px solid #1f2430',
                    borderRadius: 8,
                    padding: '12px',
                    color: '#00ffcc',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                  required
                />
              </div>

              {verificationError && (
                <div className="auth-error" style={{ marginBottom: 16 }}>
                  <span>⚠️</span> {verificationError}
                </div>
              )}

              <button type="submit" className="btn-auth-submit" disabled={verifyingCode} style={{ marginBottom: 16 }}>
                {verifyingCode ? 'Verifying Code...' : 'Verify Code & Log In'}
              </button>
            </form>
            
            {developerActivationCode && (
              <div className="verification-sandbox-card">
                <h5>⚡ Sandbox Developer Option:</h5>
                <p>Since you are running locally, you can bypass email server lookup and activate this test account instantly by clicking the button below:</p>
                
                <button 
                  className="btn-instant-activate"
                  disabled={verifyingInstant}
                  onClick={handleInstantActivation}
                  style={{ width: '100%' }}
                >
                  {verifyingInstant ? 'Activating Cloud Account...' : '⚡ Instant Verify & Log In'}
                </button>
              </div>
            )}

            <div className="config-modal-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button 
                className="btn-cancel" 
                onClick={() => { setVerificationPending(false); setActiveTab('login'); }}
              >
                Cancel & Sign In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OAuth Client ID Configuration Modal */}
      {showConfig && (
        <div className="config-overlay">
          <div className="config-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Configure Google OAuth</h4>
            <p>To use Google Sign-In, you must configure your Google Client ID and register your domain in the Google Developer Console.</p>
            
            <div className="form-group">
              <label>Google Client ID</label>
              <input 
                type="text" 
                placeholder="123456789-xxxxxx.apps.googleusercontent.com"
                value={customClientId}
                onChange={(e) => setCustomClientId(e.target.value)}
              />
            </div>

            <div className="config-instructions">
              <h5>Setup Instructions:</h5>
              <ol>
                <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>.</li>
                <li>Create or select an active project.</li>
                <li>Go to <strong>APIs & Services &gt; Credentials</strong>.</li>
                <li>Create an <strong>OAuth 2.0 Client ID</strong> for a <strong>Web application</strong>.</li>
                <li>Under <strong>Authorized JavaScript origins</strong>, add: <br /><code>http://localhost:5173</code></li>
                <li>Copy the Client ID, paste it above, and click Save.</li>
              </ol>
            </div>

            <div className="config-modal-actions">
              <button className="btn-save" onClick={handleSaveConfig}>Save & Refresh</button>
              <button className="btn-cancel" onClick={() => setShowConfig(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
