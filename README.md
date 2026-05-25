# JobBoard

> A self-hosted, personal job application tracker — built as a kanban board with full data persistence, email attachment, PDF page caching, and a floating quick-notes pad.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-20%2B-brightgreen)
![Docker](https://img.shields.io/badge/docker-ready-blue)

---

## Features

| Feature | Description |
|---|---|
| **Kanban Board** | Drag cards between Applied → Screening → Interview → Offer → Rejected |
| **Date Filtering** | Filter by today, yesterday, last 7/14/30 days, or a custom range |
| **Job Detail Modal** | Edit title, company, status, URL, date, and screenshot per application |
| **Notes & Update Log** | Timestamped notes per job with delete support |
| **Email Attachment** | Drag `.eml` files from Thunderbird or enter emails manually |
| **PDF Page Cache** | Saves the job listing page as a PDF via headless Chromium |
| **Screenshots** | Paste, drag & drop, or upload a screenshot per job |
| **Quick Notepad** | Floating, draggable notepad for interview prep notes — auto-saved to server + localStorage |
| **Rolling Backups** | All data backed up automatically before every write + daily snapshots (14-day retention) |
| **Dark Mode UI** | Premium glassmorphism dark theme |

---

## Quick Start — Docker (Recommended)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### Run

```bash
git clone https://github.com/pmitchell-dev/JobBoard.git
cd JobBoard

# Create host directories for persistent data
mkdir -p data/backups cache

docker compose up -d
```

Open **http://localhost:3000** — that's it.

### Data Persistence

All your data lives on the **host machine**, not inside the container:

| Host path | Container path | Contains |
|---|---|---|
| `./data/` | `/app/data/` | `jobs.json`, `notepad.json`, daily backups |
| `./cache/` | `/app/cache/` | Saved PDFs and job screenshots |

Rebuilding or removing the container never touches your data.

### Upgrade

```bash
git pull
docker compose up -d --build
```

---

## Quick Start — Native Node.js

### Prerequisites
- Node.js 18+
- Google Chrome or Chromium installed (for PDF caching feature)

### Run

```bash
git clone https://github.com/pmitchell-dev/JobBoard.git
cd JobBoard
npm install
npm start
```

Open **http://localhost:3000**.

> **PDF caching** requires Chromium. Set the env var if Puppeteer can't find Chrome automatically:
> ```bash
> PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm start
> ```

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `PUPPETEER_EXECUTABLE_PATH` | *(Puppeteer default)* | Path to Chromium/Chrome for PDF caching |
| `NODE_ENV` | `development` | Set to `production` in Docker |

---

## Project Structure

```
JobBoard/
├── public/
│   ├── index.html       # Single-page app shell
│   ├── app.js           # All client-side logic (~1100 lines)
│   └── style.css        # Dark-mode design system
├── data/
│   ├── jobs.json        # Job records (auto-created on first run)
│   ├── notepad.json     # Quick-notes content (auto-created)
│   └── backups/         # Daily JSON snapshots (14-day retention)
├── cache/               # Saved PDFs + screenshots (bind-mounted)
├── server.js            # Express API + Puppeteer PDF service
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Backup Strategy

Every write operation (adding/editing/deleting a job, saving notes):

1. **Rolling backup** — previous `jobs.json` copied to `jobs.backup.json` before overwrite
2. **Daily snapshot** — one `data/backups/jobs-YYYY-MM-DD.json` per day, last 14 kept
3. **Auto-recovery** — if `jobs.json` is corrupted on startup, server restores from `jobs.backup.json` automatically

The quick notepad uses the same three-layer backup pattern with `notepad.json` / `notepad.backup.json`.

---

## Tech Stack

- **Runtime:** Node.js 20 + Express
- **PDF Caching:** Puppeteer (headless Chromium)
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework
- **Design:** Dark glassmorphism, Inter font, CSS custom properties
- **Persistence:** JSON files on disk (bind-mounted in Docker)

---

## License

[MIT](LICENSE) — free to use, modify, and self-host.
