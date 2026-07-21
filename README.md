# JobBoard

> A self-hosted, personal job application tracker — built as a kanban board with full data persistence, email attachment, PDF page caching, Master `.docx` base documents, AI-powered customized Resume & Cover Letter generation, and an integrated AI Copilot.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-20%2B-brightgreen)
![Docker](https://img.shields.io/badge/docker-ready-blue)

---

## Features

| Feature | Description |
|---|---|
| **Kanban Board** | Drag cards between Applied → Screening → Interview → Offer → Rejected |
| **Date Filtering** | Filter by today, yesterday, last 7/14/30 days, or a custom range |
| **Master Base Documents** | Upload generic `.docx` Master Resume and Master Cover Letter base templates on the main dashboard |
| **AI Resume & Cover Letter Generation** | Click **Generate Resume** or **Generate Cover** in any job task to create tailored `.docx` documents saved directly to the task's Documents tab |
| **AI Copilot & Open WebUI** | Built-in chat assistant proxied to your local Open WebUI instance with prompt templates |
| **Job Detail Modal** | Edit title, company, status, URL, date, and screenshots per application |
| **Notes & Update Log** | Timestamped notes per job with delete support |
| **Email Attachment** | Drag `.eml` files from Thunderbird or enter emails manually |
| **PDF Page Cache** | Saves the job listing page as a PDF via headless Chromium |
| **Screenshots** | Paste, drag & drop, or upload screenshots per job |
| **Quick Notepad** | Floating, draggable notepad for interview prep notes — auto-saved to server + localStorage |
| **Rolling Backups** | All data backed up automatically before every write + daily snapshots (14-day retention) |
| **Dark Mode UI** | Premium glassmorphism dark theme |

---

## Quick Start — Docker (Recommended)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- *(Optional for AI Features)* Local or remote [Open WebUI](https://docs.openwebui.com/) instance

### Run

```bash
git clone https://github.com/pmitchell-dev/JobBoard.git
cd JobBoard

# Create host directories for persistent data
mkdir -p data/backups data/master_docs cache

docker compose up -d
```

Open **http://localhost:3000** — that's it.

### Data Persistence

All your data lives on the **host machine**, not inside the container:

| Host path | Container path | Contains |
|---|---|---|
| `./data/` | `/app/data/` | `jobs.json`, `notepad.json`, `settings.json`, daily backups |
| `./data/master_docs/` | `/app/data/master_docs/` | Master `.docx` base Resume & Cover Letter + metadata |
| `./cache/` | `/app/cache/` | Saved PDFs, job screenshots, and attachments |

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

## AI Functionality & Setup

JobBoard features AI-powered document generation and an integrated AI Copilot powered by your local or remote **Open WebUI** instance.

### Prerequisites & Configuration for AI Features

1. **Open WebUI Container / Server**:
   - Ensure an Open WebUI container is running (default: `localhost:3002` or host IP).
2. **API Key**:
   - Obtain an API key from Open WebUI: **Settings → Account → API Keys → Create API Key**.
3. **Configure in JobBoard**:
   - Click the **AI Copilot** button (bottom right) or Settings icon (`⚙️`).
   - Enter your Open WebUI **Host / IP**, **Port** (e.g. `3002`), and **API Key**.
   - Click **Verify Connection** and select your preferred **Default Model** (e.g., `llama3.2`, `mistral`, `qwen2.5`, `claude-3-5-sonnet`).

### How AI Document Generation Works

1. **Upload Base Templates**:
   - On the main dashboard under **Master AI Base Documents**, upload your base `.docx` **Master Resume** and **Master Cover Letter**.
2. **Generate Tailored Documents**:
   - Open any job task detail modal.
   - Click **✨ Generate Resume** or **✨ Generate Cover** in the modal footer.
3. **Context Assembly & Execution**:
   - JobBoard compiles position title, company, listing URL, update log notes, and attached emails (excluding existing document tab text) along with the parsed text from your Master `.docx` file.
   - The AI model generates a customized document tailored specifically for the target position.
   - The generated document is saved automatically into the task's **Documents** tab (`Resume` or `Cover Letter` subtab) where it can be further edited or downloaded as a `.doc` file.

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
│   ├── app.js           # All client-side logic & AI generation
│   └── style.css        # Dark-mode design system
├── data/
│   ├── jobs.json        # Job records (auto-created)
│   ├── notepad.json     # Quick-notes content (auto-created)
│   ├── settings.json    # Copilot & Open WebUI settings
│   ├── master_docs/     # Master Resume & Cover Letter .docx base files
│   └── backups/         # Daily JSON and .jobboard zip snapshots
├── cache/               # Saved PDFs + screenshots + attachments
├── server.js            # Express API + Puppeteer PDF service + AI proxy
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Backup Strategy

Every write operation (adding/editing/deleting a job, saving notes, uploading master docs):

1. **Rolling backup** — previous `jobs.json` copied to `jobs.backup.json` before overwrite
2. **Daily snapshot** — full `.jobboard` zip archive created daily under `data/backups/` (last 5-14 kept)
3. **Auto-recovery** — if `jobs.json` is corrupted on startup, server restores from `jobs.backup.json` automatically

---

## Tech Stack

- **Runtime:** Node.js 20 + Express
- **PDF Caching:** Puppeteer (headless Chromium)
- **Document Processing:** Mammoth.js (client-side `.docx` raw text extraction & HTML conversion)
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework
- **Design:** Dark glassmorphism, Inter font, CSS custom properties
- **Persistence:** JSON files & `.docx` binaries on disk (bind-mounted in Docker)

---

## License

[MIT](LICENSE) — free to use, modify, and self-host.
