const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');
const { ZipArchive } = require('archiver');
const unzipper = require('unzipper');
const multer  = require('multer');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const app = express();
const PORT = 3000;

// ── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, 'data');
const CACHE_DIR      = path.join(__dirname, 'cache');
const BACKUPS_DIR    = path.join(DATA_DIR, 'backups');
const JOBS_FILE      = path.join(DATA_DIR, 'jobs.json');
const BACKUP_FILE    = path.join(DATA_DIR, 'jobs.backup.json');
const NOTEPAD_FILE   = path.join(DATA_DIR, 'notepad.json');
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');

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

let settings = {
  openWebUiHost: 'localhost',
  openWebUiPort: 3002
};

if (fs.existsSync(SETTINGS_FILE)) {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch (err) {
    console.error('[Settings] Failed to load settings.json:', err.message);
  }
} else {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[Settings] Failed to create settings.json:', err.message);
  }
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
    const currentJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    if (currentJobs.length === 0 && fs.existsSync(BACKUP_FILE)) {
      const backupJobs = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      if (backupJobs.length > 0) {
        console.warn('[Backup] ⚠️  Skipped — refusing to overwrite a populated backup with an empty jobs list.');
        return;
      }
    }

    // Rolling backup (database JSON only) — always kept, overwritten each time
    fs.copyFileSync(JOBS_FILE, BACKUP_FILE);

    // Full daily zip snapshot
    const today = new Date().toISOString().split('T')[0];
    const dailyZipFile = path.join(BACKUPS_DIR, `jobboard-backup-${today}.jobboard`);

    if (!fs.existsSync(dailyZipFile)) {
      const output = fs.createWriteStream(dailyZipFile);
      const archive = new ZipArchive({ zlib: { level: 6 } });

      output.on('close', () => {
        console.log(`[Backup] Successfully created daily zip backup: ${path.basename(dailyZipFile)} (${archive.pointer()} bytes)`);
        pruneBackups();
      });

      archive.on('error', err => {
        console.error('[Backup] Archive error:', err.message);
      });

      archive.pipe(output);

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
    } else {
      // If today's backup already exists, just prune to be safe
      pruneBackups();
    }
  } catch (err) {
    console.error('[Backup] Failed:', err.message);
  }
}

function pruneBackups() {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => (f.startsWith('jobboard-backup-') && f.endsWith('.jobboard')) || (f.startsWith('jobs-') && f.endsWith('.json')))
      .map(name => {
        const filePath = path.join(BACKUPS_DIR, name);
        return {
          name,
          filePath,
          time: fs.statSync(filePath).mtime.getTime()
        };
      })
      .sort((a, b) => a.time - b.time); // Oldest first

    while (files.length > 5) {
      const fileToDelete = files.shift();
      fs.unlinkSync(fileToDelete.filePath);
      console.log(`[Backup] Pruned old backup file: ${fileToDelete.name}`);
    }
  } catch (err) {
    console.error('[Backup] Pruning failed:', err.message);
  }
}

// ── Data helpers ─────────────────────────────────────────────────────────────
function readJobs() {
  let jobs = [];
  let corrupted = false;
  try {
    jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch {
    corrupted = true;
  }

  if (corrupted) {
    // Attempt auto-recovery from rolling backup
    if (fs.existsSync(BACKUP_FILE)) {
      console.warn('[Recovery] jobs.json corrupted — restoring from backup...');
      try {
        fs.copyFileSync(BACKUP_FILE, JOBS_FILE);
        jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
      } catch (recoveryErr) {
        console.error('[Recovery] Backup file also corrupted:', recoveryErr.message);
        return [];
      }
    } else {
      console.error('[Recovery] No backup available — starting fresh.');
      return [];
    }
  }

  // Perform legacy screenshot migration
  let migrated = false;
  jobs.forEach(job => {
    if (job.screenshot === true && (!job.screenshots || !Array.isArray(job.screenshots))) {
      const legacyFilename = `${job.id}-screenshot.png`;
      if (fs.existsSync(path.join(CACHE_DIR, legacyFilename))) {
        job.screenshots = [{
          id: 'legacy',
          filename: legacyFilename,
          addedAt: job.createdAt || new Date().toISOString()
        }];
        migrated = true;
      }
    }
  });

  if (migrated) {
    try {
      fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
      console.log('[Migration] Migrated legacy screenshots to new format and saved jobs.json');
    } catch (err) {
      console.error('[Migration] Failed to write migrated jobs.json:', err.message);
    }
  }

  return jobs;
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

// ── Chat Proxy ───────────────────────────────────────────────────────────────

// ── Settings ───────────────────────────────────────────────────────────────

function getCleanHost(host) {
  let clean = host.trim().toLowerCase();
  if (clean.startsWith('https://')) {
    clean = clean.replace('https://', '');
  } else if (clean.startsWith('http://')) {
    clean = clean.replace('http://', '');
  }
  return clean.split('/')[0].split(':')[0];
}

function isLocalHostOrIp(host) {
  const clean = getCleanHost(host);
  if (!clean) return false;

  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1') {
    return true;
  }

  if (clean.endsWith('.local') || clean.endsWith('.internal')) {
    return true;
  }

  if (!clean.includes('.')) {
    return true; // simple hostname (local machine)
  }

  // IPv4 Private networks regex matches
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = clean.match(ipv4Regex);
  if (match) {
    const o1 = parseInt(match[1], 10);
    const o2 = parseInt(match[2], 10);
    const o3 = parseInt(match[3], 10);
    const o4 = parseInt(match[4], 10);

    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;

    // 127.0.0.0/8 (Loopback)
    if (o1 === 127) return true;
    // 10.0.0.0/8 (Class A Private)
    if (o1 === 10) return true;
    // 172.16.0.0/12 (Class B Private)
    if (o1 === 172 && (o2 >= 16 && o2 <= 31)) return true;
    // 192.168.0.0/16 (Class C Private)
    if (o1 === 192 && o2 === 168) return true;
    // 169.254.0.0/16 (Link-local)
    if (o1 === 169 && o2 === 254) return true;
  }

  // IPv6 local/private starts: ULA fc00::/7 (fc, fd) or Link-local fe80::/10 (fe8, fe9, fea, feb)
  if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
    return true;
  }

  return false;
}

app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const { openWebUiHost, openWebUiPort } = req.body;
  if (!openWebUiHost || !openWebUiPort) {
    return res.status(400).json({ error: 'Both Host/IP and Port are required.' });
  }

  const cleanHost = getCleanHost(openWebUiHost);
  if (!isLocalHostOrIp(cleanHost)) {
    return res.status(400).json({ error: 'Host must be a local address (e.g. localhost, 127.0.0.1, or a private IP like 192.168.x.x).' });
  }

  const portVal = parseInt(openWebUiPort, 10);
  if (isNaN(portVal) || portVal < 1 || portVal > 65535) {
    return res.status(400).json({ error: 'Port must be a valid number between 1 and 65535.' });
  }

  settings.openWebUiHost = openWebUiHost.trim();
  settings.openWebUiPort = portVal;
  
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings: ' + err.message });
  }
});

function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip) {
    if (ip.includes(',')) {
      ip = ip.split(',')[0].trim();
    }
    if (ip.startsWith('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }
  }
  return ip;
}

function checkConnection(host, port, clientIp) {
  return new Promise((resolve, reject) => {
    let cleanHost = host.trim();
    if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') {
      if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== 'localhost') {
        cleanHost = clientIp;
      } else if (fs.existsSync('/.dockerenv')) {
        cleanHost = 'host.docker.internal';
      }
    }
    let isHttps = false;
    if (cleanHost.startsWith('https://')) {
      cleanHost = cleanHost.replace('https://', '');
      isHttps = true;
    } else if (cleanHost.startsWith('http://')) {
      cleanHost = cleanHost.replace('http://', '');
    }
    
    // Strip trailing slashes/paths
    cleanHost = cleanHost.split('/')[0];
    
    const client = isHttps ? https : http;
    const options = {
      host: cleanHost,
      port: port,
      path: '/api/models',
      method: 'GET',
      timeout: 3000
    };
    
    const req = client.request(options, (res) => {
      resolve({ success: true, status: res.statusCode });
    });
    
    req.on('error', (err) => {
      let errMsg = err.message;
      if (err.errors && Array.isArray(err.errors)) {
        errMsg = err.errors.map(e => e.message).join('; ');
      }
      if (!errMsg) {
        errMsg = err.code || err.toString();
      }
      reject(new Error(errMsg));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out after 3 seconds'));
    });
    
    req.end();
  });
}

app.post('/api/settings/verify', async (req, res) => {
  const { host, port } = req.body;
  if (!host || !port) {
    return res.status(400).json({ success: false, error: 'Both Host/IP and Port are required.' });
  }

  const cleanHost = getCleanHost(host);
  if (!isLocalHostOrIp(cleanHost)) {
    return res.status(400).json({ success: false, error: 'Host must be a local address (e.g. localhost, 127.0.0.1, or a private IP like 192.168.x.x).' });
  }

  const portVal = parseInt(port, 10);
  if (isNaN(portVal) || portVal < 1 || portVal > 65535) {
    return res.status(400).json({ success: false, error: 'Port must be a valid number between 1 and 65535.' });
  }
  
  try {
    const result = await checkConnection(host, portVal, getClientIp(req));
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Chat Proxy ───────────────────────────────────────────────────────────────

// Proxy to local Open WebUI container
app.all('/api/chat-proxy/*', async (req, res) => {
  const targetPath = req.url.replace('/api/chat-proxy', '');
  let host = settings.openWebUiHost;
  if (host === 'localhost' || host === '127.0.0.1') {
    const clientIp = getClientIp(req);
    if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== 'localhost') {
      host = clientIp;
    } else if (fs.existsSync('/.dockerenv')) {
      host = 'host.docker.internal';
    }
  }
  const targetUrl = `http://${host}:${settings.openWebUiPort}${targetPath}`;

  try {
    const headers = {};
    const allowedHeaders = ['authorization', 'content-type', 'accept'];
    for (const h of allowedHeaders) {
      if (req.headers[h]) {
        headers[h] = req.headers[h];
      }
    }

    const fetchOpts = {
      method: req.method,
      headers: headers,
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOpts);

    res.status(response.status);
    if (response.headers.get('content-type')) {
      res.setHeader('content-type', response.headers.get('content-type'));
    }

    if (response.body && typeof response.body.pipe === 'function') {
      response.body.pipe(res);
    } else {
      const buffer = await response.buffer();
      res.send(buffer);
    }
  } catch (err) {
    console.error('[Chat Proxy] Failed:', err.message);
    res.status(500).json({ error: `Could not connect to Open WebUI container. Is it running at ${settings.openWebUiHost}:${settings.openWebUiPort}?` });
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

  const opts = req.query.sections ? req.query.sections.split(',') : ['url','notes','emails','resume','cover','screenshots','attachments'];
  const wants = (opt) => opts.includes(opt);

  // Build screenshot img tags
  const screenshots = wants('screenshots') ? (job.screenshots || []).map(s => {
    const uri = fileToDataUri(s.filename);
    return uri ? `<div class="ss-wrap"><img src="${uri}" alt="Screenshot" /></div>` : '';
  }).filter(Boolean).join('') : '';

  // Build notes HTML
  const notesHtml = wants('notes') ? ((job.notes || []).length === 0
    ? '<p class="empty">No notes recorded.</p>'
    : [...(job.notes || [])].reverse().map(n => `
        <div class="note-entry">
          <div class="note-ts">${fmtTs(n.timestamp)}</div>
          <div class="note-body">${n.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
        </div>`).join('')) : '';

  // Build emails HTML
  const emailsHtml = wants('emails') ? ((job.emails || []).length === 0
    ? '<p class="empty">No emails recorded.</p>'
    : [...(job.emails || [])].sort((a,b) => (b.date||b.addedAt) < (a.date||a.addedAt) ? -1 : 1).map(em => `
        <div class="email-entry">
          <div class="email-head">
            <span class="email-from">${(em.from||'(no sender)').replace(/</g,'&lt;')}</span>
            <span class="email-date">${fmtDate(em.date)}</span>
          </div>
          <div class="email-subj">${(em.subject||'(no subject)').replace(/</g,'&lt;')}</div>
          ${em.body ? `<div class="email-body">${em.body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>` : ''}
        </div>`).join('')) : '';

  // Build attachments list
  const attachHtml = wants('attachments') ? ((job.attachments || []).length === 0
    ? '<p class="empty">No other attachments.</p>'
    : `<ul class="attach-list">${(job.attachments||[]).map(a =>
        `<li><strong>${a.originalName.replace(/</g,'&lt;')}</strong> <span class="meta">${fmtSize(a.size)} &middot; added ${fmtDate(a.addedAt)}</span></li>`
      ).join('')}</ul>`) : '';

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
    ${job.notes?.length && wants('notes') ? `<span class="meta-item">Notes: <strong>${job.notes.length}</strong></span>` : ''}
    ${job.emails?.length && wants('emails') ? `<span class="meta-item">Emails: <strong>${job.emails.length}</strong></span>` : ''}
    ${job.screenshots?.length && wants('screenshots') ? `<span class="meta-item">Screenshots: <strong>${job.screenshots.length}</strong></span>` : ''}
    <span class="export-date">Exported ${exportDate}</span>
  </div>
</div>

<div class="content">

  ${job.url && wants('url') ? `
  <div class="section">
    <div class="section-title">Job Listing URL</div>
    <a class="url-link" href="${job.url.replace(/"/g,'&quot;')}">${job.url.replace(/</g,'&lt;')}</a>
  </div>` : ''}

  ${wants('notes') ? `
  <div class="section">
    <div class="section-title">Notes &amp; Updates</div>
    ${notesHtml}
  </div>` : ''}

  ${wants('emails') ? `
  <div class="section">
    <div class="section-title">Emails</div>
    ${emailsHtml}
  </div>` : ''}

  ${job.resume && wants('resume') ? `
  <div class="section">
    <div class="section-title">Resume</div>
    <div class="doc-content">${job.resume}</div>
  </div>` : ''}

  ${job.coverLetter && wants('cover') ? `
  <div class="section">
    <div class="section-title">Cover Letter</div>
    <div class="doc-content">${job.coverLetter}</div>
  </div>` : ''}

  ${screenshots && wants('screenshots') ? `
  <div class="section">
    <div class="section-title">Screenshots</div>
    <div class="screenshots-grid">${screenshots}</div>
  </div>` : ''}

  ${wants('attachments') ? `
  <div class="section">
    <div class="section-title">Other Attachments</div>
    ${attachHtml}
  </div>` : ''}

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

    const filename = `export-${job.id}-${Date.now()}.pdf`;
    const filepath = path.join(CACHE_DIR, filename);
    fs.writeFileSync(filepath, pdfBuffer);

    console.log(`[PDF Export] Generated: ${filename}`);
    res.json({ 
      success: true, 
      downloadUrl: `/api/download-cache?file=${filename}&name=${encodeURIComponent(safeName + '.pdf')}`, 
      filename: `${safeName}.pdf` 
    });

  } catch (err) {
    console.error('[PDF Export] Failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// GET /api/download-cache  — serve cached files with strict Content-Disposition headers
app.get('/api/download-cache', (req, res) => {
  const { file, name } = req.query;
  if (!file || !file.startsWith('export-')) return res.status(403).json({ error: 'Forbidden' });
  
  const filepath = path.join(CACHE_DIR, file);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  
  res.download(filepath, name || file);
});

// GET /cache/:filename  — serve cached files statically for other uses
app.use('/cache', express.static(CACHE_DIR));

// GET /api/backup-status
app.get('/api/backup-status', (req, res) => {
  const hasRolling = fs.existsSync(BACKUP_FILE);
  const daily = fs.existsSync(BACKUPS_DIR)
    ? fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json') || f.endsWith('.jobboard')).sort().reverse()
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
