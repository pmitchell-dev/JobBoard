# 📋 JobBoard — System Context
**Last Updated:** 2026-05-27
**Type:** Node.js / Docker Web App

---

## Purpose
Self-hosted personal job application tracker. Kanban board (Applied → Screening → Interview → Offer → Rejected) with PDF caching, email attachment (.eml drag-and-drop), screenshots, and a floating quick-notes pad.

---

## Tech Stack
- **Runtime:** Node.js 20 + Express
- **PDF Caching:** Puppeteer (headless Chromium)
- **Frontend:** Vanilla HTML / CSS / JS (no framework, no build step)
- **Design:** Dark glassmorphism, Inter font, CSS custom properties
- **Persistence:** JSON files on disk (bind-mounted in Docker)

---

## Key Files
| File | Purpose |
|---|---|
| `server.js` | Express API + Puppeteer PDF service (~all backend logic) |
| `public/app.js` | All client-side logic (~1100 lines) |
| `public/style.css` | Dark-mode glassmorphism design system |
| `public/index.html` | SPA shell |
| `data/jobs.json` | Job records (auto-created) |
| `data/notepad.json` | Quick-notes content (auto-created) |
| `data/backups/` | Daily JSON snapshots, 14-day retention |
| `cache/` | Saved PDFs and screenshots (bind-mounted) |

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
2. **Daily snapshot** — `data/backups/jobs-YYYY-MM-DD.json` (14-day retention)
3. **Auto-recovery** — corrupted `jobs.json` → restored from `jobs.backup.json` on startup

---

## Key Features
- Drag `.eml` files from Thunderbird to attach emails to job records
- Puppeteer caches job listing pages as PDFs on job creation
- Paste / drag-and-drop screenshots per job
- Floating draggable notepad auto-saved to server + localStorage
- Export/Import `.jobboard` files for full data migration and backups
- Date filtering: today, yesterday, 7/14/30 days, custom range

---

## Notes
- `pi_rebuild.sh` stashes `data/jobs.json` before `git pull` and restores it after to prevent live data loss
- Invidious occupies port 3000 on the Pi — always deploy JobBoard on 3001
