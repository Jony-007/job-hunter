import React, { useState, useEffect, useRef, useCallback } from 'react'
import { fetchSettings, saveSettings, uploadBaseResume, deleteBaseResume } from '../api'

export default function SettingsView({ onBackToDashboard, addToast }) {
  const [defaultQuery, setDefaultQuery] = useState('')
  const [defaultLocation, setDefaultLocation] = useState('')
  const [hasBaseResume, setHasBaseResume] = useState(false)
  const [baseResumeFilename, setBaseResumeFilename] = useState('')
  
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [uploadingResume, setUploadingResume] = useState(false)
  const [deletingResume, setDeletingResume] = useState(false)

  const fileInputRef = useRef(null)

  // Load user settings on mount
  useEffect(() => {
    let active = true
    fetchSettings().then(res => {
      if (!active) return
      if (res.error) {
        addToast(`Failed to load settings: ${res.error}`, 'error')
      } else {
        setDefaultQuery(res.default_query || '')
        setDefaultLocation(res.default_location || '')
        setHasBaseResume(res.has_base_resume || false)
        setBaseResumeFilename(res.base_resume_filename || '')
      }
      setLoading(false)
    }).catch(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [addToast])

  // Save query & location defaults
  const handleSaveSettings = async (e) => {
    e.preventDefault()
    setSavingSettings(true)
    const res = await saveSettings(defaultQuery.trim(), defaultLocation.trim())
    setSavingSettings(false)
    if (res.error) {
      addToast(`Failed to save settings: ${res.error}`, 'error')
    } else {
      addToast('✅ Scraper default settings saved successfully!', 'success')
    }
  }

  // File Upload trigger
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
      addToast('Only .docx files are supported for hosted base resumes', 'error')
      return
    }

    setUploadingResume(true)
    addToast('📄 Uploading and storing base resume on server...', 'info')
    
    const res = await uploadBaseResume(file)
    setUploadingResume(false)
    
    if (res.error) {
      addToast(`Upload failed: ${res.error}`, 'error')
    } else {
      setHasBaseResume(true)
      setBaseResumeFilename(res.filename || file.name)
      addToast('🎉 Base resume successfully hosted and saved in database!', 'success')
    }
  }

  // Delete hosted resume
  const handleDeleteResume = async () => {
    if (!window.confirm('Are you sure you want to delete your stored base resume? You will need to upload a file every time you tailor unless you save a new base resume.')) {
      return
    }
    
    setDeletingResume(true)
    const res = await deleteBaseResume()
    setDeletingResume(false)
    
    if (res.error) {
      addToast(`Delete failed: ${res.error}`, 'error')
    } else {
      setHasBaseResume(false)
      setBaseResumeFilename('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      addToast('Base resume removed from server settings', 'info')
    }
  }

  if (loading) {
    return (
      <div className="loading-spinner" style={{ minHeight: '60vh' }}>
        <div className="spinner-ring" />
        <span>Loading your profile settings...</span>
      </div>
    )
  }

  return (
    <div className="settings-view-container">
      {/* Header Deck */}
      <div className="settings-header-deck">
        <button 
          className="btn-back-dashboard"
          onClick={onBackToDashboard}
        >
          ← Back to Dashboard
        </button>
        <div className="settings-title-group" style={{ marginTop: 16 }}>
          <h1>Workspace Settings</h1>
          <p className="settings-subtitle">Manage your base resume hosting and automate your search crawlers</p>
        </div>
      </div>

      <div className="settings-grid-layout" style={{ marginTop: 24 }}>
        {/* Card 1: Scraper Configuration */}
        <div className="settings-card glassmorphic-panel">
          <div className="card-header-icon">🤖</div>
          <h3>Search Scraper Defaults</h3>
          <p className="card-desc">Define your primary target job title and target location. These defaults will auto-fill your search queries and apply when manual scrapes are triggered.</p>
          
          <form onSubmit={handleSaveSettings} className="settings-form">
            <div className="form-group-input">
              <label>Default Job Title Query</label>
              <input 
                type="text"
                placeholder="e.g. IT Support Analyst / SysAdmin"
                value={defaultQuery}
                onChange={e => setDefaultQuery(e.target.value)}
              />
              <span className="input-tip">Leaves the scraper to target these terms when triggered automatically.</span>
            </div>

            <div className="form-group-input" style={{ marginTop: 20 }}>
              <label>Default Location Query</label>
              <input 
                type="text"
                placeholder="e.g. Regina, SK / Toronto, ON"
                value={defaultLocation}
                onChange={e => setDefaultLocation(e.target.value)}
              />
              <span className="input-tip">URL-encodes location filters for LinkedIn and Indeed runs.</span>
            </div>

            <button 
              type="submit"
              className="btn-save-settings"
              disabled={savingSettings}
              style={{ marginTop: 24 }}
            >
              {savingSettings ? (
                <>
                  <span className="spinner-mini" />
                  Saving...
                </>
              ) : (
                'Save Scraper Defaults'
              )}
            </button>
          </form>
        </div>

        {/* Card 2: Hosted Base Resume */}
        <div className="settings-card glassmorphic-panel">
          <div className="card-header-icon">📄</div>
          <h3>Hosted Base Resume (.docx)</h3>
          <p className="card-desc">Upload your primary master resume once. The AI will securely store it in PostgreSQL and use it as your baseline resume for all one-click tailoring, so you don't need to re-upload on every run!</p>
          
          {hasBaseResume ? (
            <div className="hosted-resume-status-card">
              <div className="resume-status-info">
                <span className="docx-icon-large">📂</span>
                <div className="resume-meta-group">
                  <span className="resume-filename-label">{baseResumeFilename || 'Base_Resume.docx'}</span>
                  <span className="resume-hosting-badge">Hosted in Neon DB</span>
                </div>
              </div>
              
              <button
                className="btn-delete-hosted-resume"
                disabled={deletingResume}
                onClick={handleDeleteResume}
              >
                {deletingResume ? 'Deleting...' : '✕ Remove Resume'}
              </button>
            </div>
          ) : (
            <div className="resume-uploader-zone">
              <input 
                type="file"
                ref={fileInputRef}
                accept=".docx"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <div 
                className="uploader-interactive-area"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="upload-arrow-large">📤</span>
                <h4>Click to Upload base .docx Resume</h4>
                <p>Drag and drop or browse files (Calibri or Arial styled templates recommended)</p>
              </div>
            </div>
          )}

          {uploadingResume && (
            <div className="uploader-loading-overlay">
              <span className="spinner-mini" />
              <span>Uploading master resume template...</span>
            </div>
          )}

          <div className="settings-tip-box" style={{ marginTop: 24 }}>
            <span className="tip-box-icon">💡</span>
            <p className="tip-box-text">Once hosted, your "Tailor Resume" button inside any opportunity detail card will optimize this base resume instantly and trigger an automated download in seconds.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
