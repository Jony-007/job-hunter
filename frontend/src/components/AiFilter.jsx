import React, { useState, useCallback } from 'react'
import { aiFilter } from '../api'

const EXAMPLE_CHIPS = [
  'Remove senior/lead roles',
  'Only remote jobs',
  'Exclude contract positions',
  'Entry-level only',
  'Must mention cloud'
]

export default function AiFilter({ jobs, onFilter, addToast }) {
  const [filterText, setFilterText] = useState('')
  const [loading, setLoading] = useState(false)
  const [filteredCount, setFilteredCount] = useState(null)

  const handleSubmit = useCallback(async (text) => {
    const rule = text || filterText
    if (!rule.trim()) return
    if (!jobs || jobs.length === 0) {
      addToast('No jobs to filter', 'warning')
      return
    }

    setLoading(true)
    setFilteredCount(null)

    const jobSummaries = jobs.map(j => ({
      id: j.id,
      title: j.title,
      company: j.company,
      description: j.description || j.snippet || '',
      location: j.location || '',
      salary: j.salary || ''
    }))

    const result = await aiFilter(rule, jobSummaries)

    if (result.error) {
      addToast('AI filter failed — backend offline', 'error')
      setLoading(false)
      return
    }

    const excludedIds = result.excluded_ids || result.filtered_ids || []
    onFilter(excludedIds)
    setFilteredCount(excludedIds.length)
    addToast(`AI filtered ${excludedIds.length} job${excludedIds.length !== 1 ? 's' : ''}`, 'info')
    setLoading(false)
  }, [filterText, jobs, onFilter, addToast])

  const handleClear = useCallback(() => {
    setFilterText('')
    setFilteredCount(null)
    onFilter([])
    addToast('AI filter cleared', 'info')
  }, [onFilter, addToast])

  const handleChipClick = useCallback((chipText) => {
    setFilterText(chipText)
    handleSubmit(chipText)
  }, [handleSubmit])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="ai-filter">
      <div className="ai-filter-header">
        <div className="ai-filter-title">
          🤖 AI Filter
        </div>
        {filteredCount !== null && (
          <button className="ai-filter-clear" onClick={handleClear}>
            ✕ Clear Filter
          </button>
        )}
      </div>

      <div className="ai-filter-chips">
        {EXAMPLE_CHIPS.map(chip => (
          <button
            key={chip}
            className="chip"
            onClick={() => handleChipClick(chip)}
            disabled={loading}
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="ai-filter-input-row">
        <input
          className="ai-filter-input"
          type="text"
          placeholder="Describe what to filter out..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="ai-filter-submit"
          onClick={() => handleSubmit()}
          disabled={loading || !filterText.trim()}
        >
          {loading ? (
            <>
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              Filtering...
            </>
          ) : (
            <>⚡ Filter</>
          )}
        </button>
      </div>

      {filteredCount !== null && (
        <div className="ai-filter-result">
          🎯 <strong>{filteredCount}</strong> job{filteredCount !== 1 ? 's' : ''} filtered out
        </div>
      )}
    </div>
  )
}
