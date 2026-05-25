import React from 'react'

export default function Pagination({ totalJobs, currentCount, hasMore, onLoadMore, loading }) {
  if (totalJobs === 0 && currentCount === 0) return null

  return (
    <div className="pagination">
      <span className="pagination-info">
        Showing <strong>{currentCount}</strong> of <strong>{totalJobs}</strong> jobs
      </span>

      {hasMore && (
        <button
          className="btn-load-more"
          onClick={onLoadMore}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner" />
              Loading...
            </>
          ) : (
            <>Load More ↓</>
          )}
        </button>
      )}
    </div>
  )
}
