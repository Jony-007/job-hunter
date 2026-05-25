const BASE_URL = 'http://localhost:8000'

// Universal wrapper to ensure HttpOnly cookies are transmitted across port boundaries
async function fetchWithCreds(url, options = {}) {
  const finalOptions = {
    ...options,
    credentials: 'include'
  }
  return fetch(url, finalOptions)
}

function getAuthHeaders(extra = {}) {
  const token = localStorage.getItem('token')
  const headers = { ...extra }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

export async function loginWithGoogle(idToken) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken })
    })
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      throw new Error(errorData.detail || `HTTP ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    return { error: err.message || 'Authentication failed' }
  }
}

export async function signUpCustom(name, email, password) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return data
  } catch (err) {
    return { error: err.message || 'Signup failed' }
  }
}

export async function loginCustom(email, password) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return data
  } catch (err) {
    return { error: err.message || 'Login failed' }
  }
}

export async function verifyCodeCustom(email, code) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return data
  } catch (err) {
    return { error: err.message || 'Verification failed' }
  }
}

export async function logoutCustom() {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/auth/logout`, {
      method: 'POST'
    })
    const data = await res.json()
    return data
  } catch (err) {
    return { error: err.message || 'Logout failed' }
  }
}

export async function fetchJobs({ status, limit = 50, offset = 0, search, active_only = true } = {}) {
  try {
    const params = new URLSearchParams()
    if (status && status !== 'all') params.append('status', status)
    params.append('limit', limit)
    params.append('offset', offset)
    if (search) params.append('search', search)
    params.append('active_only', active_only)
    const res = await fetchWithCreds(`${BASE_URL}/jobs?${params}`, {
      headers: getAuthHeaders()
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function fetchNewJobs() {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/jobs/new`, {
      headers: getAuthHeaders()
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function fetchStats() {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/stats`, {
      headers: getAuthHeaders()
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function updateStatus(id, status) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/jobs/${id}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function triggerScrape(query, location) {
  try {
    const body = {}
    if (query) body.query = query
    if (location) body.location = location

    const res = await fetchWithCreds(`${BASE_URL}/scrape/trigger`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function deleteJob(id) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/jobs/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function checkHealth() {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/health`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function fetchScrapeLogs() {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/scrape/log`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function aiFilter(filterRule, jobs) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/ai/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter_rule: filterRule, jobs })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { error: 'Backend offline' }
  }
}

export async function fetchJobDescription(id) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/jobs/${id}/fetch-description`, {
      method: 'POST',
      headers: getAuthHeaders()
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    return { error: err.message || 'Description fetch failed' }
  }
}

export async function tailorResume(jobId, resumeText) {
  try {
    const res = await fetchWithCreds(`${BASE_URL}/ai/tailor-resume`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ job_id: jobId, resume_text: resumeText })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    return { error: err.message || 'Tailoring failed' }
  }
}

export async function tailorResumeDocx(jobId, file) {
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('job_id', jobId)

    // Don't set Content-Type — browser sets it with multipart boundary
    const token = localStorage.getItem('token')
    const headers = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const res = await fetchWithCreds(`${BASE_URL}/ai/tailor-resume-docx`, {
      method: 'POST',
      headers,
      body: formData
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || `HTTP ${res.status}`)
    }

    // Extract scores from custom headers
    const originalScore = parseInt(res.headers.get('X-Original-Score') || '0', 10)
    const newScore = parseInt(res.headers.get('X-New-Score') || '0', 10)
    let analysis = ''
    try {
      analysis = JSON.parse(res.headers.get('X-Analysis') || '""')
    } catch { analysis = res.headers.get('X-Analysis') || '' }

    // Extract filename from Content-Disposition
    const disposition = res.headers.get('Content-Disposition') || ''
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
    const downloadName = filenameMatch ? filenameMatch[1] : 'Resume_ATS_Optimized.docx'

    // Get blob for download
    const blob = await res.blob()

    return { blob, downloadName, originalScore, newScore, analysis }
  } catch (err) {
    return { error: err.message || 'DOCX tailoring failed' }
  }
}

export function subscribeToEvents(onStats, onNewJobs, token) {
  const url = token ? `${BASE_URL}/events?token=${encodeURIComponent(token)}` : `${BASE_URL}/events`
  const evtSource = new EventSource(url)
  evtSource.addEventListener('stats', (e) => onStats(JSON.parse(e.data)))
  evtSource.addEventListener('new_jobs', (e) => onNewJobs(JSON.parse(e.data)))
  evtSource.onerror = () => {
    evtSource.close()
  }
  return evtSource
}
