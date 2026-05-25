import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fetchJobDescription, tailorResume, tailorResumeDocx } from '../api'

export default function ResumeTailorView({ jobs, activeJobId, onBackToDashboard, addToast }) {
  const [selectedJobId, setSelectedJobId] = useState(activeJobId || '')
  const [description, setDescription] = useState('')
  const [fetchingDesc, setFetchingDesc] = useState(false)
  const [originalResume, setOriginalResume] = useState(() => {
    return localStorage.getItem('user_resume') || ''
  })
  const [saveDefault, setSaveDefault] = useState(true)
  const [tailoring, setTailoring] = useState(false)
  const [tailoredResume, setTailoredResume] = useState('')
  const [aiAnalysis, setAiAnalysis] = useState('')

  // ── ATS Score States ──
  const [originalScore, setOriginalScore] = useState(null)
  const [newScore, setNewScore] = useState(null)
  // 'idle' | 'analyzing' | 'showing_original' | 'compiling' | 'completed'
  const [displayStage, setDisplayStage] = useState('idle')
  const stageTimerRef = useRef(null)

  // ── DOCX Upload States ──
  const [docxFile, setDocxFile] = useState(null)
  const [docxMode, setDocxMode] = useState(false) // true = docx upload mode
  const fileInputRef = useRef(null)

  // Resolve current active job object
  const selectedJob = jobs.find(j => j.id === selectedJobId)

  // Load and fetch description on selected job change
  useEffect(() => {
    if (!selectedJobId) {
      setDescription('')
      setTailoredResume('')
      setAiAnalysis('')
      setOriginalScore(null)
      setNewScore(null)
      setDisplayStage('idle')
      return
    }

    const job = jobs.find(j => j.id === selectedJobId)
    if (!job) return

    setTailoredResume('')
    setAiAnalysis('')
    setOriginalScore(null)
    setNewScore(null)
    setDisplayStage('idle')

    if (job.description && job.description.trim()) {
      setDescription(job.description)
    } else {
      setFetchingDesc(true)
      setDescription('')
      fetchJobDescription(job.id).then(res => {
        if (res.error) {
          addToast(`Failed to fetch description: ${res.error}`, 'error')
          setDescription('Job description could not be loaded automatically. Please verify the link or paste it manually.')
        } else {
          setDescription(res.description || '')
          job.description = res.description
        }
        setFetchingDesc(false)
      }).catch(() => {
        setFetchingDesc(false)
        setDescription('Failed to connect to description crawler.')
      })
    }
  }, [selectedJobId, jobs, addToast])

  // Initial pre-load logic
  useEffect(() => {
    if (activeJobId) {
      setSelectedJobId(activeJobId)
    } else if (jobs.length > 0 && !selectedJobId) {
      setSelectedJobId(jobs[0].id)
    }
  }, [activeJobId, jobs, selectedJobId])

  // Cleanup stage timer
  useEffect(() => {
    return () => {
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current)
    }
  }, [])

  // ── File Upload Handler ──
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
      addToast('Only .docx files are supported', 'error')
      return
    }
    setDocxFile(file)
    setDocxMode(true)
    addToast(`📎 ${file.name} loaded — ready for one-click tailoring!`, 'info')
  }, [addToast])

  // ── Remove file handler ──
  const handleRemoveFile = useCallback(() => {
    setDocxFile(null)
    setDocxMode(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // ── Trigger auto-download of blob ──
  const downloadBlob = useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  // ── One-Click DOCX Tailor ──
  const handleDocxOptimize = useCallback(async () => {
    if (!selectedJobId) {
      addToast('Please select a target job listing first', 'warning')
      return
    }
    if (!docxFile) {
      addToast('Please upload a .docx resume file first', 'warning')
      return
    }

    setTailoring(true)
    setTailoredResume('')
    setAiAnalysis('')
    setOriginalScore(null)
    setNewScore(null)
    setDisplayStage('analyzing')

    addToast('📄 Uploading resume & optimizing with AI...', 'info')

    const result = await tailorResumeDocx(selectedJobId, docxFile)

    if (result.error) {
      addToast(`AI Tailoring failed: ${result.error}`, 'error')
      setTailoring(false)
      setDisplayStage('idle')
      return
    }

    // Stage 1: Show original score
    const origScore = typeof result.originalScore === 'number' ? result.originalScore : 45
    setOriginalScore(origScore)
    setDisplayStage('showing_original')
    setTailoring(false)

    // Stage 2: Compiling
    stageTimerRef.current = setTimeout(() => {
      setDisplayStage('compiling')

      // Stage 3: Show everything + auto-download
      stageTimerRef.current = setTimeout(() => {
        const optScore = typeof result.newScore === 'number' ? result.newScore : 85
        setNewScore(optScore)
        setAiAnalysis(result.analysis || '')
        setDisplayStage('completed')

        // Auto-download the optimized .docx
        if (result.blob) {
          downloadBlob(result.blob, result.downloadName || 'Resume_ATS_Optimized.docx')
          addToast('🎉 Optimized .docx downloaded! Check your Downloads folder.', 'success')
        }
      }, 1000)
    }, 1500)
  }, [selectedJobId, docxFile, addToast, downloadBlob])

  // ── Standard Text Tailoring (existing) ──
  const handleOptimize = useCallback(async () => {
    if (!selectedJobId) {
      addToast('Please select a target job listing first', 'warning')
      return
    }
    if (!originalResume.trim()) {
      addToast('Please paste or write your current resume first', 'warning')
      return
    }

    setTailoring(true)
    setTailoredResume('')
    setAiAnalysis('')
    setOriginalScore(null)
    setNewScore(null)
    setDisplayStage('analyzing')

    if (saveDefault) {
      localStorage.setItem('user_resume', originalResume)
    }

    addToast('Analyzing resume & optimizing ATS keywords with AI...', 'info')

    const result = await tailorResume(selectedJobId, originalResume)

    if (result.error) {
      addToast(`AI Tailoring failed: ${result.error}`, 'error')
      setTailoring(false)
      setDisplayStage('idle')
      return
    }

    const origScore = typeof result.original_score === 'number' ? result.original_score : 45
    setOriginalScore(origScore)
    setDisplayStage('showing_original')
    setTailoring(false)

    stageTimerRef.current = setTimeout(() => {
      setDisplayStage('compiling')

      stageTimerRef.current = setTimeout(() => {
        const optScore = typeof result.new_score === 'number' ? result.new_score : 85
        setNewScore(optScore)
        setTailoredResume(result.tailored_resume || '')
        setAiAnalysis(result.analysis || '')
        setDisplayStage('completed')
        addToast('🎉 Resume successfully customized for target role!', 'success')
      }, 1000)
    }, 1500)
  }, [selectedJobId, originalResume, saveDefault, addToast])

  // Copy tailored resume to clipboard
  const handleCopy = useCallback(() => {
    if (!tailoredResume) return
    navigator.clipboard.writeText(tailoredResume)
    addToast('📋 Tailored resume copied to clipboard!', 'success')
  }, [tailoredResume, addToast])

  // Score color helper
  const getScoreColor = (score) => {
    if (score >= 80) return '#00ffcc'
    if (score >= 60) return '#ffd700'
    if (score >= 40) return '#ff9f43'
    return '#ff6b6b'
  }

  // Render the ATS Score Comparison Panel
  const renderScoreComparison = () => {
    if (displayStage === 'idle') return null

    if (displayStage === 'analyzing') {
      return (
        <div className="ats-score-panel glassmorphic-panel ats-panel-analyzing">
          <div className="ats-panel-header">
            <span className="ats-panel-icon">📊</span>
            <h4>ATS Score Analysis</h4>
          </div>
          <div className="ats-analyzing-state">
            <div className="ats-scan-bar">
              <div className="ats-scan-fill" />
            </div>
            <p className="ats-stage-text">
              {docxMode ? 'Extracting resume from .docx & scanning against job requirements...' : 'Scanning resume against job requirements...'}
            </p>
          </div>
        </div>
      )
    }

    const showOriginal = ['showing_original', 'compiling', 'completed'].includes(displayStage)
    const showCompiling = displayStage === 'compiling'
    const showNew = displayStage === 'completed'
    const scoreBoost = (showNew && originalScore != null && newScore != null)
      ? newScore - originalScore
      : null

    return (
      <div className={`ats-score-panel glassmorphic-panel ${showNew ? 'ats-panel-complete' : ''}`}>
        <div className="ats-panel-header">
          <span className="ats-panel-icon">📊</span>
          <h4>ATS Match Score Comparison</h4>
        </div>

        <div className="ats-scores-row">
          {showOriginal && (
            <div className="ats-score-block ats-score-original ats-score-enter">
              <span className="ats-score-label">Current Score</span>
              <div
                className="ats-score-value"
                style={{ color: getScoreColor(originalScore), textShadow: `0 0 20px ${getScoreColor(originalScore)}80` }}
              >
                {originalScore}%
              </div>
              <div className="ats-score-bar-track">
                <div
                  className="ats-score-bar-fill ats-bar-original"
                  style={{ width: `${originalScore}%`, background: `linear-gradient(90deg, ${getScoreColor(originalScore)}40, ${getScoreColor(originalScore)})` }}
                />
              </div>
              <span className="ats-score-tag">Before Optimization</span>
            </div>
          )}

          {showOriginal && (
            <div className="ats-score-arrow-zone">
              {showCompiling ? (
                <div className="ats-compiling-indicator">
                  <div className="spinner-ring small" />
                  <span>Optimizing</span>
                </div>
              ) : showNew ? (
                <>
                  <span className="ats-arrow-icon">➔</span>
                  {scoreBoost > 0 && (
                    <div className="ats-boost-badge">
                      +{scoreBoost}%
                    </div>
                  )}
                </>
              ) : (
                <div className="ats-compiling-indicator">
                  <div className="ats-dots-loading">
                    <span /><span /><span />
                  </div>
                  <span>Evaluating</span>
                </div>
              )}
            </div>
          )}

          {showNew && (
            <div className="ats-score-block ats-score-optimized ats-score-enter">
              <span className="ats-score-label">Optimized Score</span>
              <div
                className="ats-score-value ats-score-glow"
                style={{ color: getScoreColor(newScore), textShadow: `0 0 30px ${getScoreColor(newScore)}, 0 0 60px ${getScoreColor(newScore)}60` }}
              >
                {newScore}%
              </div>
              <div className="ats-score-bar-track">
                <div
                  className="ats-score-bar-fill ats-bar-optimized"
                  style={{ width: `${newScore}%`, background: `linear-gradient(90deg, #00ffcc40, #00ffcc)` }}
                />
              </div>
              <span className="ats-score-tag ats-tag-optimized">After AI Tailoring ✨</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="resume-tailor-container">
      {/* Header */}
      <div className="tailor-header">
        <div>
          <button className="btn-back-dashboard" onClick={onBackToDashboard}>
            ← Back to Dashboard
          </button>
          <h2>AI Resume Optimizer Workspace</h2>
          <p className="tailor-sub">Surgically tailor your resume using Playwright descriptions &amp; DeepSeek V4 Flash ATS keywords.</p>
        </div>
      </div>

      {/* Selector Widget */}
      <div className="tailor-selector-widget glassmorphic-panel">
        <label htmlFor="job-select" className="widget-label">Select Target Job Listing:</label>
        <div className="select-wrap">
          <select
            id="job-select"
            value={selectedJobId}
            onChange={e => setSelectedJobId(e.target.value)}
            className="job-select-dropdown"
          >
            {jobs.length === 0 ? (
              <option value="">No jobs available. Return to Dashboard to scrape targets.</option>
            ) : (
              jobs.map(j => (
                <option key={j.id} value={j.id}>
                  🎯 {j.title} at {j.company} ({j.source || 'Scraped'}) - Match: {Math.round(j.match_score)}%
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Main Split workspace */}
      <div className="tailor-split-workspace">
        {/* Left column: Inputs */}
        <div className="tailor-col">

          {/* ═══ ONE-CLICK DOCX UPLOAD CARD ═══ */}
          <div className="workspace-card glassmorphic-panel docx-upload-card">
            <div className="card-header-icon">
              <span>📎</span>
              <h4>One-Click .DOCX Optimizer</h4>
            </div>
            <p className="docx-upload-desc">
              Upload your resume as a <strong>.docx</strong> file — AI will tailor it and auto-download the optimized version.
            </p>

            <div className="docx-upload-zone">
              {docxFile ? (
                <div className="docx-file-loaded">
                  <div className="docx-file-info">
                    <span className="docx-file-icon">📄</span>
                    <div>
                      <span className="docx-file-name">{docxFile.name}</span>
                      <span className="docx-file-size">{(docxFile.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                  <button className="btn-remove-file" onClick={handleRemoveFile} title="Remove file">✕</button>
                </div>
              ) : (
                <label className="docx-drop-label" htmlFor="docx-file-input">
                  <span className="docx-drop-icon">⬆️</span>
                  <span className="docx-drop-text">Click to upload .docx resume</span>
                  <span className="docx-drop-hint">or drag and drop</span>
                </label>
              )}
              <input
                ref={fileInputRef}
                type="file"
                id="docx-file-input"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileSelect}
                className="docx-file-input-hidden"
              />
            </div>

            <button
              className="btn-docx-optimize"
              onClick={handleDocxOptimize}
              disabled={tailoring || !selectedJobId || !docxFile || fetchingDesc}
            >
              {tailoring && docxMode ? (
                <>
                  <span className="spinner-ring small" />
                  Processing .docx...
                </>
              ) : (
                <>🚀 Upload &amp; Tailor .DOCX</>
              )}
            </button>
          </div>

          {/* ═══ DIVIDER ═══ */}
          <div className="mode-divider">
            <span className="divider-line" />
            <span className="divider-text">OR paste text manually</span>
            <span className="divider-line" />
          </div>

          {/* Section: Original Resume (text mode) */}
          <div className="workspace-card glassmorphic-panel">
            <div className="card-header-icon">
              <span>📄</span>
              <h4>Paste Your Current Resume</h4>
            </div>
            
            <textarea
              className="resume-textarea"
              placeholder="Paste your plain-text or markdown resume here... (It will be automatically saved locally)"
              value={originalResume}
              onChange={e => {
                setOriginalResume(e.target.value)
                if (saveDefault) {
                  localStorage.setItem('user_resume', e.target.value)
                }
              }}
            />

            <div className="save-option-row">
              <label className="checkbox-wrap">
                <input
                  type="checkbox"
                  checked={saveDefault}
                  onChange={e => setSaveDefault(e.target.checked)}
                />
                <span className="checkbox-custom" />
                Keep my resume saved as default
              </label>
            </div>
          </div>

          {/* Section: Job Description details */}
          <div className="workspace-card glassmorphic-panel">
            <div className="card-header-icon">
              <span>🎯</span>
              <h4>Full Job Description (Auto-Scraped)</h4>
            </div>

            {fetchingDesc ? (
              <div className="desc-loading-state">
                <div className="spinner-ring" />
                <span className="loading-txt">Launching background Playwright crawler to extract full listing description...</span>
              </div>
            ) : (
              <div className="desc-display-area">
                {description ? (
                  <pre className="desc-pre">{description}</pre>
                ) : (
                  <div className="desc-empty-state">
                    <p>No description cached. Select a job to trigger automated description crawler.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column: AI Outputs */}
        <div className="tailor-col">
          <div className="workspace-card glassmorphic-panel results-card">
            {/* Optimize Trigger (text mode) */}
            <div className="optimize-cta-box">
              <button
                className="btn-trigger-optimization"
                onClick={handleOptimize}
                disabled={tailoring || !selectedJobId || !originalResume.trim() || fetchingDesc || docxMode}
              >
                {tailoring && !docxMode ? (
                  <>
                    <span className="spinner-ring small" />
                    Customizing ATS Alignment...
                  </>
                ) : (
                  <>⚡ Tailor Resume with AI (Text Mode)</>
                )}
              </button>
            </div>

            {/* ── ATS Score Comparison Panel ── */}
            {renderScoreComparison()}

            {/* Results display */}
            <div className="tailored-results-area">
              {tailoring ? (
                <div className="optimization-loading-box">
                  <div className="pulse-circle" />
                  <h4>Aligning skills and optimizing achievements...</h4>
                  <p>
                    {docxMode
                      ? 'DeepSeek V4 Flash is processing your .docx and generating an optimized document...'
                      : 'DeepSeek V4 Flash is customizing your bullet points to match the target job\'s tech stack and responsibilities.'}
                  </p>
                </div>
              ) : tailoredResume ? (
                <div className="tailored-layout">
                  {aiAnalysis && (
                    <div className="ai-analysis-card">
                      <h5>📊 ATS Key Match &amp; Modifications Analysis</h5>
                      <div className="analysis-text">
                        {aiAnalysis.split('\n').map((line, idx) => (
                          <p key={idx}>{line}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="tailored-resume-header">
                    <h5>✨ Tailored Resume Output (Markdown)</h5>
                    <button className="btn-copy-tailored" onClick={handleCopy}>
                      📋 Copy Resume
                    </button>
                  </div>
                  <div className="tailored-output-box">
                    <pre className="tailored-pre">{tailoredResume}</pre>
                  </div>
                </div>
              ) : displayStage === 'completed' && docxMode ? (
                <div className="docx-download-success">
                  <span className="docx-success-icon">✅</span>
                  <h4>Optimized Resume Downloaded!</h4>
                  <p>Your tailored .docx has been automatically saved to your Downloads folder.</p>
                  {aiAnalysis && (
                    <div className="ai-analysis-card" style={{ marginTop: '16px' }}>
                      <h5>📊 ATS Key Match &amp; Modifications Analysis</h5>
                      <div className="analysis-text">
                        {aiAnalysis.split('\n').map((line, idx) => (
                          <p key={idx}>{line}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : displayStage === 'idle' ? (
                <div className="results-empty-state">
                  <span className="robot-icon">🤖</span>
                  <h4>Tailor Workspace Idle</h4>
                  <p>Upload a .docx for one-click optimization, or paste text manually and click optimize to generate a high-scoring tailored resume matching the job's stack perfectly!</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
