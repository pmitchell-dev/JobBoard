# 📋 JobBoard — System Context
**Last Updated:** 2026-07-21
**Type:** Node.js / Docker Web App

---

## Purpose
Self-hosted personal job application tracker. Kanban board (Applied → Screening → Interview → Offer → Rejected) with PDF caching, email attachment (.eml drag-and-drop), screenshots, floating quick-notes pad, Master `.docx` base documents, AI-powered customized Resume & Cover Letter generation, and AI Copilot.

---

## Tech Stack
- **Runtime:** Node.js 20 + Express
- **PDF Caching:** Puppeteer (headless Chromium)
- **Document Processing:** Mammoth.js (client-side `.docx` raw text extraction)
- **AI Integration:** Open WebUI API proxy (`/api/chat-proxy/`) for Copilot & AI document generation
- **Frontend:** Vanilla HTML / CSS / JS (no framework, no build step)
- **Design:** Dark glassmorphism, Inter font, CSS custom properties
- **Persistence:** JSON files & `.docx` binaries on disk (bind-mounted in Docker)

---

## Key Files
| File | Purpose |
|---|---|
| `server.js` | Express API, Puppeteer PDF service, Open WebUI AI proxy, Master Docs storage API |
| `public/app.js` | All client-side logic, AI document generation, Copilot chat interface |
| `public/style.css` | Dark-mode glassmorphism design system |
| `public/index.html` | SPA shell |
| `data/jobs.json` | Job records (auto-created) |
| `data/notepad.json` | Quick-notes content (auto-created) |
| `data/settings.json` | Copilot & Open WebUI settings |
| `data/master_docs/` | Master Resume & Cover Letter `.docx` base files + `metadata.json` |
| `data/backups/` | Daily JSON and `.jobboard` zip snapshots |
| `cache/` | Saved PDFs, screenshots, and attachments (bind-mounted) |

---

## AI Functionality & Setup
- Requires an Open WebUI container/server (e.g. `localhost:3002`).
- Requires an Open WebUI API Key configured under Copilot Settings (`⚙️`).
- **Master Base Documents**: Upload generic `.docx` Master Resume and Master Cover Letter on the main dashboard.
- **Generate Resume / Cover**: Click **✨ Generate Resume** or **✨ Generate Cover** in any job modal footer. JobBoard compiles title, company, URL, notes, and emails along with the Master `.docx` base document to produce a customized document saved directly into the task's **Documents** tab.

---

## Deployment
- **Pi port:** `3001` (host) → `3000` (internal) — remapped because Invidious owns 3000
- **Pi deploy path:** `/home/pi/jobboard/`
- **Compose file:** managed by `jobboard-compose.yml` in pi5-scripts
- **Container user:** `1000:1000` — host dirs must be `chown -R 1000:1000`

```bash
docker compose up -d --build  # build and start
```

---

## Backup Strategy
Every write operation:
1. **Rolling backup** — previous `jobs.json` → `jobs.backup.json`
2. **Daily snapshot** — `data/backups/jobboard-backup-YYYY-MM-DD.jobboard` zip snapshot (includes jobs, notepad, settings, master_docs, cache)
3. **Auto-recovery** — corrupted `jobs.json` → restored from `jobs.backup.json` on startup

---

## Key Features
- Master `.docx` base document uploads (Resume & Cover Letter)
- AI-powered customized Resume and Cover Letter generation per job task
- Integrated AI Copilot chat & prompt library (Open WebUI integration)
- Drag `.eml` files from Thunderbird to attach emails to job records
- Puppeteer caches job listing pages as PDFs on job creation
- Paste / drag-and-drop screenshots per job
- Floating draggable notepad auto-saved to server + localStorage
- Export/Import `.jobboard` zip files for full data migration and backups
- Date filtering: today, yesterday, 7/14/30 days, custom range

---

## Notes
- `pi_rebuild.sh` stashes `data/jobs.json` before `git pull` and restores it after to prevent live data loss
- Invidious occupies port 3000 on the Pi — always deploy JobBoard on 3001

