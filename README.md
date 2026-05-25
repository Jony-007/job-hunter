# ⚡ JobHunter — Smart Job Scraper

A production-grade, full-stack job scraper built for IT professionals targeting **IT Support**, **SysAdmin**, and **Cloud Administrator** roles across **multiple locations** (Regina, Saskatoon, Winnipeg, and Remote Canada by default).

![Stack](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square)
![Stack](https://img.shields.io/badge/Scraper-Playwright-2EAD33?style=flat-square)
![Stack](https://img.shields.io/badge/Frontend-React+Vite-646CFF?style=flat-square)
![Stack](https://img.shields.io/badge/Database-SQLite_WAL-003B57?style=flat-square)

## 🎯 Features

- **Multi-location support** — concurrently scrapes multiple cities (Regina, Saskatoon, Winnipeg) plus Remote Canada
- **Multi-source scraping** — LinkedIn, Indeed, Glassdoor
- **Smart match scoring** (0–100) based on title, tech stack, location, experience
- **Auto-tag extraction** — Azure, PowerShell, M365, Active Directory, and 20+ keywords
- **Stealth mode** — anti-bot detection with Playwright, cookie persistence, human-like behavior
- **Real-time dashboard** — SSE-powered React frontend with live updates
- **AI filtering** — Claude-powered natural language job filtering
- **Desktop notifications** — instant alerts for new high-match jobs
- **Job pipeline** — track status: New → Saved → Applied → Interview → Offer
- **Auto-deactivation** — jobs not seen in 3 scrapes are marked inactive
- **Watchdog** — auto-restarts frozen scraper processes

## 📋 Prerequisites

- **Python 3.11+** — [Download](https://python.org)
- **Node.js 18+** — [Download](https://nodejs.org)

## 🚀 Quick Start

### Windows
```bash
# Just double-click run.bat, or:
run.bat
```

### Linux / Mac
```bash
chmod +x run.sh
./run.sh
```

That's it! The launcher will:
1. ✅ Check Python and Node.js versions
2. 📦 Install all dependencies
3. 🌐 Install Playwright Chromium
4. 🖥 Start the API server (port 8000)
5. 🔍 Start the scraper
6. 🎨 Start the frontend (port 5173)
7. 🌐 Open your browser

## 🏗 Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Frontend   │────▶│   FastAPI API     │────▶│   SQLite DB  │
│  React+Vite  │◀────│  (+ Watchdog)     │◀────│   (WAL mode) │
│  :5173       │ SSE │  :8000            │     │   jobs.db    │
└──────────────┘     └──────────────────┘     └──────────────┘
                              ▲                       ▲
                              │ trigger               │ write
                              │                       │
                     ┌──────────────────┐             │
                     │    Scraper       │─────────────┘
                     │  (Playwright)    │
                     │  30min cycle     │
                     └──────────────────┘
```

## ⚙️ Configuration

### Change Search Keywords
Edit `backend/scraper.py` at the top:
```python
SEARCH_QUERIES = ['IT Support', 'SysAdmin', 'Systems Administrator', 'Cloud Administrator']
```

### Add or Remove Locations
Edit the `LOCATIONS` list in `backend/scraper.py`. You can easily add any Canadian or global location by providing its name, platform-specific URL-encoded filters, scoring keywords, and target priority:
```python
LOCATIONS = [
    {
        "name": "Regina, SK",
        "linkedin": "Regina%2C+Saskatchewan%2C+Canada",
        "indeed": "Regina%2C+Saskatchewan",
        "glassdoor": "regina-saskatchewan-it-support-jobs-SRCH_IL.0,19_IS8219_KO20,30.htm",
        "score_keywords": ["regina", "saskatchewan"],
        "score_primary": 20,
    },
    # Add your location here...
]
```

### Change Scrape Frequency
Edit `backend/scraper.py`:
```python
SCRAPE_INTERVAL_MINUTES = 30  # Change to desired interval
```

### Enable AI Filtering
Create `backend/.env`:
```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```
The AI filter in the dashboard will then be able to filter jobs using natural language (e.g., "Hide jobs requiring 10+ years experience").

### Add More Job Sites
1. Create a new `scrape_yoursite()` async function in `scraper.py`
2. Add it to the `SCRAPERS` list in `run_scrape_cycle()`
3. Follow the pattern of existing scrapers (use stealth, handle errors, return job dicts)

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/jobs` | GET | Paginated job listing with filters |
| `/jobs/new` | GET | New unnotified jobs |
| `/jobs/{id}/status` | PATCH | Update job pipeline status |
| `/jobs/{id}` | DELETE | Soft-delete a job |
| `/stats` | GET | Dashboard statistics |
| `/scrape/trigger` | POST | Manually trigger a scrape |
| `/scrape/log` | GET | Recent scrape history |
| `/events` | GET | SSE real-time stream |
| `/ai/filter` | POST | AI-powered job filtering |
| `/health` | GET | System health check |

Full interactive docs: **http://localhost:8000/docs**

## 🔍 Match Scoring (0–100)

| Signal | Points |
|--------|--------|
| Title: IT Support, SysAdmin, Cloud Admin, etc. | +25 |
| Title: Helpdesk, Desktop Support, etc. | +15 |
| Tech: Azure, M365, Active Directory, Intune | +20 |
| Tech: PowerShell, Windows Server, Exchange | +10 |
| Location: Regina | +20 |
| Location: Remote | +10 |
| Location: Saskatchewan | +5 |
| Experience: Entry level, 1-3 years | +10 |
| Experience: 8+ years, Senior | -10 |
| Red flags: Commission, unpaid, volunteer | -30 |

## 🛠 Troubleshooting

### LinkedIn is blocking the scraper
```bash
# Delete the session cookies and retry
del backend\cookies.json
# or on Linux/Mac:
rm backend/cookies.json
```
LinkedIn is the most aggressive at bot detection. The stealth module builds trust over time through cookie persistence. The first few runs may get blocked.

### Port 8000 is already in use
Edit `backend/api.py` — change the port in the `uvicorn.run()` call:
```python
uvicorn.run("api:app", host="0.0.0.0", port=8001)
```
Then update `frontend/src/api.js`:
```javascript
const BASE_URL = 'http://localhost:8001'
```

### Playwright not found
```bash
pip install playwright
playwright install chromium
# or:
python -m playwright install chromium
```

### Database locked error
```bash
# Stop all processes, then:
del backend\scraper.lock
# or on Linux/Mac:
rm backend/scraper.lock
```
The SQLite database uses WAL mode to prevent locking, but if both the scraper and API crash simultaneously, you may need to clean up.

### Scraper seems frozen
The watchdog (running as a background task in the API server) automatically detects frozen scrapers and restarts them. Check the logs:
```bash
type backend\scraper.log
# or on Linux/Mac:
tail -f backend/scraper.log
```

### Frontend shows "Backend offline"
Make sure the API server is running:
```bash
cd backend
python -m uvicorn api:app --host 0.0.0.0 --port 8000
```

## 📁 Project Structure

```
job-hunter/
├── backend/
│   ├── api.py          # FastAPI server + SSE + AI filter proxy
│   ├── database.py     # SQLite with WAL mode, async operations
│   ├── migrations.py   # Schema version management
│   ├── scraper.py      # LinkedIn/Indeed/Glassdoor scrapers
│   ├── stealth.py      # Anti-detection, cookies, rate limiting
│   ├── notifier.py     # Desktop notifications (plyer)
│   ├── watchdog.py     # Process health monitoring
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main app with state management
│   │   ├── api.js           # API client + SSE helper
│   │   ├── index.css        # Premium dark design system
│   │   └── components/
│   │       ├── JobCard.jsx      # Job display with scoring
│   │       ├── Sidebar.jsx      # Filters + controls
│   │       ├── StatsBar.jsx     # Dashboard stats
│   │       ├── AiFilter.jsx     # AI-powered filtering
│   │       ├── Pagination.jsx   # Load more pagination
│   │       └── OfflineBanner.jsx # Connection status
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── run.bat             # Windows launcher
├── run.sh              # Linux/Mac launcher
├── .gitignore
└── README.md
```

## 📄 License

MIT — use it, modify it, land that job! 🚀
