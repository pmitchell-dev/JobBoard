const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');
const { ZipArchive } = require('archiver');
const unzipper = require('unzipper');
const multer  = require('multer');

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
    screenshots: [],
    attachments: [],
    cached:      false,
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

  // Clean up PDF cache
  const pdfFile = path.join(CACHE_DIR, `${req.params.id}.pdf`);
  if (fs.existsSync(pdfFile)) fs.unlinkSync(pdfFile);

  // Clean up all screenshots (new array format)
  (job.screenshots || []).forEach(s => {
    const f = path.join(CACHE_DIR, s.filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  // Legacy single screenshot
  const legacyFile = path.join(CACHE_DIR, `${req.params.id}-screenshot.png`);
  if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);

  // Clean up all attachments
  (job.attachments || []).forEach(a => {
    const f = path.join(CACHE_DIR, a.filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

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

// POST /api/screenshot/:id  — add a screenshot (supports multiple)
app.post('/api/screenshot/:id', (req, res) => {
  const jobId = req.params.id;
  const { imageData } = req.body;
  if (!imageData) return res.status(400).json({ error: 'imageData required' });

  try {
    const screenshotId = uuidv4();
    const base64  = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer  = Buffer.from(base64, 'base64');
    const filename = `${jobId}-screenshot-${screenshotId}.png`;
    fs.writeFileSync(path.join(CACHE_DIR, filename), buffer);

    const jobs = readJobs();
    const idx  = jobs.findIndex(j => j.id === jobId);
    if (idx === -1) return res.status(404).json({ error: 'Job not found' });

    if (!Array.isArray(jobs[idx].screenshots)) jobs[idx].screenshots = [];
    const screenshot = { id: screenshotId, filename, addedAt: new Date().toISOString() };
    jobs[idx].screenshots.push(screenshot);
    jobs[idx].updatedAt = new Date().toISOString();
    writeJobs(jobs);

    res.json({ success: true, screenshot, url: `/cache/${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/screenshot/:id/:screenshotId  — remove one screenshot
app.delete('/api/screenshot/:id/:screenshotId', (req, res) => {
  const { id: jobId, screenshotId } = req.params;

  const jobs = readJobs();
  const idx  = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  const job = jobs[idx];
  if (Array.isArray(job.screenshots)) {
    const shot = job.screenshots.find(s => s.id === screenshotId);
    if (shot) {
      const f = path.join(CACHE_DIR, shot.filename);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    job.screenshots = job.screenshots.filter(s => s.id !== screenshotId);
  }
  job.updatedAt = new Date().toISOString();
  writeJobs(jobs);
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

// ── Attachments (Other Documents) ───────────────────────────────────────────

// POST /api/jobs/:id/attachments  — upload a file attachment
const attachUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CACHE_DIR),
    filename:    (req, file, cb) => {
      const attachId = uuidv4();
      const ext = path.extname(file.originalname) || '';
      cb(null, `${req.params.id}-attach-${attachId}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

app.post('/api/jobs/:id/attachments', attachUpload.single('file'), (req, res) => {
  const jobId = req.params.id;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const jobs = readJobs();
  const idx  = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) {
    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!Array.isArray(jobs[idx].attachments)) jobs[idx].attachments = [];
  const attachment = {
    id:           path.basename(req.file.filename, path.extname(req.file.filename)).split('-attach-')[1] || uuidv4(),
    filename:     req.file.filename,
    originalName: req.file.originalname,
    size:         req.file.size,
    mimetype:     req.file.mimetype,
    addedAt:      new Date().toISOString(),
  };
  jobs[idx].attachments.push(attachment);
  jobs[idx].updatedAt = new Date().toISOString();
  writeJobs(jobs);

  res.json({ success: true, attachment, url: `/cache/${req.file.filename}` });
});

// DELETE /api/jobs/:id/attachments/:attachId  — remove one attachment
app.delete('/api/jobs/:id/attachments/:attachId', (req, res) => {
  const { id: jobId, attachId } = req.params;

  const jobs = readJobs();
  const idx  = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  const job = jobs[idx];
  if (Array.isArray(job.attachments)) {
    const att = job.attachments.find(a => a.id === attachId);
    if (att) {
      const f = path.join(CACHE_DIR, att.filename);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    job.attachments = job.attachments.filter(a => a.id !== attachId);
  }
  job.updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json({ success: true });
});

// GET /api/jobs/:id/export-pdf  — generate a full job dossier PDF
app.get('/api/jobs/:id/export-pdf', async (req, res) => {
  const job = readJobs().find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Helper: read a cache file as a base64 data URI
  function fileToDataUri(filename) {
    try {
      const filepath = path.join(CACHE_DIR, filename);
      if (!fs.existsSync(filepath)) return null;
      const ext  = path.extname(filename).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png'
                 : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                 : ext === 'webp' ? 'image/webp'
                 : ext === 'gif'  ? 'image/gif'
                 : null;
      if (!mime) return null;
      const data = fs.readFileSync(filepath).toString('base64');
      return `data:${mime};base64,${data}`;
    } catch { return null; }
  }

  // Helper: format a date string nicely
  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return d; }
  }
  function fmtTs(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return iso; }
  }
  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  const STATUS_LABELS = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };
  const STATUS_COLORS = { applied: '#6366f1', screening: '#f59e0b', interview: '#3b82f6', offer: '#10b981', rejected: '#ef4444' };
  const statusLabel = STATUS_LABELS[job.status] || job.status;
  const statusColor = STATUS_COLORS[job.status] || '#6366f1';

  // Build screenshot img tags
  const screenshots = (job.screenshots || []).map(s => {
    const uri = fileToDataUri(s.filename);
    return uri ? `<div class="ss-wrap"><img src="${uri}" alt="Screenshot" /></div>` : '';
  }).filter(Boolean).join('');

  // Build notes HTML
  const notesHtml = (job.notes || []).length === 0
    ? '<p class="empty">No notes recorded.</p>'
    : [...(job.notes || [])].reverse().map(n => `
        <div class="note-entry">
          <div class="note-ts">${fmtTs(n.timestamp)}</div>
          <div class="note-body">${n.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
        </div>`).join('');

  // Build emails HTML
  const emailsHtml = (job.emails || []).length === 0
    ? '<p class="empty">No emails recorded.</p>'
    : [...(job.emails || [])].sort((a,b) => (b.date||b.addedAt) < (a.date||a.addedAt) ? -1 : 1).map(em => `
        <div class="email-entry">
          <div class="email-head">
            <span class="email-from">${(em.from||'(no sender)').replace(/</g,'&lt;')}</span>
            <span class="email-date">${fmtDate(em.date)}</span>
          </div>
          <div class="email-subj">${(em.subject||'(no subject)').replace(/</g,'&lt;')}</div>
          ${em.body ? `<div class="email-body">${em.body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>` : ''}
        </div>`).join('');

  // Build attachments list
  const attachHtml = (job.attachments || []).length === 0
    ? '<p class="empty">No other attachments.</p>'
    : `<ul class="attach-list">${(job.attachments||[]).map(a =>
        `<li><strong>${a.originalName.replace(/</g,'&lt;')}</strong> <span class="meta">${fmtSize(a.size)} &middot; added ${fmtDate(a.addedAt)}</span></li>`
      ).join('')}</ul>`;

  const safeTitle = `${job.title} — ${job.company}`.replace(/[<>"]/g, '');
  const exportDate = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${safeTitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a2e; background: #fff; line-height: 1.5; }

  /* ── Page header ── */
  .page-header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%); color: #fff; padding: 32px 40px 24px; }
  .job-title   { font-size: 22pt; font-weight: 700; letter-spacing: -0.3px; margin-bottom: 4px; }
  .job-company { font-size: 13pt; color: #94a3b8; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; }
  .meta-row    { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .status-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; background: ${statusColor}22; color: ${statusColor}; border: 1.5px solid ${statusColor}66; }
  .meta-item   { font-size: 9.5pt; color: #94a3b8; }
  .meta-item strong { color: #cbd5e1; }
  .export-date { margin-left: auto; font-size: 8.5pt; color: #475569; }

  /* ── Sections ── */
  .content { padding: 0 40px 40px; }
  .section { margin-top: 28px; }
  .section-title {
    font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
    color: #6366f1; border-bottom: 2px solid #e0e7ff; padding-bottom: 6px; margin-bottom: 14px;
  }

  /* ── URL ── */
  .url-link { font-size: 9.5pt; color: #4f46e5; word-break: break-all; }

  /* ── Notes ── */
  .note-entry  { border-left: 3px solid #6366f1; padding: 8px 12px; margin-bottom: 10px; background: #f8f7ff; border-radius: 0 6px 6px 0; }
  .note-ts     { font-size: 8pt; color: #94a3b8; margin-bottom: 4px; }
  .note-body   { font-size: 10pt; color: #1e293b; }

  /* ── Emails ── */
  .email-entry { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .email-head  { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
  .email-from  { font-size: 10pt; font-weight: 600; color: #1e293b; }
  .email-date  { font-size: 8.5pt; color: #94a3b8; }
  .email-subj  { font-size: 9.5pt; color: #475569; font-style: italic; margin-bottom: 6px; }
  .email-body  { font-size: 9pt; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 8px; margin-top: 6px; max-height: 200px; overflow: hidden; }

  /* ── Resume / Cover Letter ── */
  .doc-content { font-size: 10pt; color: #1e293b; line-height: 1.6; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafafa; }
  .doc-content h1 { font-size: 14pt; margin: 0.4em 0 0.2em; }
  .doc-content h2 { font-size: 12pt; margin: 0.4em 0 0.2em; }
  .doc-content h3 { font-size: 11pt; margin: 0.3em 0 0.15em; }
  .doc-content p  { margin: 0 0 0.3em; }
  .doc-content ul, .doc-content ol { margin: 0.2em 0 0.4em 1.4em; }
  .doc-content li { margin-bottom: 0.1em; }
  .doc-content b, .doc-content strong { font-weight: 700; }
  .doc-content i, .doc-content em     { font-style: italic; }
  .doc-content u                      { text-decoration: underline; }

  /* ── Screenshots ── */
  .screenshots-grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .ss-wrap { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; max-width: 48%; }
  .ss-wrap img { width: 100%; height: auto; display: block; }

  /* ── Attachments ── */
  .attach-list { padding-left: 18px; }
  .attach-list li { margin-bottom: 6px; font-size: 10pt; }
  .attach-list .meta { color: #94a3b8; font-size: 8.5pt; }

  /* ── Empty state ── */
  .empty { color: #94a3b8; font-style: italic; font-size: 9.5pt; }

  /* ── Page breaks ── */
  .section { page-break-inside: avoid; }
  .ss-wrap  { page-break-inside: avoid; }
</style>
</head>
<body>

<div class="page-header">
  <div class="job-title">${safeTitle.split(' — ')[0]}</div>
  <div class="job-company">${job.company.replace(/</g,'&lt;')}</div>
  <div class="meta-row">
    <span class="status-badge">${statusLabel}</span>
    <span class="meta-item">Date Applied: <strong>${fmtDate(job.dateApplied)}</strong></span>
    ${job.notes?.length ? `<span class="meta-item">Notes: <strong>${job.notes.length}</strong></span>` : ''}
    ${job.emails?.length ? `<span class="meta-item">Emails: <strong>${job.emails.length}</strong></span>` : ''}
    ${job.screenshots?.length ? `<span class="meta-item">Screenshots: <strong>${job.screenshots.length}</strong></span>` : ''}
    <span class="export-date">Exported ${exportDate}</span>
  </div>
</div>

<div class="content">

  ${job.url ? `
  <div class="section">
    <div class="section-title">Job Listing URL</div>
    <a class="url-link" href="${job.url.replace(/"/g,'&quot;')}">${job.url.replace(/</g,'&lt;')}</a>
  </div>` : ''}

  <div class="section">
    <div class="section-title">Notes &amp; Updates</div>
    ${notesHtml}
  </div>

  <div class="section">
    <div class="section-title">Emails</div>
    ${emailsHtml}
  </div>

  ${job.resume ? `
  <div class="section">
    <div class="section-title">Resume</div>
    <div class="doc-content">${job.resume}</div>
  </div>` : ''}

  ${job.coverLetter ? `
  <div class="section">
    <div class="section-title">Cover Letter</div>
    <div class="doc-content">${job.coverLetter}</div>
  </div>` : ''}

  ${screenshots ? `
  <div class="section">
    <div class="section-title">Screenshots</div>
    <div class="screenshots-grid">${screenshots}</div>
  </div>` : ''}

  <div class="section">
    <div class="section-title">Other Attachments</div>
    ${attachHtml}
  </div>

</div>
</body>
</html>`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const safeName = `${job.title} - ${job.company}`.replace(/[/\\?%*:|"<>]/g, '-');
    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin: { top: '0', bottom: '14mm', left: '0', right: '0' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;color:#94a3b8;width:100%;text-align:center;padding:0 10mm;">
        ${safeTitle} &nbsp;·&nbsp; <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>`,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdfBuffer);
    console.log(`[PDF Export] Generated: ${safeName}.pdf`);
  } catch (err) {
    console.error('[PDF Export] Failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
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

// ── Export / Import ───────────────────────────────────────────────────────────

// GET /api/export  — download everything as a .jobboard zip
app.get('/api/export', (req, res) => {
  const date     = new Date().toISOString().split('T')[0];
  const filename = `jobboard-export-${date}.jobboard`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', err => {
    console.error('[Export] Archive error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  archive.pipe(res);

  // Core data files
  if (fs.existsSync(JOBS_FILE))    archive.file(JOBS_FILE,    { name: 'jobs.json' });
  if (fs.existsSync(NOTEPAD_FILE)) archive.file(NOTEPAD_FILE, { name: 'notepad.json' });

  // Cache directory (screenshots + PDFs + attachments)
  if (fs.existsSync(CACHE_DIR)) {
    const cacheFiles = fs.readdirSync(CACHE_DIR);
    cacheFiles.forEach(f => {
      archive.file(path.join(CACHE_DIR, f), { name: `cache/${f}` });
    });
  }

  archive.finalize();
  console.log(`[Export] Sent ${filename}`);
});

// POST /api/import  — restore from a .jobboard zip
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 500 * 1024 * 1024 }, // 500 MB max
});

app.post('/api/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const mode = (req.body.mode || 'replace').toLowerCase();
  if (mode !== 'replace' && mode !== 'merge') {
    return res.status(400).json({ error: 'mode must be "replace" or "merge"' });
  }

  try {
    // Read zip into memory and build a map of entry name → buffer
    const zipBuffer = req.file.buffer;
    const directory = await unzipper.Open.buffer(zipBuffer);
    const entryMap  = {};
    for (const entry of directory.files) {
      entryMap[entry.path] = entry;
    }

    if (!entryMap['jobs.json']) {
      return res.status(400).json({ error: 'Invalid export file — jobs.json not found inside zip' });
    }

    // Read imported data
    const importedJobsBuf  = await entryMap['jobs.json'].buffer();
    const importedJobs     = JSON.parse(importedJobsBuf.toString('utf8'));
    const importedNotepadBuf = entryMap['notepad.json'] ? await entryMap['notepad.json'].buffer() : null;
    const importedNotepad    = importedNotepadBuf ? JSON.parse(importedNotepadBuf.toString('utf8')) : null;

    let added = 0, skipped = 0;

    if (mode === 'replace') {
      // Backup first
      createBackup();

      // Replace jobs
      writeJobs(importedJobs);
      added = importedJobs.length;

      // Replace notepad
      if (importedNotepad) {
        fs.writeFileSync(NOTEPAD_FILE, JSON.stringify(importedNotepad, null, 2));
      }

      // Replace all cache files
      for (const [entryPath, entry] of Object.entries(entryMap)) {
        if (entryPath.startsWith('cache/') && (entryPath.endsWith('.png') || entryPath.endsWith('.pdf'))) {
          const filename = path.basename(entryPath);
          const buf = await entry.buffer();
          fs.writeFileSync(path.join(CACHE_DIR, filename), buf);
        }
      }

    } else {
      // Merge: only add jobs with IDs that don't already exist
      const existingJobs = readJobs();
      const existingIds  = new Set(existingJobs.map(j => j.id));
      const toAdd        = importedJobs.filter(j => !existingIds.has(j.id));
      skipped            = importedJobs.length - toAdd.length;
      added              = toAdd.length;

      if (toAdd.length > 0) {
        writeJobs([...existingJobs, ...toAdd]);

        // Copy cache files only for newly added jobs
        const newIds = new Set(toAdd.map(j => j.id));
        for (const [entryPath, entry] of Object.entries(entryMap)) {
          if (entryPath.startsWith('cache/')) {
            const filename = path.basename(entryPath);
            // Match by job ID prefix (screenshots, PDFs, and attachments all start with jobId)
            const isNew = [...newIds].some(id => filename.startsWith(id));
            if (isNew) {
              const buf = await entry.buffer();
              fs.writeFileSync(path.join(CACHE_DIR, filename), buf);
            }
          }
        }
      }

      // Merge notepad: append imported text to existing with a divider
      if (importedNotepad && importedNotepad.text) {
        const existing = JSON.parse(fs.readFileSync(NOTEPAD_FILE, 'utf8'));
        const combined = (existing.text || '').trim();
        const divider  = combined ? `\n\n── Imported ${new Date().toISOString().split('T')[0]} ──\n` : '';
        const merged   = combined + divider + importedNotepad.text;
        fs.writeFileSync(NOTEPAD_FILE, JSON.stringify({ text: merged, updatedAt: new Date().toISOString() }, null, 2));
      }
    }

    console.log(`[Import] mode=${mode}  added=${added}  skipped=${skipped}`);
    res.json({ success: true, mode, added, skipped });

  } catch (err) {
    console.error('[Import] Failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  JobBoard  →  http://localhost:${PORT}`);
  console.log(`📁  Data      →  ${DATA_DIR}`);
  console.log(`💾  Cache     →  ${CACHE_DIR}`);
  console.log(`🔒  Backups   →  ${BACKUPS_DIR}\n`);
  createBackup(); // warm backup on start
});
