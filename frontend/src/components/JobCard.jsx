import React, { useState, useMemo } from 'react'

function timeAgo(dateString) {
  if (!dateString) return ''
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
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function getScoreClass(score) {
  if (score == null) return ''
  if (score >= 80) return 'score-high'
  if (score >= 60) return 'score-good'
  if (score >= 40) return 'score-mid'
  return 'score-low'
}

function getSourceClass(source) {
  if (!source) return 'source-default'
  const s = source.toLowerCase()
  if (s.includes('linkedin')) return 'source-linkedin'
  if (s.includes('indeed')) return 'source-indeed'
  if (s.includes('glassdoor')) return 'source-glassdoor'
  return 'source-default'
}

const STATUS_OPTIONS = [
  { value: 'new', label: '🆕 New' },
  { value: 'saved', label: '💾 Saved' },
  { value: 'applied', label: '📤 Applied' },
  { value: 'interview', label: '🎯 Interview' },
  { value: 'offer', label: '🎉 Offer' },
  { value: 'rejected', label: '❌ Rejected' },
  { value: 'ghosted', label: '👻 Ghosted' }
]

export default function JobCard({ job, index, isNew, isAiFiltered, onStatusChange, onDelete, onTailorResume }) {
  const [expanded, setExpanded] = useState(false)

  const snippet = useMemo(() => {
    if (!job.description && !job.snippet) return ''
    const text = job.description || job.snippet || ''
    if (expanded || text.length <= 150) return text
    return text.slice(0, 150)
  }, [job.description, job.snippet, expanded])

  const hasLongSnippet = (job.description || job.snippet || '').length > 150
  const isInactive = job.is_active === false
  const tags = useMemo(() => {
    const rawTags = job.tags || job.skills
    if (!rawTags) return []
    if (Array.isArray(rawTags)) return rawTags
    if (typeof rawTags === 'string') {
      return rawTags.split(',').map(t => t.trim()).filter(Boolean)
    }
    return []
  }, [job.tags, job.skills])

  const cardClasses = [
    'job-card',
    isInactive && 'inactive',
    isAiFiltered && 'ai-filtered'
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cardClasses}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Header */}
      <div className="job-card-header">
        <div className="job-card-header-left">
          <h3 className="job-title">
            {job.url ? (
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                {job.title || 'Untitled Position'}
              </a>
            ) : (
              job.title || 'Untitled Position'
            )}
          </h3>
          <div className="job-company">
            {job.company || 'Unknown Company'}
          </div>
        </div>

        <div className="job-card-header-right">
          {isNew && (
            <span className="new-badge">✦ NEW</span>
          )}
          {job.match_score != null && (
            <span className={`match-score ${getScoreClass(job.match_score)}`}>
              {Math.round(job.match_score)}%
            </span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="job-meta">
        {job.location && (
          <span className="job-meta-item">
            <span className="meta-icon">📍</span>
            {job.location}
          </span>
        )}
        {job.salary && (
          <span className="job-meta-item">
            <span className="meta-icon">💰</span>
            {job.salary}
          </span>
        )}
        {job.source && (
          <span className={`source-badge ${getSourceClass(job.source)}`}>
            {job.source}
          </span>
        )}
        {(job.date_posted || job.scraped_at || job.created_at) && (
          <span className="job-meta-item">
            <span className="meta-icon">🕐</span>
            {timeAgo(job.date_posted || job.scraped_at || job.created_at)}
          </span>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="job-tags">
          {tags.slice(0, 8).map((tag, i) => (
            <span key={i} className="tag-chip">{tag}</span>
          ))}
          {tags.length > 8 && (
            <span className="tag-chip">+{tags.length - 8}</span>
          )}
        </div>
      )}

      {/* Snippet */}
      {snippet && (
        <div
          className="job-snippet"
          onClick={() => hasLongSnippet && setExpanded(prev => !prev)}
        >
          {snippet}
          {hasLongSnippet && !expanded && (
            <span className="job-snippet-toggle">...more</span>
          )}
          {hasLongSnippet && expanded && (
            <span className="job-snippet-toggle"> less</span>
          )}
        </div>
      )}

      {/* Listing Closed */}
      {isInactive && (
        <div className="listing-closed">
          ⚠ Listing no longer active
        </div>
      )}

      {/* Footer */}
      <div className="job-footer">
        <div className="job-actions">
          <select
            className="status-dropdown"
            value={job.status || 'new'}
            onChange={e => onStatusChange(job.id, e.target.value)}
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-apply"
            >
              Apply →
            </a>
          )}

          <button
            className="btn-tailor"
            onClick={(e) => {
              e.stopPropagation()
              onTailorResume && onTailorResume(job.id)
            }}
            title="Tailor your resume for this job using AI"
          >
            ⚡ Tailor
          </button>
        </div>

        <button
          className="btn-delete"
          onClick={() => onDelete(job.id)}
        >
          🗑 Delete
        </button>
      </div>
    </div>
  )
}
