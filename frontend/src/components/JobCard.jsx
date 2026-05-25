import React, { useMemo } from 'react'

function getScoreClass(score) {
  if (score == null) return ''
  if (score >= 80) return 'score-high'
  if (score >= 60) return 'score-good'
  if (score >= 40) return 'score-mid'
  return 'score-low'
}

export default function JobCard({
  job,
  index,
  isNew,
  isAiFiltered,
  isSelected,
  onClick
}) {
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

  // Get company initials for placeholder logo
  const initials = useMemo(() => {
    if (!job.company) return '??'
    return job.company
      .split(/\s+/)
      .map(w => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }, [job.company])

  // Stable random color based on company name
  const logoBgColor = useMemo(() => {
    if (!job.company) return 'var(--surface-container-high)'
    const colors = [
      '#1b3a4b', '#2b1b4b', '#1b4b3e', '#4b321b', 
      '#4b1b2b', '#3b4b1b', '#1b1b4b', '#383a59'
    ]
    let hash = 0
    for (let i = 0; i < job.company.length; i++) {
      hash = job.company.charCodeAt(i) + ((hash << 5) - hash)
    }
    const idx = Math.abs(hash) % colors.length
    return colors[idx]
  }, [job.company])

  const cardClasses = [
    'compact-job-card',
    isSelected && 'selected',
    isInactive && 'inactive',
    isAiFiltered && 'ai-filtered'
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cardClasses}
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={() => onClick && onClick(job.id)}
    >
      {/* Left Active/Selected Indicator Stripe */}
      {isSelected && <div className="selected-stripe" />}

      {/* Main Card Content */}
      <div className="card-inner">
        {/* Left Side: Logo Block */}
        <div 
          className="company-logo-block" 
          style={{ backgroundColor: logoBgColor }}
        >
          <span className="logo-initials">{initials}</span>
        </div>

        {/* Middle: Details */}
        <div className="card-details">
          <div className="card-header-row">
            <h3 className="job-title" title={job.title || 'Untitled Position'}>
              {job.title || 'Untitled Position'}
            </h3>
            {job.match_score != null && (
              <span className={`match-badge ${getScoreClass(job.match_score)}`}>
                {Math.round(job.match_score)}% Match
              </span>
            )}
          </div>

          <div className="job-company-sub">
            {job.company || 'Unknown Company'}
            {job.location && <span className="sub-dot">•</span>}
            {job.location && <span className="location-text">{job.location}</span>}
          </div>

          {/* Tags / Metrics at bottom */}
          <div className="bottom-meta-row">
            <div className="card-tags">
              {tags.slice(0, 2).map((tag, i) => (
                <span key={i} className="compact-tag">{tag.toUpperCase()}</span>
              ))}
              {tags.length > 2 && (
                <span className="compact-tag">+{(tags.length - 2)}</span>
              )}
              {job.salary && (
                <span className="compact-tag salary-tag">
                  {job.salary.replace(/\s+/g, '')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
