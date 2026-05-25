const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

// ── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, 'data');
const CACHE_DIR      = path.join(__dirname, 'cache');
const BACKUPS_DIR    = path.join(DATA_DIR, 'backups');
const JOBS_FILE      = path.join(DATA_DIR, 'jobs.json');
const BACKUP_FILE    = path.join(DATA_DIR, 'jobs.backup.json');
const NOTEPAD_FILE   = path.join(DATA_DIR, 'notepad.json');

// ── Bootstrap directories ────────────────────────────────────────────────────
[DATA_DIR, CACHE_DIR, BACKUPS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

if (!fs.existsSync(JOBS_FILE)) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(NOTEPAD_FILE)) {
  fs.writeFileSync(NOTEPAD_FILE, JSON.stringify({ text: '', updatedAt: null }, null, 2));
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/cache', express.static(CACHE_DIR));

// ── Backup helpers ───────────────────────────────────────────────────────────

/**
 * Creates a rolling backup (jobs.backup.json) before every write,
 * plus one timestamped daily backup in data/backups/ (kept for 14 days).
 */
function createBackup() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;

    // Safety guard: never overwrite a populated backup with an empty array.
    // This prevents a blank jobs.json (e.g. from a fresh container start or
    // accidental reset) from destroying the last known-good backup.
    const currentJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    if (currentJobs.length === 0 && fs.existsSync(BACKUP_FILE)) {
      const backupJobs = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      if (backupJobs.length > 0) {
        console.warn('[Backup] ⚠️  Skipped — refusing to overwrite a populated backup with an empty jobs list.');
        return;
      }
    }

    // Rolling backup — always kept, overwritten each time
    fs.copyFileSync(JOBS_FILE, BACKUP_FILE);

    // Daily snapshot
    const today = new Date().toISOString().split('T')[0];
    const dailyFile = path.join(BACKUPS_DIR, `jobs-${today}.json`);
    if (!fs.existsSync(dailyFile)) {
      fs.copyFileSync(JOBS_FILE, dailyFile);
    }

    // Prune daily backups — keep last 14
    const backups = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('jobs-') && f.endsWith('.json'))
      .sort();
    while (backups.length > 14) {
      fs.unlinkSync(path.join(BACKUPS_DIR, backups.shift()));
    }
  } catch (err) {
    console.error('[Backup] Failed:', err.message);
  }
}

// ── Data helpers ─────────────────────────────────────────────────────────────
function readJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch {
    // Attempt auto-recovery from rolling backup
    if (fs.existsSync(BACKUP_FILE)) {
      console.warn('[Recovery] jobs.json corrupted — restoring from backup...');
      fs.copyFileSync(BACKUP_FILE, JOBS_FILE);
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    }
    console.error('[Recovery] No backup available — starting fresh.');
    return [];
  }
}

function writeJobs(jobs) {
  createBackup();                                          // backup before write
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

// ── REST API ─────────────────────────────────────────────────────────────────

// GET  /api/jobs
app.get('/api/jobs', (req, res) => {
  res.json(readJobs());
});

// POST /api/jobs  — create
app.post('/api/jobs', (req, res) => {
  const jobs = readJobs();
  const job = {
    id:          uuidv4(),
    company:     (req.body.company  || '').trim(),
    title:       (req.body.title    || '').trim(),
    url:         (req.body.url      || '').trim(),
    dateApplied: req.body.dateApplied || new Date().toISOString().split('T')[0],
    status:      req.body.status   || 'applied',
    notes:       [],
    emails:      [],
    cached:      false,
    screenshot:  false,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  jobs.push(job);
  writeJobs(jobs);
  res.json(job);
});

// PUT  /api/jobs/:id  — update fields (NOT notes — use /notes endpoint)
app.put('/api/jobs/:id', (req, res) => {
  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  // Protect immutable fields
  const { id, createdAt, notes, ...rest } = req.body;
  jobs[idx] = { ...jobs[idx], ...rest, id: jobs[idx].id, createdAt: jobs[idx].createdAt, updatedAt: new Date().toISOString() };
  writeJobs(jobs);
  res.json(jobs[idx]);
});

// DELETE /api/jobs/:id
app.delete('/api/jobs/:id', (req, res) => {
  let jobs = readJobs();
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  jobs = jobs.filter(j => j.id !== req.params.id);
  writeJobs(jobs);

  // Clean up cache artefacts
  [
    path.join(CACHE_DIR, `${req.params.id}.pdf`),
    path.join(CACHE_DIR, `${req.params.id}-screenshot.png`),
  ].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

  res.json({ success: true });
});

// POST /api/jobs/:id/notes  — append timestamped note
app.post('/api/jobs/:id/notes', (req, res) => {
  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  const note = {
    id:        uuidv4(),
    text:      (req.body.text || '').trim(),
    timestamp: new Date().toISOString(),
  };
  if (!note.text) return res.status(400).json({ error: 'Note text required' });

  jobs[idx].notes = jobs[idx].notes || [];
  jobs[idx].notes.push(note);
  jobs[idx].updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json(note);
});

// DELETE /api/jobs/:id/notes/:noteId  — remove a note
app.delete('/api/jobs/:id/notes/:noteId', (req, res) => {
  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  jobs[idx].notes = (jobs[idx].notes || []).filter(n => n.id !== req.params.noteId);
  jobs[idx].updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json({ success: true });
});

// POST /api/jobs/:id/emails  — attach an email
app.post('/api/jobs/:id/emails', (req, res) => {
  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  const email = {
    id:        uuidv4(),
    from:      (req.body.from    || '').trim(),
    subject:   (req.body.subject || '').trim(),
    date:      req.body.date     || new Date().toISOString().split('T')[0],
    body:      (req.body.body    || '').trim(),
    addedAt:   new Date().toISOString(),
  };
  if (!email.from && !email.subject) return res.status(400).json({ error: 'From or Subject required' });

  jobs[idx].emails = jobs[idx].emails || [];
  jobs[idx].emails.push(email);
  jobs[idx].updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json(email);
});

// DELETE /api/jobs/:id/emails/:emailId  — remove an email
app.delete('/api/jobs/:id/emails/:emailId', (req, res) => {
  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  jobs[idx].emails = (jobs[idx].emails || []).filter(e => e.id !== req.params.emailId);
  jobs[idx].updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json({ success: true });
});

// POST /api/cache  — print a PDF snapshot of a job URL using headless Chrome
app.post('/api/cache', async (req, res) => {
  const { url, jobId } = req.body;
  if (!url || !jobId) return res.status(400).json({ error: 'url and jobId required' });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Small settle pause for JS-rendered content
    await new Promise(r => setTimeout(r, 1500));

    const pdfFile = path.join(CACHE_DIR, `${jobId}.pdf`);
    await page.pdf({
      path:            pdfFile,
      format:          'A4',
      printBackground: true,
      margin:          { top: '15mm', bottom: '20mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="font-size:9px;color:#666;width:100%;text-align:center;padding:0 12mm;">
          Saved from: <span style="color:#4f46e5">${url}</span>
          &nbsp;·&nbsp;
          <span class="date"></span>
        </div>`,
    });

    // Mark job as cached
    const jobs = readJobs();
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      jobs[idx].cached    = true;
      jobs[idx].cacheType = 'pdf';
      jobs[idx].updatedAt = new Date().toISOString();
      writeJobs(jobs);
    }

    res.json({ success: true, type: 'pdf' });
  } catch (err) {
    console.error('[PDF cache] Failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// POST /api/screenshot/:id  — save base64 image
app.post('/api/screenshot/:id', (req, res) => {
  const jobId = req.params.id;
  const { imageData } = req.body;
  if (!imageData) return res.status(400).json({ error: 'imageData required' });

  try {
    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const file = path.join(CACHE_DIR, `${jobId}-screenshot.png`);
    fs.writeFileSync(file, buffer);

    const jobs = readJobs();
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      jobs[idx].screenshot = true;
      jobs[idx].updatedAt = new Date().toISOString();
      writeJobs(jobs);
    }

    res.json({ success: true, url: `/cache/${jobId}-screenshot.png` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/screenshot/:id  — remove screenshot
app.delete('/api/screenshot/:id', (req, res) => {
  const file = path.join(CACHE_DIR, `${req.params.id}-screenshot.png`);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx !== -1) {
    jobs[idx].screenshot = false;
    jobs[idx].updatedAt = new Date().toISOString();
    writeJobs(jobs);
  }
  res.json({ success: true });
});

// GET /api/notepad  — load notepad content
app.get('/api/notepad', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(NOTEPAD_FILE, 'utf8'));
    res.json(data);
  } catch {
    res.json({ text: '', updatedAt: null });
  }
});

// PUT /api/notepad  — save notepad content (with backup)
app.put('/api/notepad', (req, res) => {
  try {
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const now  = new Date().toISOString();

    // Rolling backup of previous notepad
    if (fs.existsSync(NOTEPAD_FILE)) {
      fs.copyFileSync(NOTEPAD_FILE, path.join(DATA_DIR, 'notepad.backup.json'));
    }

    // Daily snapshot (stored alongside job snapshots)
    const today = now.split('T')[0];
    const dailyNotepad = path.join(BACKUPS_DIR, `notepad-${today}.json`);
    if (!fs.existsSync(dailyNotepad) && fs.existsSync(NOTEPAD_FILE)) {
      fs.copyFileSync(NOTEPAD_FILE, dailyNotepad);
    }

    // Prune old notepad daily backups — keep last 14
    const npBackups = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('notepad-') && f.endsWith('.json'))
      .sort();
    while (npBackups.length > 14) {
      fs.unlinkSync(path.join(BACKUPS_DIR, npBackups.shift()));
    }

    const payload = { text, updatedAt: now };
    fs.writeFileSync(NOTEPAD_FILE, JSON.stringify(payload, null, 2));
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backup-status
app.get('/api/backup-status', (req, res) => {
  const hasRolling = fs.existsSync(BACKUP_FILE);
  const daily = fs.existsSync(BACKUPS_DIR)
    ? fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json')).sort().reverse()
    : [];
  res.json({
    hasRollingBackup: hasRolling,
    lastBackup: hasRolling ? fs.statSync(BACKUP_FILE).mtime : null,
    dailyBackups: daily,
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  JobBoard  →  http://localhost:${PORT}`);
  console.log(`📁  Data      →  ${DATA_DIR}`);
  console.log(`💾  Cache     →  ${CACHE_DIR}`);
  console.log(`🔒  Backups   →  ${BACKUPS_DIR}\n`);
  createBackup(); // warm backup on start
});
