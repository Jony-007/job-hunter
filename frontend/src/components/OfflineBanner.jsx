import React, { useState, useEffect, useRef } from 'react'
import { checkHealth } from '../api'

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [lastOnline, setLastOnline] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    const check = async () => {
      const result = await checkHealth()
      if (result.error) {
        setIsOnline(false)
      } else {
        setIsOnline(true)
        setLastOnline(new Date())
      }
    }

    check()
    pollRef.current = setInterval(check, 10000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  if (isOnline) return null

  return (
    <div className="offline-banner">
      <span className="offline-banner-dot" />
      Backend is offline — some features may not work
      {lastOnline && (
        <span className="offline-banner-time">
          Last connected {lastOnline.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })}
        </span>
      )}
    </div>
  )
}
