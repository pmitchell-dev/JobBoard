// ── State ─────────────────────────────────────────────────────────────────
let jobs = [];
let activeJobId = null;
let draggedJobId = null;
let pendingAddScreenshot = null;
let activeFilter = 'all';  // 'all' | 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'custom'

const COLUMNS = [
  { id: 'applied',   label: 'Applied',   emoji: '📤', color: '#6366f1' },
  { id: 'screening', label: 'Screening', emoji: '📞', color: '#f59e0b' },
  { id: 'interview', label: 'Interview', emoji: '🧑‍💻', color: '#3b82f6' },
  { id: 'offer',     label: 'Offer',     emoji: '🎉', color: '#10b981' },
  { id: 'rejected',  label: 'Rejected',  emoji: '❌', color: '#ef4444' },
];

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  console.log("JobBoard loaded: v1.1.6");
  document.getElementById('addDate').value = todayStr();
  await loadJobs();
  await fetchMasterDocs();
  renderBoard();
  applyFilter();
  renderStats();
  loadBackupStatus();
  setupGlobalListeners();
  initChatCopilot();
});

// ── API helpers ───────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || r.statusText); }
  return r.json();
}

async function loadJobs() {
  try { jobs = await api('GET', '/api/jobs'); }
  catch { toast('Failed to load jobs', 'error'); jobs = []; }
}

// ── Rendering ─────────────────────────────────────────────────────────────
function renderBoard() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';
  COLUMNS.forEach(col => board.appendChild(buildColumn(col)));
}

function buildColumn(col) {
  const colJobs = jobs.filter(j => j.status === col.id);
  const el = document.createElement('div');
  el.className = 'column';
  el.id = `col-${col.id}`;
  el.style.setProperty('--col-color', col.color);
  el.setAttribute('data-status', col.id);
  el.addEventListener('dragover', e => onColDragOver(e, col.id));
  el.addEventListener('dragleave', onColDragLeave);
  el.addEventListener('drop', e => onColDrop(e, col.id));

  el.innerHTML = `
    <div class="col-header">
      <div class="col-pip"></div>
      <span class="col-title">${col.emoji} ${col.label}</span>
      <span class="col-count">${colJobs.length}</span>
    </div>
    <div class="col-body" id="body-${col.id}">
      ${colJobs.length === 0 ? `<div class="col-empty-hint">Drop cards here</div>` : ''}
    </div>`;

  const body = el.querySelector('.col-body');
  colJobs.forEach(job => body.appendChild(buildCard(job, col.color)));
  return el;
}

function buildCard(job, color) {
  const el = document.createElement('div');
  el.className = 'card';
  el.id = `card-${job.id}`;
  el.style.setProperty('--col-color', color);
  el.draggable = true;
  el.addEventListener('dragstart', e => onCardDragStart(e, job.id));
  el.addEventListener('dragend',   onCardDragEnd);
  el.addEventListener('click',     () => openEditModal(job.id));

  const hasCached      = job.cached;
  const screenshotCount = (job.screenshots || []).length;
  const hasNotes        = job.notes && job.notes.length > 0;
  const emailCount      = (job.emails || []).length;
  const hasDocs         = !!(job.resume || job.coverLetter || (job.attachments || []).length);

  el.innerHTML = `
    <div class="card-company">${esc(job.company)}</div>
    <div class="card-title">${esc(job.title)}</div>
    <div class="card-meta">
      <span class="card-date">📅 ${fmtDate(job.dateApplied)}</span>
      <div class="card-badges">
        <span class="card-badge ${hasCached?'active':''}" title="${hasCached?'Page cached':'No cached page'}">💾</span>
        <span class="card-badge ${screenshotCount?'active':''}" title="${screenshotCount?screenshotCount+' screenshot(s)':'No screenshots'}">📷</span>
        <span class="card-badge ${hasNotes?'active':''}" title="${hasNotes?job.notes.length+' note(s)':'No notes'}">📝</span>
        <span class="card-badge ${emailCount?'active':''}" title="${emailCount?emailCount+' email(s)':'No emails'}">📧</span>
        <span class="card-badge ${hasDocs?'active':''}" title="${hasDocs?'Has resume/cover letter':'No documents'}">📄</span>
      </div>
    </div>
    ${screenshotCount ? `<img class="card-thumb visible" src="/cache/${(job.screenshots||[])[0]?.filename}?t=${Date.now()}" alt="screenshot">` : ''}
  `;
  return el;
}

function renderStats() {
  const strip = document.getElementById('statsStrip');
  strip.innerHTML = COLUMNS.map(col => {
    const count = jobs.filter(j => j.status === col.id).length;
    return `<div class="stat-chip">
      <div class="dot" style="background:${col.color}"></div>
      <span class="count">${count}</span>
      <span class="label">${col.label}</span>
    </div>`;
  }).join('');
}

// ── Date Filtering ────────────────────────────────────────────────────────
function setFilter(key) {
  activeFilter = key;
  // Toggle active chip
  document.querySelectorAll('.filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.filter === key)
  );
  // Show/hide custom date inputs
  const customEl = document.getElementById('filterCustom');
  if (key === 'custom') {
    customEl.classList.remove('hidden');
    // Default custom range to last 7 days if blank
    if (!document.getElementById('filterFrom').value) {
      const d = new Date(); d.setDate(d.getDate() - 7);
      document.getElementById('filterFrom').value = d.toISOString().split('T')[0];
      document.getElementById('filterTo').value   = todayStr();
    }
  } else {
    customEl.classList.add('hidden');
  }
  applyFilter();
}

function applyCustomFilter() {
  // Called when custom date inputs change
  applyFilter();
}

function getFilterDateRange() {
  const now   = new Date();
  const today = todayStr();

  switch (activeFilter) {
    case 'all':       return { from: null, to: null };
    case 'today':     return { from: today, to: today };
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      const s = d.toISOString().split('T')[0];
      return { from: s, to: s };
    }
    case '7d': {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case '14d': {
      const d = new Date(now); d.setDate(d.getDate() - 13);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case '30d': {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case 'custom':
      return {
        from: document.getElementById('filterFrom').value || null,
        to:   document.getElementById('filterTo').value   || null,
      };
    default: return { from: null, to: null };
  }
}

function applyFilter() {
  const { from, to } = getFilterDateRange();
  let visible = 0, total = 0;

  document.querySelectorAll('.card').forEach(card => {
    const jobId = card.id.replace('card-', '');
    const job   = jobs.find(j => j.id === jobId);
    if (!job) return;
    total++;

    const d = job.dateApplied || '';
    const inRange = (!from || d >= from) && (!to || d <= to);
    card.classList.toggle('filtered-out', !inRange);
    if (inRange) visible++;
  });

  // Update each column's visible count
  COLUMNS.forEach(col => {
    const colEl    = document.getElementById(`col-${col.id}`);
    const countEl  = colEl?.querySelector('.col-count');
    if (!countEl) return;
    const shown = [...colEl.querySelectorAll('.card:not(.filtered-out)')].length;
    const colTotal = jobs.filter(j => j.status === col.id).length;
    countEl.textContent = activeFilter === 'all' ? colTotal : `${shown}/${colTotal}`;
  });

  // Result summary
  const resultEl = document.getElementById('filterResult');
  if (activeFilter === 'all') {
    resultEl.innerHTML = '';
  } else {
    resultEl.innerHTML = `<strong>${visible}</strong> of <strong>${total}</strong> jobs match`;
  }
}

// ── Drag & Drop (cards between columns) ──────────────────────────────────
function onCardDragStart(e, jobId) {
  draggedJobId = jobId;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => document.getElementById(`card-${jobId}`)?.classList.add('dragging'), 0);
}
function onCardDragEnd() {
  if (draggedJobId) document.getElementById(`card-${draggedJobId}`)?.classList.remove('dragging');
  draggedJobId = null;
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
}
function onColDragOver(e, status) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.getElementById(`col-${status}`)?.classList.add('drag-over');
}
function onColDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}
async function onColDrop(e, newStatus) {
  e.preventDefault();
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
  if (!draggedJobId) return;
  const job = jobs.find(j => j.id === draggedJobId);
  if (!job || job.status === newStatus) return;
  try {
    const updated = await api('PUT', `/api/jobs/${draggedJobId}`, { status: newStatus });
    Object.assign(job, updated);
    renderBoard(); renderStats(); applyFilter();
  } catch (err) { toast('Failed to move card: ' + err.message, 'error'); }
}

// ── Add Modal ─────────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('addCompany').value = '';
  document.getElementById('addTitle').value   = '';
  document.getElementById('addUrl').value     = '';
  document.getElementById('addDate').value    = todayStr();
  document.getElementById('addStatus').value  = 'applied';
  clearAddScreenshot();
  show('addModal');
  setTimeout(() => document.getElementById('addCompany').focus(), 50);
}
function closeAddModal() {
  hide('addModal');
  clearAddScreenshot();
}

async function saveNewJob() {
  const company = document.getElementById('addCompany').value.trim();
  const title   = document.getElementById('addTitle').value.trim();
  if (!company || !title) { toast('Company and Job Title are required.', 'error'); return; }

  const btn = document.getElementById('saveAddBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const job = await api('POST', '/api/jobs', {
      company,
      title,
      url:         document.getElementById('addUrl').value.trim(),
      dateApplied: document.getElementById('addDate').value,
      status:      document.getElementById('addStatus').value,
    });
    jobs.push(job);

    // Upload screenshot if one was attached in the add modal
    if (pendingAddScreenshot) {
      try {
        const result = await api('POST', `/api/screenshot/${job.id}`, { imageData: pendingAddScreenshot });
        if (!Array.isArray(job.screenshots)) job.screenshots = [];
        job.screenshots.push(result.screenshot);
      } catch (err) {
        console.warn('Screenshot upload failed:', err.message);
      }
    }

    renderBoard(); renderStats(); applyFilter();
    closeAddModal();
    toast(`"${job.title}" added!`, 'success');

    // Trigger background page cache if URL provided
    if (job.url) cacheJobPage(job.id, job.url);
  } catch (err) {
    toast('Error saving job: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Job';
  }
}

// ── Edit / Detail Modal ───────────────────────────────────────────────────
function openEditModal(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  activeJobId = jobId;

  document.getElementById('editTitle').value   = job.title;
  document.getElementById('editCompany').value = job.company;
  document.getElementById('editStatus').value  = job.status;
  document.getElementById('editDate').value    = job.dateApplied;
  document.getElementById('editUrl').value     = job.url || '';
  document.getElementById('newNoteText').value = '';

  // Cache link
  const viewLink = document.getElementById('viewCacheLink');
  if (job.cached) {
    viewLink.href = `/cache/${job.id}.pdf`;
    viewLink.style.display = 'flex';
  } else {
    viewLink.style.display = 'none';
  }
  updateCacheStatus(job.cached ? 'cached' : 'none');

  // Screenshots — migrate legacy boolean if needed
  if (!Array.isArray(job.screenshots)) {
    job.screenshots = [];
  }
  renderScreenshots(job.screenshots);

  // Reset to notes tab
  switchRightTab('notes');

  // Load documents into editors
  const resumeEditor = document.getElementById('resumeEditor');
  const coverEditor  = document.getElementById('coverEditor');
  resumeEditor.innerHTML = job.resume      || '';
  coverEditor.innerHTML  = job.coverLetter || '';

  // Reset to Resume sub-tab
  switchDocSubTab('resume');

  // Update docs badge
  updateDocsBadge(job);

  renderNotes(job.notes || []);
  renderEmails(job.emails || []);
  renderAttachments(job.attachments || []);
  show('editModal');
  document.getElementById('screenshotZone').addEventListener('paste', onZonePaste);
}

function closeEditModal() {
  hide('editModal');
  document.getElementById('screenshotZone').removeEventListener('paste', onZonePaste);
  activeJobId = null;
}

async function saveEditJob() {
  if (!activeJobId) return;
  const jobId = activeJobId; // capture before any await
  const data = {
    title:       document.getElementById('editTitle').value.trim(),
    company:     document.getElementById('editCompany').value.trim(),
    status:      document.getElementById('editStatus').value,
    dateApplied: document.getElementById('editDate').value,
    url:         document.getElementById('editUrl').value.trim(),
    resume:      document.getElementById('resumeEditor').innerHTML || '',
    coverLetter: document.getElementById('coverEditor').innerHTML  || '',
  };
  if (!data.title || !data.company) { toast('Title and Company are required.', 'error'); return; }
  try {
    const updated = await api('PUT', `/api/jobs/${jobId}`, data);
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      // Preserve in-memory notes/emails/screenshots/attachments — server may return stale versions
      // if a concurrent add-note/email was in-flight when PUT was sent
      const { notes, emails, screenshots, attachments, ...rest } = updated;
      Object.assign(jobs[idx], rest);
    }
    renderBoard(); renderStats(); applyFilter();
    closeEditModal();
    toast('Changes saved.', 'success');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

async function deleteCurrentJob() {
  if (!activeJobId) return;
  const job = jobs.find(j => j.id === activeJobId);
  if (!confirm(`Delete "${job?.title}" at ${job?.company}? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/jobs/${activeJobId}`);
    jobs = jobs.filter(j => j.id !== activeJobId);
    renderBoard(); renderStats(); applyFilter();
    closeEditModal();
    toast('Job deleted.', 'info');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Notes ─────────────────────────────────────────────────────────────────
function renderNotes(notes) {
  const log   = document.getElementById('notesLog');
  const count = document.getElementById('notesCount');
  count.textContent = notes.length === 1 ? '1 entry' : `${notes.length} entries`;
  if (!notes.length) {
    log.innerHTML = '<div class="notes-empty">No notes yet. Add your first update above.</div>';
    return;
  }
  // Newest first
  log.innerHTML = [...notes].reverse().map(n => `
    <div class="note-entry" id="note-${n.id}">
      <div class="note-ts">${fmtTimestamp(n.timestamp)}</div>
      <div class="note-text">${esc(n.text)}</div>
      <button class="note-delete" onclick="deleteNote('${n.id}')" title="Delete note">✕</button>
    </div>`).join('');
}

async function submitNote() {
  const jobId = activeJobId; // capture before await
  if (!jobId) return;
  const text = document.getElementById('newNoteText').value.trim();
  if (!text) { toast('Note text cannot be empty.', 'error'); return; }
  try {
    const note = await api('POST', `/api/jobs/${jobId}/notes`, { text });
    const job  = jobs.find(j => j.id === jobId);
    if (job) { job.notes = job.notes || []; job.notes.push(note); renderNotes(job.notes); }
    document.getElementById('newNoteText').value = '';
    // Update card badge
    document.getElementById(`card-${jobId}`)?.querySelectorAll('.card-badge')[2]?.classList.add('active');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

async function deleteNote(noteId) {
  const jobId = activeJobId;
  if (!jobId) return;
  try {
    await api('DELETE', `/api/jobs/${jobId}/notes/${noteId}`);
    const job = jobs.find(j => j.id === jobId);
    if (job) { job.notes = job.notes.filter(n => n.id !== noteId); renderNotes(job.notes); }
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Right-panel tab switching ───────────────────────────────────────────────
function switchRightTab(tab) {
  document.getElementById('tabBtnNotes').classList.toggle('active',  tab === 'notes');
  document.getElementById('tabBtnEmails').classList.toggle('active', tab === 'emails');
  document.getElementById('tabBtnDocs').classList.toggle('active',   tab === 'docs');
  document.getElementById('paneNotes').classList.toggle('hidden',  tab !== 'notes');
  document.getElementById('paneEmails').classList.toggle('hidden', tab !== 'emails');
  document.getElementById('paneDocs').classList.toggle('hidden',   tab !== 'docs');
}

// ── Documents sub-tab switching (Resume / Cover Letter / Other) ────────────────
function switchDocSubTab(tab) {
  document.getElementById('docSubResume').classList.toggle('active', tab === 'resume');
  document.getElementById('docSubCover').classList.toggle('active',  tab === 'cover');
  document.getElementById('docSubOther').classList.toggle('active',  tab === 'other');
  document.getElementById('docPaneResume').classList.toggle('hidden', tab !== 'resume');
  document.getElementById('docPaneCover').classList.toggle('hidden',  tab !== 'cover');
  document.getElementById('docPaneOther').classList.toggle('hidden',  tab !== 'other');
}

// ── Rich-text toolbar command ─────────────────────────────────────────────────
function execFmt(cmd, val) {
  document.execCommand(cmd, false, val || null);
  // Fire oninput on whichever editor is active so auto-save triggers
  const active = document.getElementById('paneDocs').contains(document.activeElement)
    ? document.activeElement.closest('.rich-editor')
    : null;
  if (active) active.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Document editor input handler (debounced auto-save) ──────────────────────
let _docSaveTimers = {};
function onDocEditorInput(type) {
  clearTimeout(_docSaveTimers[type]);
  _docSaveTimers[type] = setTimeout(() => saveDocToJob(type), 800);
}

async function saveDocToJob(type) {
  const jobId = activeJobId; // capture before await
  if (!jobId) return;
  const editorId = type === 'resume' ? 'resumeEditor' : 'coverEditor';
  const html = document.getElementById(editorId).innerHTML || '';
  const field = type === 'resume' ? 'resume' : 'coverLetter';
  try {
    const updated = await api('PUT', `/api/jobs/${jobId}`, { [field]: html });
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      // Preserve in-memory notes/emails/screenshots/attachments
      const { notes, emails, screenshots, attachments, ...rest } = updated;
      Object.assign(jobs[idx], rest);
    }
    flashDocSaved(type);
    const job = jobs.find(j => j.id === jobId);
    if (job) updateDocsBadge(job);
    // Refresh doc card badge without full re-render
    const card = document.getElementById(`card-${jobId}`);
    if (card && job) {
      const hasDocs = !!(job.resume || job.coverLetter || (job.attachments || []).length);
      const badge = [...card.querySelectorAll('.card-badge')].at(-1);
      if (badge) badge.classList.toggle('active', hasDocs);
    }
  } catch (err) {
    console.warn('Auto-save docs failed:', err.message);
  }
}

// ── Paste handler: strip Word's junk styles but keep structure ────────────────
function onDocEditorPaste(e, type) {
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');

  if (html) {
    const clean = cleanWordHtml(html);
    document.execCommand('insertHTML', false, clean);
  } else if (text) {
    // Plain text — wrap paragraphs
    const wrapped = text.split(/\r?\n/).map(line =>
      line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'
    ).join('');
    document.execCommand('insertHTML', false, wrapped);
  }
}

function cleanWordHtml(html) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');

  // Remove Word-specific tags that add no value
  doc.querySelectorAll('style, script, meta, link, xml, o\\:p, w\\:sdt, w\\:sdtContent').forEach(el => el.remove());

  // Walk all elements and strip inline styles + class/id noise
  doc.querySelectorAll('*').forEach(el => {
    // Keep structural elements clean, strip decoration
    el.removeAttribute('class');
    el.removeAttribute('id');
    el.removeAttribute('lang');
    el.removeAttribute('xml:lang');

    // For inline style: only keep font-weight, font-style, text-decoration
    const style = el.getAttribute('style') || '';
    const kept = [];
    if (/font-weight\s*:\s*bold|font-weight\s*:\s*[7-9]\d{2}/i.test(style)) kept.push('font-weight:bold');
    if (/font-style\s*:\s*italic/i.test(style))                              kept.push('font-style:italic');
    if (/text-decoration\s*:[^;]*underline/i.test(style))                   kept.push('text-decoration:underline');
    if (kept.length) el.setAttribute('style', kept.join(';'));
    else el.removeAttribute('style');
  });

  // Unwrap meaningless <span>s (no remaining attributes)
  doc.querySelectorAll('span').forEach(span => {
    if (!span.hasAttributes()) {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
  });

  // Flatten body HTML
  return doc.body.innerHTML;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function clearDocEditor(type) {
  if (!confirm(`Clear ${type === 'resume' ? 'resume' : 'cover letter'} content? This cannot be undone.`)) return;
  const editorId = type === 'resume' ? 'resumeEditor' : 'coverEditor';
  document.getElementById(editorId).innerHTML = '';
  onDocEditorInput(type);
}

// ── .docx Upload ────────────────────────────────────────────────────────────
function triggerDocxUpload(type) {
  const input = document.getElementById('docxInput');
  input.dataset.targetType = type;
  input.click();
}

async function uploadDocx(event) {
  const file = event.target.files[0];
  const type = event.target.dataset.targetType;
  if (!file) return;
  event.target.value = ''; // Reset input
  
  if (!window.mammoth) {
    toast('Mammoth.js library not loaded yet.', 'error');
    return;
  }
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;
    
    // Clean Word junk
    const clean = cleanWordHtml(html);
    
    const editorId = type === 'resume' ? 'resumeEditor' : 'coverEditor';
    document.getElementById(editorId).innerHTML = clean;
    
    // Trigger auto-save
    onDocEditorInput(type);
    toast(`Imported ${file.name} ✓`, 'success');
  } catch (error) {
    toast(`Error reading .docx: ${error.message}`, 'error');
  }
}

// ── Docs badge helpers ────────────────────────────────────────────────────────
function updateDocsBadge(job) {
  const badge = document.getElementById('docsTabBadge');
  if (!badge) return;
  const attCount = job?.attachments?.length || 0;
  const count = (job?.resume ? 1 : 0) + (job?.coverLetter ? 1 : 0) + attCount;
  badge.textContent = count || '';
  badge.classList.toggle('visible', count > 0);

  // Other-docs sub-tab badge
  const otherBadge = document.getElementById('docOtherBadge');
  if (otherBadge) {
    otherBadge.textContent = attCount || '';
    otherBadge.classList.toggle('visible', attCount > 0);
  }
}

function flashDocSaved(type) {
  const el = document.getElementById(type === 'resume' ? 'resumeSavedHint' : 'coverSavedHint');
  if (!el) return;
  el.textContent = 'Saved ✓';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2000);
}

// ── One-click .doc download ───────────────────────────────────────────────────
function downloadDoc(type) {
  if (!activeJobId) return;
  const job = jobs.find(j => j.id === activeJobId);
  if (!job) return;

  const editorId = type === 'resume' ? 'resumeEditor' : 'coverEditor';
  const html = document.getElementById(editorId).innerHTML || '';
  if (!html.trim() || html === '<br>') {
    toast(`No ${type === 'resume' ? 'resume' : 'cover letter'} content to download.`, 'error');
    return;
  }

  const label    = type === 'resume' ? 'Resume' : 'Cover Letter';
  const safeName = `${label} - ${job.company} - ${job.title}`.replace(/[/\\?%*:|"<>]/g, '-');
  const filename = `${safeName}.docx`;

  // 1. Sync latest rich text edits to job task
  if (type === 'resume') {
    job.resume = html;
  } else {
    job.coverLetter = html;
  }
  saveEditJob();

  // 2. Trigger standard GET request to backend server endpoint for direct download
  // This bypasses browser extension message errors (e.g. Chrono "Could not establish connection")
  window.location.href = `/api/jobs/${job.id}/download-doc/${type}`;
  toast(`📄 Downloading "${filename}"...`, 'success');
}

// ── Emails ───────────────────────────────────────────────────────────────────
function renderEmails(emails) {
  const log    = document.getElementById('emailsLog');
  const count  = document.getElementById('emailsCount');
  const badge  = document.getElementById('emailTabBadge');

  count.textContent = emails.length === 1 ? '1 email' : `${emails.length} emails`;
  badge.textContent = emails.length || '';
  badge.classList.toggle('visible', emails.length > 0);

  if (!emails.length) {
    log.innerHTML = '<div class="notes-empty">No emails attached yet.</div>';
    return;
  }
  // Newest first by date, then addedAt
  const sorted = [...emails].sort((a, b) => (b.date || b.addedAt) < (a.date || a.addedAt) ? -1 : 1);
  log.innerHTML = sorted.map(em => `
    <div class="email-entry" id="eml-${em.id}">
      <div class="email-header" onclick="toggleEmailExpand('${em.id}')">
        <div class="email-meta">
          <div class="email-from">${esc(em.from || '(no sender)')}</div>
          <div class="email-subj">${esc(em.subject || '(no subject)')}</div>
        </div>
        <span class="email-date-chip">${fmtDate(em.date)}</span>
        <span class="email-chevron">&#9660;</span>
        <button class="email-delete-btn" onclick="deleteEmail(event,'${em.id}')" title="Remove email">✕</button>
      </div>
      <div class="email-body-wrap">
        <div class="email-body-text">${esc(em.body || '(no body)')}</div>
      </div>
    </div>`).join('');
}

function toggleEmailExpand(emailId) {
  document.getElementById(`eml-${emailId}`)?.classList.toggle('expanded');
}

async function submitEmail() {
  const jobId = activeJobId;
  if (!jobId) return;
  const from    = document.getElementById('emailFrom').value.trim();
  const subject = document.getElementById('emailSubject').value.trim();
  const date    = document.getElementById('emailDate').value;
  const body    = document.getElementById('emailBody').value.trim();

  if (!from && !subject) { toast('Enter at least a From or Subject.', 'error'); return; }
  try {
    const email = await api('POST', `/api/jobs/${jobId}/emails`, { from, subject, date, body });
    const job   = jobs.find(j => j.id === jobId);
    if (job) { job.emails = job.emails || []; job.emails.push(email); renderEmails(job.emails); }
    // Clear form
    document.getElementById('emailFrom').value    = '';
    document.getElementById('emailSubject').value = '';
    document.getElementById('emailDate').value    = '';
    document.getElementById('emailBody').value    = '';
    renderBoard(); applyFilter();
    toast('Email attached ✓', 'success');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

async function deleteEmail(e, emailId) {
  e.stopPropagation();
  const jobId = activeJobId;
  if (!jobId) return;
  try {
    await api('DELETE', `/api/jobs/${jobId}/emails/${emailId}`);
    const job = jobs.find(j => j.id === jobId);
    if (job) { job.emails = job.emails.filter(em => em.id !== emailId); renderEmails(job.emails); }
    renderBoard(); applyFilter();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Thunderbird EML drag-drop ─────────────────────────────────────────────
function onEmlDragOver(e) {
  e.preventDefault(); e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  document.getElementById('emlDropZone').classList.add('drag-active');
}
function onEmlDragLeave(e) {
  e.stopPropagation();
  if (!e.currentTarget.contains(e.relatedTarget))
    document.getElementById('emlDropZone').classList.remove('drag-active');
}
async function onEmlDrop(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('emlDropZone').classList.remove('drag-active');
  if (!activeJobId) return;

  const file = e.dataTransfer.files[0];
  if (!file) { toast('No file received — try dragging the email again.', 'error'); return; }

  // Accept .eml files or bare message drops (no extension, unknown type)
  const nameLower = file.name.toLowerCase();
  const isEml = nameLower.endsWith('.eml')
             || file.type === 'message/rfc822'
             || file.type === 'application/octet-stream'
             || file.type === '';

  if (!isEml) {
    toast(`Unexpected file type "${file.type || file.name}". Drag a message directly from Thunderbird.`, 'error');
    return;
  }

  try {
    const text   = await readFileAsText(file);
    const parsed = parseEml(text);
    const email  = await api('POST', `/api/jobs/${activeJobId}/emails`, parsed);
    const job    = jobs.find(j => j.id === activeJobId);
    if (job) { job.emails = job.emails || []; job.emails.push(email); renderEmails(job.emails); }
    renderBoard(); applyFilter();
    toast(`📧 "${parsed.subject || '(no subject)'}" attached ✓`, 'success');
  } catch (err) {
    toast('Failed to parse email: ' + err.message, 'error');
    console.error('[EML parse error]', err);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = ev => resolve(ev.target.result);
    reader.onerror = ()  => reject(new Error('Could not read file'));
    reader.readAsText(file, 'utf-8');
  });
}

// ── RFC 2822 .eml parser ──────────────────────────────────────────────────
function parseEml(raw) {
  const text   = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sepIdx = text.indexOf('\n\n');
  if (sepIdx === -1) return { from: '', subject: '', date: todayStr(), body: text };

  const headerBlock = text.slice(0, sepIdx);
  const bodyBlock   = text.slice(sepIdx + 2);
  const headers     = parseEmlHeaders(headerBlock);

  const from    = decodeRFC2047(headers['from']    || '');
  const subject = decodeRFC2047(headers['subject'] || '');
  const date    = parseEmlDate(headers['date']     || '');
  const ct      = headers['content-type']              || 'text/plain';
  const cte     = headers['content-transfer-encoding'] || '';

  let body = '';
  if (/^multipart\//i.test(ct)) {
    body = extractMultipartText(bodyBlock, ct);
  } else if (/text\/html/i.test(ct)) {
    body = stripHtmlTags(decodeEmlBody(bodyBlock, cte));
  } else {
    body = decodeEmlBody(bodyBlock, cte);
  }

  return { from, subject, date, body: body.trim() };
}

function parseEmlHeaders(block) {
  // Unfold multi-line headers (continuation lines start with whitespace)
  const unfolded = block.replace(/\n[ \t]+/g, ' ');
  const headers  = {};
  for (const line of unfolded.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();
    if (!headers[key]) headers[key] = val;
  }
  return headers;
}

function decodeRFC2047(str) {
  // Decode =?charset?B|Q?text?= encoded header words
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') {
        const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } else {
        // Q encoding
        const qp = text.replace(/_/g, ' ')
                       .replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16)));
        const bytes = Uint8Array.from(qp, c => c.charCodeAt(0));
        try { return new TextDecoder(charset).decode(bytes); } catch { return qp; }
      }
    } catch { return text; }
  });
}

function decodeEmlBody(body, encoding) {
  const enc = (encoding || '').trim().toLowerCase();
  if (enc === 'base64') {
    try {
      const cleaned = body.replace(/\s/g, '');
      const bytes   = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
      try { return new TextDecoder('utf-8').decode(bytes); }
      catch { return new TextDecoder('latin1').decode(bytes); }
    } catch { return body; }
  }
  if (enc === 'quoted-printable') {
    return body
      .replace(/=\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}

function extractMultipartText(body, contentType) {
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  if (!m) return body;
  const boundary = m[1].trim();
  const parts    = body.split(new RegExp('--' + escapeRegexStr(boundary) + '(?:--)?'));

  let textPlain = '';
  let textHtml  = '';

  for (const part of parts) {
    const t = part.trim();
    if (!t || t === '--') continue;
    const innerSep = t.indexOf('\n\n');
    if (innerSep === -1) continue;

    const ph  = parseEmlHeaders(t.slice(0, innerSep));
    const pb  = t.slice(innerSep + 2);
    const pct = ph['content-type'] || '';
    const pce = ph['content-transfer-encoding'] || '';

    if (/^multipart\//i.test(pct)) {
      const nested = extractMultipartText(pb, pct);
      if (nested) textPlain = nested;
    } else if (/text\/plain/i.test(pct) && !textPlain) {
      textPlain = decodeEmlBody(pb, pce);
    } else if (/text\/html/i.test(pct) && !textHtml) {
      textHtml = stripHtmlTags(decodeEmlBody(pb, pce));
    }
  }
  return textPlain || textHtml || body;
}

function stripHtmlTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

function parseEmlDate(dateStr) {
  if (!dateStr) return todayStr();
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch { /**/ }
  return todayStr();
}

function escapeRegexStr(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Page Caching ──────────────────────────────────────────────────────────
async function triggerCache() {
  if (!activeJobId) return;
  const url = document.getElementById('editUrl').value.trim();
  if (!url) { toast('Please enter a URL first.', 'error'); return; }
  updateCacheStatus('pending');
  await cacheJobPage(activeJobId, url);
  // Refresh link
  const job = jobs.find(j => j.id === activeJobId);
  if (job?.cached) {
    const viewLink = document.getElementById('viewCacheLink');
    viewLink.href  = `/cache/${activeJobId}.pdf`;
    viewLink.style.display = 'flex';
  }
}

async function cacheJobPage(jobId, url) {
  try {
    await api('POST', '/api/cache', { url, jobId });
    const job = jobs.find(j => j.id === jobId);
    if (job) job.cached = true;
    if (activeJobId === jobId) updateCacheStatus('cached');
    toast('PDF saved ✓', 'success');
  } catch (err) {
    if (activeJobId === jobId) updateCacheStatus('error');
    console.warn('PDF save failed:', err.message);
  }
}

function updateCacheStatus(state) {
  const row = document.getElementById('cacheStatusRow');
  if (!row) return;
  const map = {
    none:    '',
    pending: '<span class="cache-pending">⏳ Saving PDF… (may take ~15s)</span>',
    cached:  '<span class="cache-ok">✅ PDF saved locally</span>',
    error:   '<span class="cache-err">⚠️ Could not save PDF (site may block headless access)</span>',
  };
  row.innerHTML = map[state] || '';
}

// ── Screenshot ────────────────────────────────────────────────────────────
function onZonePaste(e) {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      handleScreenshotFile(item.getAsFile());
      return;
    }
  }
}

function setupGlobalListeners() {
  // Ctrl+V paste — route to whichever modal is open
  document.addEventListener('paste', e => {
    // Don't intercept paste inside the rich document editors
    if (e.target.closest && e.target.closest('.rich-editor')) return;

    const addOpen  = !document.getElementById('addModal').classList.contains('hidden');
    const editOpen = !document.getElementById('editModal').classList.contains('hidden');
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        if (addOpen)  handleAddScreenshotFile(item.getAsFile());
        else if (editOpen && activeJobId) handleScreenshotFile(item.getAsFile());
        return;
      }
    }
  });

  // Enter to add note (Shift+Enter for newline)
  document.getElementById('newNoteText').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNote(); }
  });

  // ESC closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('editModal').classList.contains('hidden')) closeEditModal();
      else if (!document.getElementById('addModal').classList.contains('hidden')) closeAddModal();
      else if (!document.getElementById('importModal').classList.contains('hidden')) closeImportModal();
      else if (!document.getElementById('lightbox').classList.contains('hidden')) closeLightbox();
    }
  });
}

// ── Add-modal screenshot handlers ─────────────────────────────────────────
function onAddScreenshotDragOver(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('addScreenshotZone').classList.add('drag-active');
}
function onAddScreenshotDragLeave(e) {
  e.stopPropagation();
  document.getElementById('addScreenshotZone').classList.remove('drag-active');
}
function onAddScreenshotDrop(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('addScreenshotZone').classList.remove('drag-active');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleAddScreenshotFile(file);
}
function onAddScreenshotFileChange(e) {
  const file = e.target.files[0];
  if (file) handleAddScreenshotFile(file);
  e.target.value = '';
}
function handleAddScreenshotFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    pendingAddScreenshot = ev.target.result;
    const preview = document.getElementById('addScreenshotPreview');
    preview.src = pendingAddScreenshot;
    preview.classList.remove('hidden');
    document.getElementById('addScreenshotPlaceholder').classList.add('hidden');
    document.getElementById('addScreenshotRemoveBtn').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}
function clearAddScreenshot(e) {
  if (e) e.stopPropagation();
  pendingAddScreenshot = null;
  const preview = document.getElementById('addScreenshotPreview');
  if (!preview) return;
  preview.src = '';
  preview.classList.add('hidden');
  document.getElementById('addScreenshotPlaceholder').classList.remove('hidden');
  document.getElementById('addScreenshotRemoveBtn').classList.add('hidden');
}

function onScreenshotDragOver(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('screenshotZone').classList.add('drag-active');
}
function onScreenshotDragLeave(e) {
  e.stopPropagation();
  if (!e.currentTarget.contains(e.relatedTarget))
    document.getElementById('screenshotZone').classList.remove('drag-active');
}
function onScreenshotDrop(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('screenshotZone').classList.remove('drag-active');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  files.forEach(handleScreenshotFile);
}
function onScreenshotFileChange(e) {
  const files = [...e.target.files];
  files.forEach(handleScreenshotFile);
  e.target.value = '';
}

// ── Screenshot gallery renderer ────────────────────────────────────────────
function renderScreenshots(screenshots) {
  const gallery = document.getElementById('screenshotGallery');
  const label   = document.getElementById('screenshotCountLabel');
  if (!gallery) return;

  const count = screenshots.length;
  label.textContent = count ? `(${count})` : '';

  gallery.innerHTML = screenshots.map(s => `
    <div class="screenshot-thumb-wrap" id="sthumb-${s.id}">
      <img src="/cache/${s.filename}?t=${Date.now()}" alt="screenshot"
           onclick="openLightbox('/cache/${s.filename}')" />
      <button class="screenshot-thumb-remove" onclick="removeScreenshot(event,'${s.id}')" title="Remove">✕</button>
    </div>
  `).join('');

  // Update card badge
  if (activeJobId) {
    const cardBadge = document.querySelector(`#card-${activeJobId} .card-badge:nth-child(2)`);
    if (cardBadge) {
      cardBadge.classList.toggle('active', count > 0);
      cardBadge.title = count ? `${count} screenshot(s)` : 'No screenshots';
    }
    // Update card thumb (first screenshot)
    const cardThumb = document.querySelector(`#card-${activeJobId} .card-thumb`);
    if (count > 0) {
      if (cardThumb) {
        cardThumb.src = `/cache/${screenshots[0].filename}?t=${Date.now()}`;
        cardThumb.classList.add('visible');
      } else {
        const card = document.getElementById(`card-${activeJobId}`);
        if (card) {
          const img = document.createElement('img');
          img.className = 'card-thumb visible';
          img.src = `/cache/${screenshots[0].filename}?t=${Date.now()}`;
          img.alt = 'screenshot';
          card.appendChild(img);
        }
      }
    } else if (cardThumb) {
      cardThumb.remove();
    }
  }
}

function handleScreenshotFile(file) {
  if (!activeJobId) return;
  const jobId = activeJobId; // capture before async gap

  // Show an uploading placeholder immediately
  const gallery = document.getElementById('screenshotGallery');
  const tempId  = 'uploading-' + Date.now();
  const placeholder = document.createElement('div');
  placeholder.className = 'screenshot-thumb-uploading';
  placeholder.id = tempId;
  placeholder.textContent = '⏳';
  gallery.appendChild(placeholder);

  const reader = new FileReader();
  reader.onload = async ev => {
    const imageData = ev.target.result;
    try {
      const result = await api('POST', `/api/screenshot/${jobId}`, { imageData });
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        if (!Array.isArray(job.screenshots)) job.screenshots = [];
        job.screenshots.push(result.screenshot);
        renderScreenshots(job.screenshots);
      }
      toast('Screenshot saved ✓', 'success');
    } catch (err) {
      toast('Screenshot upload failed: ' + err.message, 'error');
    } finally {
      document.getElementById(tempId)?.remove();
    }
  };
  reader.readAsDataURL(file);
}

async function removeScreenshot(e, screenshotId) {
  e.stopPropagation();
  const jobId = activeJobId;
  if (!jobId || !screenshotId) return;
  try {
    await api('DELETE', `/api/screenshot/${jobId}/${screenshotId}`);
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      job.screenshots = (job.screenshots || []).filter(s => s.id !== screenshotId);
      renderScreenshots(job.screenshots);
    }
    toast('Screenshot removed.', 'info');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Lightbox ──────────────────────────────────────────────────────────────
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  show('lightbox');
}
function closeLightbox() { hide('lightbox'); }


// ── Attachments (Other Documents) ─────────────────────────────────────────

function onAttachDragOver(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('attachDropZone').classList.add('drag-active');
}
function onAttachDragLeave(e) {
  e.stopPropagation();
  if (!e.currentTarget.contains(e.relatedTarget))
    document.getElementById('attachDropZone').classList.remove('drag-active');
}
function onAttachDrop(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('attachDropZone').classList.remove('drag-active');
  const files = [...e.dataTransfer.files];
  files.forEach(uploadAttachment);
}
function onAttachFileChange(e) {
  const files = [...e.target.files];
  files.forEach(uploadAttachment);
  e.target.value = '';
}

async function uploadAttachment(file) {
  const jobId = activeJobId;
  if (!jobId) return;
  const list = document.getElementById('attachList');
  const tempId = 'attach-' + Date.now();
  const placeholder = document.createElement('div');
  placeholder.className = 'attach-item attach-uploading';
  placeholder.id = tempId;
  placeholder.innerHTML = '<span class="attach-item-icon">&#x23F3;</span><span class="attach-uploading-name">' + esc(file.name) + '</span><span class="attach-uploading-label">Uploading…</span>';
  list.querySelector('.notes-empty')?.remove();
  list.appendChild(placeholder);
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/jobs/' + jobId + '/attachments', { method: 'POST', body: formData });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
    const data = await res.json();
    const attachment = data.attachment;
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      if (!Array.isArray(job.attachments)) job.attachments = [];
      job.attachments.push(attachment);
      renderAttachments(job.attachments);
      updateDocsBadge(job);
      const card = document.getElementById('card-' + jobId);
      if (card) { const badge = [...card.querySelectorAll('.card-badge')].at(-1); if (badge) badge.classList.add('active'); }
    }
    toast('"' + file.name + '" attached ✓', 'success');
  } catch (err) {
    toast('Upload failed: ' + err.message, 'error');
    document.getElementById(tempId)?.remove();
    const job = jobs.find(j => j.id === jobId);
    if (job && !(job.attachments || []).length)
      list.innerHTML = '<div class="notes-empty">No files attached yet. Drop any file above to keep it with this job.</div>';
  }
}

async function deleteAttachment(attachId) {
  const jobId = activeJobId;
  if (!jobId || !attachId) return;
  try {
    await api('DELETE', '/api/jobs/' + jobId + '/attachments/' + attachId);
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      job.attachments = (job.attachments || []).filter(a => a.id !== attachId);
      renderAttachments(job.attachments);
      updateDocsBadge(job);
      const card = document.getElementById('card-' + jobId);
      if (card) {
        const hasDocs = !!(job.resume || job.coverLetter || (job.attachments || []).length);
        const badge = [...card.querySelectorAll('.card-badge')].at(-1);
        if (badge) badge.classList.toggle('active', hasDocs);
      }
    }
    toast('Attachment removed.', 'info');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function renderAttachments(attachments) {
  const list  = document.getElementById('attachList');
  const count = document.getElementById('attachCount');
  if (!list) return;
  count.textContent = attachments.length === 1 ? '1 file' : (attachments.length + ' files');
  if (!attachments.length) {
    list.innerHTML = '<div class="notes-empty">No files attached yet. Drop any file above to keep it with this job.</div>';
    return;
  }
  const dlIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  list.innerHTML = [...attachments].reverse().map(function(a) {
    return '<div class="attach-item" id="attitem-' + a.id + '">' +
      '<span class="attach-item-icon">' + attachIcon(a.originalName, a.mimetype) + '</span>' +
      '<div class="attach-item-info">' +
        '<a class="attach-item-name" href="/cache/' + a.filename + '" target="_blank" rel="noopener" title="Open file">' + esc(a.originalName) + '</a>' +
        '<span class="attach-item-meta">' + fmtFileSize(a.size) + ' &middot; ' + fmtTimestamp(a.addedAt) + '</span>' +
      '</div>' +
      '<a class="attach-item-dl" href="/cache/' + a.filename + '" download="' + esc(a.originalName) + '" title="Download">' + dlIcon + '</a>' +
      '<button class="attach-item-delete" onclick="deleteAttachment(\'' + a.id + '\')" title="Remove">\u2715</button>' +
    '</div>';
  }).join('');
}

function attachIcon(name, mime) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📕';
  if (ext === 'doc' || ext === 'docx') return '📝';
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return '📊';
  if (ext === 'ppt' || ext === 'pptx') return '📋';
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return '🖼️';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
  if (['mp4','mov','avi','mkv'].includes(ext)) return '🎥';
  if (['mp3','wav','ogg'].includes(ext)) return '🎵';
  if (['txt','md','log'].includes(ext)) return '📄';
  if ((mime || '').startsWith('image/')) return '🖼️';
  return '📎';
}

function fmtFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function exportJobPdf() {
  if (!activeJobId) return;
  document.getElementById('exportPdfModal').classList.remove('hidden');
}

function closeExportPdfModal() {
  document.getElementById('exportPdfModal').classList.add('hidden');
}

async function confirmExportPdf() {
  const job = jobs.find(j => j.id === activeJobId);
  if (!job) return;

  const btn = document.getElementById('confirmExportPdfBtn');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Generating…';

  const sections = [];
  if (document.getElementById('exOptUrl').checked) sections.push('url');
  if (document.getElementById('exOptNotes').checked) sections.push('notes');
  if (document.getElementById('exOptEmails').checked) sections.push('emails');
  if (document.getElementById('exOptResume').checked) sections.push('resume');
  if (document.getElementById('exOptCover').checked) sections.push('cover');
  if (document.getElementById('exOptScreenshots').checked) sections.push('screenshots');
  if (document.getElementById('exOptAttachments').checked) sections.push('attachments');

  try {
    const res = await fetch(`/api/jobs/${activeJobId}/export-pdf?sections=${sections.join(',')}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);

    const a = document.createElement('a');
    a.href = data.downloadUrl;
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    
    toast('📄 PDF downloaded!', 'success');
    closeExportPdfModal();
  } catch (err) {
    toast('PDF export failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

// ── Export / Import ─────────────────────────────────────────────────────

// Kick off a server-side export download
function exportData() {
  const btn = document.getElementById('exportBtn');
  btn.disabled = true;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exporting…`;
  const a = document.createElement('a');
  a.href = '/api/export';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export`;
    toast('Export downloaded ✓', 'success');
  }, 1500);
}

// State for the pending import
let _importFile = null;

// Called when user picks a file — show summary then open import options modal
async function promptImport(event) {
  const file = event.target.files[0];
  event.target.value = ''; // allow re-selecting the same file
  if (!file) return;
  _importFile = file;

  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  document.getElementById('importSummary').innerHTML = `
    <div class="import-file-info">
      <div class="import-file-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div>
        <div class="import-file-name">${esc(file.name)}</div>
        <div class="import-file-size">${sizeMB} MB &mdash; Choose how to import:</div>
      </div>
    </div>`;

  // Re-enable buttons in case a previous attempt left them disabled
  document.getElementById('importReplaceBtn').disabled = false;
  document.getElementById('importMergeBtn').disabled   = false;
  show('importModal');
}

function closeImportModal() {
  hide('importModal');
  _importFile = null;
}

// Called when user picks Replace or Merge
async function confirmImport(mode) {
  if (!_importFile) return;

  const replaceBtn = document.getElementById('importReplaceBtn');
  const mergeBtn   = document.getElementById('importMergeBtn');
  replaceBtn.disabled = true;
  mergeBtn.disabled   = true;

  const activeBtn = mode === 'replace' ? replaceBtn : mergeBtn;
  const origHTML  = activeBtn.innerHTML;
  activeBtn.innerHTML = `<div class="import-option-icon">⏳</div><div class="import-option-text"><strong>Importing…</strong><span>Please wait</span></div>`;

  try {
    const formData = new FormData();
    formData.append('file', _importFile);
    formData.append('mode', mode);

    const res  = await fetch('/api/import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    closeImportModal();
    await loadJobs();
    renderBoard();
    renderStats();
    applyFilter();
    loadBackupStatus();

    if (mode === 'replace') {
      toast(`✅ Replaced — ${data.added} job${data.added !== 1 ? 's' : ''} loaded`, 'success');
    } else {
      const skipMsg = data.skipped > 0 ? `, ${data.skipped} skipped (already existed)` : '';
      toast(`✅ Merged — ${data.added} job${data.added !== 1 ? 's' : ''} added${skipMsg}`, 'success');
    }
  } catch (err) {
    toast('Import failed: ' + err.message, 'error');
    activeBtn.innerHTML = origHTML;
    replaceBtn.disabled = false;
    mergeBtn.disabled   = false;
  }
}

// ── Backup status ─────────────────────────────────────────────────────────
async function loadBackupStatus() {
  try {
    const s   = await api('GET', '/api/backup-status');
    const dot = document.querySelector('.backup-dot');
    const lbl = document.querySelector('.backup-label');
    if (s.hasRollingBackup) {
      dot.classList.remove('warn');
      lbl.textContent = `Backed up · ${fmtTimestamp(s.lastBackup)}`;
    } else {
      dot.classList.add('warn');
      lbl.textContent = 'No backup yet';
    }
  } catch { /* silently ignore */ }
}

async function openBackupRestoreModal() {
  const listEl = document.getElementById('backupRestoreList');
  listEl.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">Loading backups...</div>';
  show('backupRestoreModal');

  try {
    const s = await api('GET', '/api/backup-status');
    const backups = s.dailyBackups || [];
    
    if (backups.length === 0) {
      listEl.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">No backups found on server.</div>';
      return;
    }

    listEl.innerHTML = backups.map(b => {
      const isZip = b.endsWith('.jobboard');
      const icon = isZip ? '📦' : '📄';
      const typeLabel = isZip ? 'Full Zip Backup' : 'Database JSON Only';
      
      const dateMatch = b.match(/\d{4}-\d{2}-\d{2}/);
      const dateStr = dateMatch ? fmtDate(dateMatch[0]) : 'Unknown Date';

      return `
        <div class="backup-item">
          <div class="backup-item-info">
            <div class="backup-item-title">${icon} Backup from ${dateStr}</div>
            <div class="backup-item-meta">${typeLabel} (${b})</div>
          </div>
          <div class="backup-item-actions">
            <button class="btn-restore-merge" onclick="confirmRestore('${b}', 'merge')">Merge</button>
            <button class="btn-restore-replace" onclick="confirmRestore('${b}', 'replace')">Replace</button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: #ef4444;">Failed to load backups: ${err.message}</div>`;
  }
}

function closeBackupRestoreModal() {
  hide('backupRestoreModal');
}

async function confirmRestore(filename, mode) {
  const modeText = mode === 'replace' 
    ? 'This will COMPLETELY OVERWRITE your current board with the backup data. Your current data will be backed up first.' 
    : 'This will add new jobs from the backup without modifying your existing entries.';

  if (!confirm(`Are you sure you want to restore "${filename}" using ${mode.toUpperCase()} mode?\n\n${modeText}`)) {
    return;
  }

  const listEl = document.getElementById('backupRestoreList');
  const buttons = listEl.querySelectorAll('button');
  buttons.forEach(btn => btn.disabled = true);

  const clickedBtn = Array.from(buttons).find(btn => 
    btn.getAttribute('onclick')?.includes(filename) && btn.getAttribute('onclick')?.includes(mode)
  );
  const origText = clickedBtn ? clickedBtn.textContent : '';
  if (clickedBtn) clickedBtn.textContent = 'Restoring...';

  try {
    const res = await api('POST', '/api/restore', { filename, mode });
    if (res.success) {
      toast(`✅ Backup restored successfully (${res.added} added, ${res.skipped} skipped)`, 'success');
      closeBackupRestoreModal();
      await loadJobs();
      renderBoard();
      renderStats();
      applyFilter();
      loadBackupStatus();
    } else {
      throw new Error(res.error || 'Restore failed');
    }
  } catch (err) {
    toast(`Restore failed: ${err.message}`, 'error');
    buttons.forEach(btn => btn.disabled = false);
    if (clickedBtn) clickedBtn.textContent = origText;
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────
function handleOverlayClick(e, id) {
  if (e.target.id === id) {
    if (id === 'addModal') closeAddModal();
    else if (id === 'editModal') closeEditModal();
    else if (id === 'importModal') closeImportModal();
    else if (id === 'backupRestoreModal') closeBackupRestoreModal();
  }
}
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ── Utils ─────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) {
  if (!d) return '—';
  const [y,m,day] = d.split('-');
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]} ${+day}, ${y}`;
}
function fmtTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
}

// ── Quick Notepad ──────────────────────────────────────────────────────────
const NOTEPAD_KEY     = 'jobboard_notepad_text';
const NOTEPAD_POS_KEY = 'jobboard_notepad_pos';

let notepadVisible   = false;
let notepadSaveTimer = null;
let notepadLoaded    = false;  // true after first server fetch

function toggleNotepad() {
  const panel = document.getElementById('notepadPanel');
  const btn   = document.getElementById('notepadBtn');
  notepadVisible = !notepadVisible;

  if (notepadVisible) {
    panel.style.display = 'flex';
    btn.classList.add('active');
    // Restore last position
    const pos = JSON.parse(localStorage.getItem(NOTEPAD_POS_KEY) || 'null');
    if (pos) {
      panel.style.left  = pos.left;
      panel.style.top   = pos.top;
      panel.style.right = 'auto';
    }
    // First open: fetch from server (falls back to localStorage instantly)
    if (!notepadLoaded) {
      notepadLoaded = true;
      loadNotepadFromServer();
    } else {
      setTimeout(() => document.getElementById('notepadTextarea').focus(), 80);
    }
  } else {
    panel.style.display = 'none';
    btn.classList.remove('active');
  }
}

async function loadNotepadFromServer() {
  const ta = document.getElementById('notepadTextarea');
  // Show localStorage content instantly while server responds
  ta.value = localStorage.getItem(NOTEPAD_KEY) || '';
  try {
    const data = await api('GET', '/api/notepad');
    if (data && typeof data.text === 'string') {
      ta.value = data.text;
      localStorage.setItem(NOTEPAD_KEY, data.text);
    }
  } catch { /* server unreachable — localStorage value is fine */ }
  setTimeout(() => ta.focus(), 80);
}

async function saveNotepadToServer(text) {
  try {
    await api('PUT', '/api/notepad', { text });
    flashNotepadSaved(true);
  } catch {
    flashNotepadSaved(false);
  }
}

function clearNotepad() {
  if (!confirm('Clear all notes? This cannot be undone.')) return;
  document.getElementById('notepadTextarea').value = '';
  localStorage.removeItem(NOTEPAD_KEY);
  saveNotepadToServer('');
}

// Auto-save on input with debounce
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('notepadTextarea').addEventListener('input', () => {
    clearTimeout(notepadSaveTimer);
    notepadSaveTimer = setTimeout(() => {
      const text = document.getElementById('notepadTextarea').value;
      localStorage.setItem(NOTEPAD_KEY, text);  // instant, offline-safe
      saveNotepadToServer(text);                 // server backup
    }, 600);
  });

  initNotepadDrag();
});

function flashNotepadSaved(success = true) {
  const el = document.getElementById('notepadSavedIndicator');
  if (!el) return;
  el.textContent = success ? 'Saved' : '⚠ Save failed';
  el.style.color  = success ? '#10b981' : '#f59e0b';
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ── Notepad drag-to-move ───────────────────────────────────────────────────
function initNotepadDrag() {
  const header = document.getElementById('notepadHeader');
  const panel  = document.getElementById('notepadPanel');
  if (!header || !panel) return;

  let dragging = false, startX = 0, startY = 0, startL = 0, startT = 0;

  header.addEventListener('mousedown', e => {
    // Don't drag when clicking the close button
    if (e.target.closest('.notepad-close-btn')) return;
    dragging = true;

    // Compute current pixel position (handle right-anchored default)
    const rect = panel.getBoundingClientRect();
    startL = rect.left;
    startT = rect.top;

    // Switch from right-anchor to absolute left/top so dragging works correctly
    panel.style.left  = startL + 'px';
    panel.style.top   = startT + 'px';
    panel.style.right = 'auto';

    startX = e.clientX;
    startY = e.clientY;

    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = startL + dx;
    let newTop  = startT + dy;

    // Keep inside viewport
    const w = panel.offsetWidth, h = panel.offsetHeight;
    newLeft = Math.max(0, Math.min(window.innerWidth  - w, newLeft));
    newTop  = Math.max(0, Math.min(window.innerHeight - h, newTop));

    panel.style.left = newLeft + 'px';
    panel.style.top  = newTop  + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    // Persist position
    localStorage.setItem(NOTEPAD_POS_KEY, JSON.stringify({
      left: panel.style.left,
      top:  panel.style.top,
    }));
  });
}

// ── Chat Copilot ─────────────────────────────────────────────────────────────
let chatVisible = false;
let chatHistory = []; // { role: 'user' | 'assistant', content: string }
let chatActiveRequest = false;
const CHAT_POS_KEY = 'jobboard_chat_pos';
let openWebUiHost = 'localhost';
let openWebUiPort = 3002;

function initChatCopilot() {
  const inputEl = document.getElementById('chatInput');
  if (!inputEl) return;

  // Load configuration and history
  loadChatHistoryFromSession();
  initChatDrag();

  // Load Settings
  const savedApiKey = localStorage.getItem('jobboard_chat_apikey');
  const savedPrompt = localStorage.getItem('jobboard_chat_system_prompt');

  if (savedApiKey) document.getElementById('chatApiKey').value = savedApiKey;
  if (savedPrompt) document.getElementById('chatSystemPrompt').value = savedPrompt;

  // Load Settings from backend
  fetch('/api/settings')
    .then(r => r.json())
    .then(data => {
      openWebUiHost = data.openWebUiHost || 'localhost';
      openWebUiPort = data.openWebUiPort || 3002;
      
      const hostEl = document.getElementById('chatHost');
      const portEl = document.getElementById('chatPort');
      if (hostEl) hostEl.value = openWebUiHost;
      if (portEl) portEl.value = openWebUiPort;
      
      // Restore API key, model selection, and custom system prompt from backend if present
      if (data.openWebUiApiKey) {
        localStorage.setItem('jobboard_chat_apikey', data.openWebUiApiKey);
        const apiKeyEl = document.getElementById('chatApiKey');
        if (apiKeyEl) apiKeyEl.value = data.openWebUiApiKey;
      }
      if (data.openWebUiModel) {
        localStorage.setItem('jobboard_chat_model', data.openWebUiModel);
      }
      if (data.openWebUiSystemPrompt) {
        localStorage.setItem('jobboard_chat_system_prompt', data.openWebUiSystemPrompt);
        const promptEl = document.getElementById('chatSystemPrompt');
        if (promptEl) promptEl.value = data.openWebUiSystemPrompt;
      }

      // Trigger models and prompts load after settings are loaded
      refreshChatModels();
      refreshChatPrompts();
    })
    .catch(err => {
      console.warn('Failed to load Open WebUI settings:', err);
      refreshChatModels();
      refreshChatPrompts();
    });

  // Textarea auto-resize
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(120, inputEl.scrollHeight) + 'px';
  });

  // Handle autocomplete keys or standard Enter key
  inputEl.addEventListener('keydown', e => {
    const popup = document.getElementById('chatPromptsPopup');
    const isPopupVisible = popup && !popup.classList.contains('hidden');

    if (isPopupVisible) {
      const items = popup.querySelectorAll('.chat-prompt-item');
      if (items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activePromptIndex = (activePromptIndex + 1) % items.length;
          updateSelectedPromptItem();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activePromptIndex = (activePromptIndex - 1 + items.length) % items.length;
          updateSelectedPromptItem();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (activePromptIndex >= 0 && activePromptIndex < items.length) {
            selectPromptByIndex(activePromptIndex);
          } else {
            // Default to selecting the first item if none selected but Enter pressed
            selectPromptByIndex(0);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hidePromptsPopup();
        }
      } else {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          hidePromptsPopup();
        }
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    }
  });

  // Watch for '/' trigger or changes in input
  inputEl.addEventListener('input', () => {
    const text = inputEl.value;
    if (text.startsWith('/')) {
      const filterText = text.substring(1);
      showPromptsPopup(filterText);
    } else {
      hidePromptsPopup();
    }
  });

  // Global click listener to close prompts popup when clicking outside
  document.addEventListener('click', e => {
    const popup = document.getElementById('chatPromptsPopup');
    const triggerBtn = document.getElementById('chatPromptTriggerBtn');
    if (popup && !popup.classList.contains('hidden')) {
      if (!popup.contains(e.target) && e.target !== triggerBtn && !triggerBtn?.contains(e.target)) {
        hidePromptsPopup();
      }
    }
  });
}

// ── Prompts Handling ─────────────────────────────────────────────────────────
let openWebUiPrompts = [];
let activePromptIndex = -1;

async function refreshChatPrompts() {
  const apiKey = localStorage.getItem('jobboard_chat_apikey') || '';
  const endpoints = [
    '/api/chat-proxy/api/v1/prompts',
    '/api/chat-proxy/api/v1/prompts/',
    '/api/chat-proxy/api/v1/prompts/list',
    '/api/chat-proxy/api/prompts',
    '/api/chat-proxy/api/prompts/'
  ];
  
  let success = false;
  
  for (const url of endpoints) {
    try {
      console.log(`Trying to fetch prompts from: ${url}`);
      const response = await fetch(url, {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
      });
      
      if (!response.ok) {
        console.warn(`Fetch to ${url} failed with status ${response.status}`);
        continue;
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn(`Fetch to ${url} returned non-JSON content type: ${contentType}`);
        continue;
      }
      
      const data = await response.json();
      if (Array.isArray(data)) {
        openWebUiPrompts = data;
        success = true;
        console.log(`Successfully loaded ${openWebUiPrompts.length} custom prompts from ${url}`);
        break;
      } else {
        console.warn(`Fetch to ${url} returned non-array data structure:`, data);
      }
    } catch (err) {
      console.warn(`Error trying endpoint ${url}:`, err);
    }
  }
  
  if (!success) {
    console.error('All candidate prompt endpoints failed to load valid prompts.');
    openWebUiPrompts = [];
  }
}

function togglePromptsPopup(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const popup = document.getElementById('chatPromptsPopup');
  const triggerBtn = document.getElementById('chatPromptTriggerBtn');
  if (!popup) return;

  const isHidden = popup.classList.contains('hidden');
  if (isHidden) {
    showPromptsPopup('');
    triggerBtn?.classList.add('active');
  } else {
    hidePromptsPopup();
  }
}

function hidePromptsPopup() {
  const popup = document.getElementById('chatPromptsPopup');
  const triggerBtn = document.getElementById('chatPromptTriggerBtn');
  if (popup) {
    popup.classList.add('hidden');
    popup.innerHTML = '';
  }
  triggerBtn?.classList.remove('active');
  activePromptIndex = -1;
}

function showPromptsPopup(filterText = '') {
  const popup = document.getElementById('chatPromptsPopup');
  if (!popup) return;

  if (openWebUiPrompts.length === 0) {
    popup.innerHTML = `
      <div class="chat-prompts-empty">
        No prompts loaded. Make sure your Open WebUI API Key is set in 
        <a onclick="toggleChatSettings(); hidePromptsPopup();">Settings (⚙️)</a>.
      </div>
    `;
    popup.classList.remove('hidden');
    return;
  }

  const filtered = openWebUiPrompts.filter(p => {
    const cmd = p.command || '';
    const name = p.name || '';
    return cmd.toLowerCase().includes(filterText.toLowerCase()) ||
           name.toLowerCase().includes(filterText.toLowerCase());
  });

  if (filtered.length === 0) {
    popup.innerHTML = `<div class="chat-prompts-empty">No matching prompts found</div>`;
    popup.classList.remove('hidden');
    return;
  }

  popup.innerHTML = filtered.map((p, idx) => {
    const command = p.command || '';
    const name = p.name || '';
    const content = p.content || '';
    return `
      <div class="chat-prompt-item" data-index="${idx}" onclick="selectPromptByIndex(${idx})">
        <div class="chat-prompt-item-header">
          <span class="chat-prompt-item-command">${esc(command)}</span>
          <span class="chat-prompt-item-name">${esc(name)}</span>
        </div>
        <div class="chat-prompt-item-content">${esc(content)}</div>
      </div>
    `;
  }).join('');

  popup.classList.remove('hidden');
  activePromptIndex = -1;
  updateSelectedPromptItem();
}

function updateSelectedPromptItem() {
  const popup = document.getElementById('chatPromptsPopup');
  if (!popup) return;
  const items = popup.querySelectorAll('.chat-prompt-item');
  items.forEach((item, idx) => {
    item.classList.toggle('selected', idx === activePromptIndex);
    if (idx === activePromptIndex) {
      item.scrollIntoView({ block: 'nearest' });
    }
  });
}

async function selectPromptByIndex(idx) {
  const popup = document.getElementById('chatPromptsPopup');
  if (!popup) return;
  
  const items = popup.querySelectorAll('.chat-prompt-item');
  if (idx < 0 || idx >= items.length) return;
  
  const selectedItem = items[idx];
  const command = selectedItem.querySelector('.chat-prompt-item-command').textContent;
  const prompt = openWebUiPrompts.find(p => p.command === command);
  if (!prompt) return;

  hidePromptsPopup();

  const inputEl = document.getElementById('chatInput');
  if (!inputEl) return;

  toast('Resolving template variables...', 'info');
  const resolvedContent = await resolvePromptTemplateAsync(prompt.content);
  
  inputEl.value = resolvedContent;
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(120, inputEl.scrollHeight) + 'px';
  inputEl.focus();
}

async function resolvePromptTemplateAsync(template) {
  const activeJob = activeJobId ? jobs.find(j => j.id === activeJobId) : null;
  
  const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
  let match;
  let resolved = template;
  
  const variablesToResolve = [];
  while ((match = regex.exec(template)) !== null) {
    variablesToResolve.push(match[1]);
  }
  
  for (const varName of variablesToResolve) {
    const name = varName.trim().toLowerCase();
    let replacement = null;
    
    if (name === 'clipboard') {
      try {
        replacement = await navigator.clipboard.readText();
      } catch (err) {
        console.warn('Could not read clipboard:', err);
      }
    } else if (activeJob) {
      switch (name) {
        case 'company':
        case 'company_name':
        case 'companyname':
          replacement = activeJob.company || '';
          break;
        case 'title':
        case 'job_title':
        case 'jobtitle':
        case 'role':
          replacement = activeJob.title || '';
          break;
        case 'url':
        case 'job_url':
        case 'joburl':
        case 'link':
          replacement = activeJob.url || '';
          break;
        case 'notes':
        case 'job_notes':
        case 'jobnotes':
        case 'updates':
          replacement = (activeJob.notes || []).map(n => n.text).join('\n') || '';
          break;
        case 'emails':
        case 'email_log':
          replacement = (activeJob.emails || []).map(em => `From: ${em.from}\nSubject: ${em.subject}\nDate: ${em.date}\nBody:\n${em.body}`).join('\n\n') || '';
          break;
        case 'resume':
          replacement = stripHtmlTags(activeJob.resume) || '';
          break;
        case 'cover_letter':
        case 'coverletter':
        case 'cover':
          replacement = stripHtmlTags(activeJob.coverLetter) || '';
          break;
        case 'date_applied':
        case 'dateapplied':
        case 'date':
          replacement = activeJob.dateApplied || '';
          break;
        case 'status':
          replacement = activeJob.status || '';
          break;
      }
    }
    
    if (replacement !== null) {
      const targetRegex = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'g');
      resolved = resolved.replace(targetRegex, replacement);
    }
  }
  
  return resolved;
}

function toggleChat() {
  const panel = document.getElementById('chatPanel');
  const btn = document.getElementById('chatBtn');
  if (!panel || !btn) return;

  chatVisible = !chatVisible;
  if (chatVisible) {
    panel.style.display = 'flex';
    btn.classList.add('active');
    
    // Restore position if any
    const savedPos = localStorage.getItem(CHAT_POS_KEY);
    if (savedPos) {
      try {
        const { left, top } = JSON.parse(savedPos);
        panel.style.left = left;
        panel.style.top = top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      } catch (e) {}
    } else {
      panel.style.right = '24px';
      panel.style.bottom = '90px';
      panel.style.left = 'auto';
      panel.style.top = 'auto';
    }

    const msgsEl = document.getElementById('chatMessages');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

    setTimeout(() => {
      document.getElementById('chatInput')?.focus();
    }, 100);
  } else {
    panel.style.display = 'none';
    btn.classList.remove('active');
  }
}

function switchChatTab(tab) {
  const btnUi = document.getElementById('chatTabBtnUi');
  const btnWeb = document.getElementById('chatTabBtnWeb');
  const contentUi = document.getElementById('chatTabContentUi');
  const contentWeb = document.getElementById('chatTabContentWeb');
  const iframe = document.getElementById('chatWebuiIframe');

  if (tab === 'ui') {
    btnUi.classList.add('active');
    btnWeb.classList.remove('active');
    contentUi.classList.remove('hidden');
    contentWeb.classList.add('hidden');
  } else if (tab === 'web') {
    btnUi.classList.remove('active');
    btnWeb.classList.add('active');
    contentUi.classList.add('hidden');
    contentWeb.classList.remove('hidden');
    
    // Lazy load Open WebUI dashboard in iframe
    if (!iframe.src) {
      iframe.src = `http://${openWebUiHost}:${openWebUiPort}`;
    }
  }
}

function toggleChatSettings() {
  const pane = document.getElementById('chatSettingsPane');
  if (!pane) return;
  pane.classList.toggle('hidden');
  
  if (!pane.classList.contains('hidden')) {
    document.getElementById('chatApiKey').value = localStorage.getItem('jobboard_chat_apikey') || '';
    document.getElementById('chatSystemPrompt').value = localStorage.getItem('jobboard_chat_system_prompt') || '';
    
    // Clear any previous verify connection result
    const resultEl = document.getElementById('verifyConnectionResult');
    if (resultEl) {
      resultEl.textContent = '';
      resultEl.style.color = '';
    }
    
    // Populate host/port
    const hostEl = document.getElementById('chatHost');
    const portEl = document.getElementById('chatPort');
    if (hostEl) hostEl.value = openWebUiHost;
    if (portEl) portEl.value = openWebUiPort;
    
    refreshChatModels();
  }
}

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
    return true;
  }

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = clean.match(ipv4Regex);
  if (match) {
    const o1 = parseInt(match[1], 10);
    const o2 = parseInt(match[2], 10);
    const o3 = parseInt(match[3], 10);
    const o4 = parseInt(match[4], 10);

    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;

    if (o1 === 127) return true;
    if (o1 === 10) return true;
    if (o1 === 172 && (o2 >= 16 && o2 <= 31)) return true;
    if (o1 === 192 && o2 === 168) return true;
    if (o1 === 169 && o2 === 254) return true;
  }

  if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
    return true;
  }

  return false;
}

async function saveChatSettings() {
  const apiKey = document.getElementById('chatApiKey').value.trim();
  const model = document.getElementById('chatModelSelect').value;
  const systemPrompt = document.getElementById('chatSystemPrompt').value.trim();
  const hostInput = document.getElementById('chatHost').value.trim();
  const portInput = document.getElementById('chatPort').value.trim();

  if (!hostInput || !portInput) {
    toast('Both Host/IP and Port are required.', 'error');
    return;
  }

  if (!isLocalHostOrIp(hostInput)) {
    toast('Host must be a local address (e.g. localhost, 127.0.0.1, or a private IP like 192.168.x.x).', 'error');
    return;
  }

  const port = parseInt(portInput, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    toast('Port must be a valid number between 1 and 65535.', 'error');
    return;
  }

  localStorage.setItem('jobboard_chat_apikey', apiKey);
  localStorage.setItem('jobboard_chat_model', model);
  localStorage.setItem('jobboard_chat_system_prompt', systemPrompt);

  const saveBtn = document.querySelector('#chatSettingsPane .btn-primary');
  const originalText = saveBtn ? saveBtn.textContent : 'Save Settings';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    // Save host/port/apiKey/model/prompt to backend settings.json
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        openWebUiHost: hostInput,
        openWebUiPort: port,
        openWebUiApiKey: apiKey,
        openWebUiModel: model,
        openWebUiSystemPrompt: systemPrompt
      })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to save backend settings');
    }
    
    const data = await res.json();
    openWebUiHost = data.openWebUiHost;
    openWebUiPort = data.openWebUiPort;
    
    const pane = document.getElementById('chatSettingsPane');
    if (pane) pane.classList.add('hidden');
    toast('Copilot settings saved!', 'success');
    
    // If the WebUI iframe is loaded, update its src
    const iframe = document.getElementById('chatWebuiIframe');
    if (iframe && iframe.src) {
      iframe.src = `http://${openWebUiHost}:${openWebUiPort}`;
    }
    
    refreshChatModels();
    refreshChatPrompts();
  } catch (err) {
    toast('Failed to save settings: ' + err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  }
}

async function verifyConnection() {
  const hostInput = document.getElementById('chatHost').value.trim();
  const portInput = document.getElementById('chatPort').value.trim();
  const resultEl = document.getElementById('verifyConnectionResult');
  const verifyBtn = document.getElementById('chatVerifyBtn');
  
  if (!hostInput || !portInput) {
    if (resultEl) {
      resultEl.textContent = '✗ Both Host/IP and Port are required.';
      resultEl.style.color = '#ef4444';
    }
    toast('Both Host/IP and Port are required.', 'error');
    return;
  }

  if (!isLocalHostOrIp(hostInput)) {
    if (resultEl) {
      resultEl.textContent = '✗ Host must be a local address.';
      resultEl.style.color = '#ef4444';
    }
    toast('Host must be a local address (e.g. localhost, 127.0.0.1, or a private IP like 192.168.x.x).', 'error');
    return;
  }

  const port = parseInt(portInput, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    if (resultEl) {
      resultEl.textContent = '✗ Port must be between 1 and 65535.';
      resultEl.style.color = '#ef4444';
    }
    toast('Port must be a valid number between 1 and 65535.', 'error');
    return;
  }

  if (resultEl) {
    resultEl.textContent = 'Connecting...';
    resultEl.style.color = '#a5b4fc';
  }
  if (verifyBtn) {
    verifyBtn.disabled = true;
  }
  
  try {
    const response = await fetch('/api/settings/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: hostInput, port: port })
    });
    
    const data = await response.json();
    if (response.ok && data.success) {
      if (resultEl) {
        resultEl.textContent = '✓ Connected successfully!';
        resultEl.style.color = '#10b981';
      }
      toast('Open WebUI connection verified!', 'success');
    } else {
      throw new Error(data.error || 'Unknown connection error');
    }
  } catch (err) {
    if (resultEl) {
      resultEl.textContent = `✗ Connection failed: ${err.message}`;
      resultEl.style.color = '#ef4444';
    }
    toast('Connection failed', 'error');
  } finally {
    if (verifyBtn) {
      verifyBtn.disabled = false;
    }
  }
}

async function refreshChatModels() {
  const modelSelect = document.getElementById('chatModelSelect');
  if (!modelSelect) return;
  modelSelect.innerHTML = '<option value="">Loading models...</option>';
  
  const apiKey = localStorage.getItem('jobboard_chat_apikey') || '';
  
  try {
    let response = await fetch('/api/chat-proxy/api/v1/models', {
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
    });
    
    if (!response.ok) {
      response = await fetch('/api/chat-proxy/api/models', {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
      });
    }

    if (!response.ok) {
      throw new Error(`Failed to load models (Status ${response.status})`);
    }

    const data = await response.json();
    let models = [];
    if (Array.isArray(data.data)) {
      models = data.data;
    } else if (Array.isArray(data.models)) {
      models = data.models;
    } else if (Array.isArray(data)) {
      models = data;
    }

    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No models found</option>';
      return;
    }

    modelSelect.innerHTML = models.map(m => {
      const id = m.id || m.value;
      const name = m.name || m.id || id;
      return `<option value="${id}">${name}</option>`;
    }).join('');

    const savedModel = localStorage.getItem('jobboard_chat_model');
    if (savedModel && modelSelect.querySelector(`option[value="${savedModel}"]`)) {
      modelSelect.value = savedModel;
    } else if (modelSelect.options.length > 0) {
      localStorage.setItem('jobboard_chat_model', modelSelect.value);
    }
  } catch (err) {
    console.error('Error fetching models:', err);
    modelSelect.innerHTML = '<option value="">Error fetching models (is WebUI running?)</option>';
  }
}

function parseOpenWebUiError(errText, httpStatus) {
  let rawMsg = '';
  try {
    const json = JSON.parse(errText);
    if (typeof json.detail === 'object' && json.detail !== null) {
      rawMsg = json.detail.error?.message || json.detail.message || json.detail.error || '';
    } else if (typeof json.error === 'object' && json.error !== null) {
      rawMsg = json.error.message || json.error.code || '';
    } else {
      rawMsg = json.error || json.detail || json.message || '';
    }
    if (typeof rawMsg !== 'string') rawMsg = JSON.stringify(rawMsg);
  } catch (e) {
    rawMsg = errText || '';
  }

  const checkText = (rawMsg + ' ' + errText).toLowerCase();

  if (
    checkText.includes('high demand') ||
    checkText.includes('503') ||
    checkText.includes('unavailable') ||
    checkText.includes('overloaded') ||
    checkText.includes('serviceunavailableerror') ||
    checkText.includes('geminiexception') ||
    checkText.includes('rate limit') ||
    checkText.includes('try again')
  ) {
    return '⚠️ The AI model is currently experiencing high demand and is temporarily busy. Please wait a few moments and try again.';
  }

  if (rawMsg.trim()) {
    return `AI Service Error (${httpStatus}): ${rawMsg.trim()}`;
  }

  return `AI Service returned status ${httpStatus}. Please try again in a few moments.`;
}

async function sendChatMessage() {
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  const msgsEl = document.getElementById('chatMessages');
  if (!inputEl || !sendBtn || !msgsEl || chatActiveRequest) return;

  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;
  chatActiveRequest = true;

  appendChatMessage('user', text);
  msgsEl.scrollTop = msgsEl.scrollHeight;

  const apiKey = localStorage.getItem('jobboard_chat_apikey') || '';
  const selectedModel = localStorage.getItem('jobboard_chat_model') || '';

  if (!selectedModel) {
    appendChatMessage('assistant', `⚠️ Please configure a model in settings (⚙️) first. Make sure your local Open WebUI container is running at ${openWebUiHost}:${openWebUiPort}.`);
    inputEl.disabled = false;
    sendBtn.disabled = false;
    chatActiveRequest = false;
    inputEl.focus();
    return;
  }

  try {
    const allMessages = [
      { role: 'system', content: generateChatSystemPrompt() }
    ];
    
    const historySnippet = chatHistory.slice(-10);
    historySnippet.forEach(msg => {
      allMessages.push({ role: msg.role, content: msg.content });
    });

    allMessages.push({ role: 'user', content: text });

    const response = await fetch('/api/chat-proxy/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey ? `Bearer ${apiKey}` : ''
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: allMessages,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(parseOpenWebUiError(errText, response.status));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let currentText = '';

    const assistantMsgEl = document.createElement('div');
    assistantMsgEl.className = 'chat-msg assistant';
    assistantMsgEl.innerHTML = `<div class="chat-msg-text"></div>`;
    msgsEl.appendChild(assistantMsgEl);

    const textEl = assistantMsgEl.querySelector('.chat-msg-text');

    let buffer = '';
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') {
            done = true;
            break;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const dataJson = JSON.parse(trimmed.slice(6));
              const content = dataJson.choices?.[0]?.delta?.content || '';
              currentText += content;
              textEl.innerHTML = formatMarkdown(currentText);
              msgsEl.scrollTop = msgsEl.scrollHeight;
            } catch (e) {}
          }
        }
      }
    }

    if (buffer && buffer.trim().startsWith('data: ')) {
      try {
        const dataJson = JSON.parse(buffer.trim().slice(6));
        const content = dataJson.choices?.[0]?.delta?.content || '';
        currentText += content;
        textEl.innerHTML = formatMarkdown(currentText);
      } catch (e) {}
    }

    chatHistory.push({ role: 'user', content: text });
    chatHistory.push({ role: 'assistant', content: currentText });
    saveChatHistoryToSession();

  } catch (err) {
    console.error('Chat error:', err);
    const errMsg = err.message.startsWith('⚠️') ? err.message : `❌ ${err.message}`;
    appendChatMessage('assistant', errMsg);
  } finally {
    inputEl.disabled = false;
    sendBtn.disabled = false;
    chatActiveRequest = false;
    inputEl.focus();
  }
}

function appendChatMessage(role, text) {
  const msgsEl = document.getElementById('chatMessages');
  if (!msgsEl) return;

  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role}`;
  msgEl.innerHTML = `<div class="chat-msg-text">${formatMarkdown(text)}</div>`;
  msgsEl.appendChild(msgEl);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function stripHtmlTags(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = text;

  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^\s*[-*+]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/\n/g, '<br>');

  return html;
}

function saveChatHistoryToSession() {
  sessionStorage.setItem('jobboard_chat_history', JSON.stringify(chatHistory));
}

function loadChatHistoryFromSession() {
  const saved = sessionStorage.getItem('jobboard_chat_history');
  if (saved) {
    try {
      chatHistory = JSON.parse(saved);
      chatHistory.forEach(msg => {
        appendChatMessage(msg.role, msg.content);
      });
    } catch (e) {
      chatHistory = [];
    }
  }
}

function initChatDrag() {
  const header = document.getElementById('chatHeader');
  const panel  = document.getElementById('chatPanel');
  if (!header || !panel) return;

  let dragging = false, startX = 0, startY = 0, startL = 0, startT = 0;

  header.addEventListener('mousedown', e => {
    if (e.target.closest('.chat-header-tab') || e.target.closest('.chat-header-btn') || e.target.closest('.chat-close-btn')) return;
    dragging = true;

    const rect = panel.getBoundingClientRect();
    startL = rect.left;
    startT = rect.top;

    panel.style.left  = startL + 'px';
    panel.style.top   = startT + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';

    startX = e.clientX;
    startY = e.clientY;

    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = startL + dx;
    let newTop  = startT + dy;

    const w = panel.offsetWidth, h = panel.offsetHeight;
    newLeft = Math.max(0, Math.min(window.innerWidth  - w, newLeft));
    newTop  = Math.max(0, Math.min(window.innerHeight - h, newTop));

    panel.style.left = newLeft + 'px';
    panel.style.top  = newTop  + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    localStorage.setItem(CHAT_POS_KEY, JSON.stringify({
      left: panel.style.left,
      top:  panel.style.top,
    }));
  });
}

function generateChatSystemPrompt() {
  const customPrompt = localStorage.getItem('jobboard_chat_system_prompt') || '';
  if (customPrompt) return customPrompt;

  let boardState = 'You are the JobBoard Copilot, a helpful AI assistant integrated into the user\'s Job Tracker application.\n\n';
  boardState += 'Here is the current state of the user\'s job applications board:\n';
  
  if (jobs.length === 0) {
    boardState += '- No job applications loaded yet.\n';
  } else {
    const statusGroups = {
      applied: [],
      screening: [],
      interview: [],
      offer: [],
      rejected: []
    };
    jobs.forEach(j => {
      if (statusGroups[j.status]) statusGroups[j.status].push(j);
    });

    const statusLabels = {
      applied: 'Applied',
      screening: 'Screening',
      interview: 'Interview',
      offer: 'Offer',
      rejected: 'Rejected'
    };

    for (const [status, group] of Object.entries(statusGroups)) {
      boardState += `\n* ${statusLabels[status]} (${group.length} jobs):\n`;
      if (group.length === 0) {
        boardState += '  (None)\n';
      } else {
        group.forEach(j => {
          boardState += `  - ${j.company} — ${j.title} (Applied: ${j.dateApplied})\n`;
        });
      }
    }
  }

  if (activeJobId) {
    const activeJob = jobs.find(j => j.id === activeJobId);
    if (activeJob) {
      boardState += `\n\n--- CURRENT SELECTED JOB INTERFACE CONTENT ---\n`;
      boardState += `The user has the detail modal open for this specific job application:\n`;
      boardState += `- Company: ${activeJob.company}\n`;
      boardState += `- Title: ${activeJob.title}\n`;
      boardState += `- Status: ${activeJob.status}\n`;
      boardState += `- Date Applied: ${activeJob.dateApplied}\n`;
      if (activeJob.url) boardState += `- URL: ${activeJob.url}\n`;
      
      if (activeJob.notes && activeJob.notes.length > 0) {
        boardState += `- Notes / Updates:\n`;
        activeJob.notes.forEach((n, idx) => {
          boardState += `  [${idx + 1}] (${n.timestamp}): ${n.text}\n`;
        });
      }
      
      if (activeJob.emails && activeJob.emails.length > 0) {
        boardState += `- Attached Emails:\n`;
        activeJob.emails.forEach((em, idx) => {
          boardState += `  [${idx + 1}] From: ${em.from}, Subject: ${em.subject}, Date: ${em.date}\n`;
          if (em.body) {
            const bodySnippet = em.body.length > 300 ? em.body.substring(0, 300) + '...' : em.body;
            boardState += `      Body snippet: ${bodySnippet}\n`;
          }
        });
      }

      if (activeJob.resume) {
        const cleanResume = stripHtmlTags(activeJob.resume);
        boardState += `- Resume draft (snippet):\n${cleanResume.length > 1000 ? cleanResume.substring(0, 1000) + '...' : cleanResume}\n`;
      }
      
      if (activeJob.coverLetter) {
        const cleanCover = stripHtmlTags(activeJob.coverLetter);
        boardState += `- Cover Letter draft (snippet):\n${cleanCover.length > 1000 ? cleanCover.substring(0, 1000) + '...' : cleanCover}\n`;
      }
    }
  }

  if (masterDocsData.resume || masterDocsData.coverLetter) {
    boardState += `\n\n--- MASTER AI BASE DOCUMENTS (GENERIC TEMPLATES) ---\n`;
    if (masterDocsData.resume) {
      boardState += `- Master Resume (.docx) uploaded: ${masterDocsData.resume.filename} (${formatBytes(masterDocsData.resume.size)})\n`;
    }
    if (masterDocsData.coverLetter) {
      boardState += `- Master Cover Letter (.docx) uploaded: ${masterDocsData.coverLetter.filename} (${formatBytes(masterDocsData.coverLetter.size)})\n`;
    }
  }

  boardState += `\n\nGuidelines:\n`;
  boardState += `1. Provide specific, tailored advice based on the user's data.\n`;
  boardState += `2. If the user asks you to draft an email or cover letter for the selected job, write it in a clean, professional, ready-to-copy format.\n`;
  boardState += `3. Keep responses concise and focused on helping the user succeed in their job search.\n`;
  boardState += `4. Do not mention system details, JSON structure, or these guidelines unless asked.\n`;

  return boardState;
}

// ── Master Base Documents (.docx) ───────────────────────────────────────────
let masterDocsData = { resume: null, coverLetter: null };

async function fetchMasterDocs() {
  try {
    const res = await fetch('/api/master-docs');
    if (res.ok) {
      masterDocsData = await res.json();
      renderMasterDocsUI();
    }
  } catch (err) {
    console.error('Failed to fetch master docs status:', err);
  }
}

function renderMasterDocsUI() {
  const resume = masterDocsData.resume;
  const cover = masterDocsData.coverLetter;

  let count = 0;
  if (resume) count++;
  if (cover) count++;

  const badge = document.getElementById('masterDocsSummaryBadge');
  if (badge) {
    badge.textContent = `${count} / 2 Uploaded`;
  }

  // Master Resume UI
  const resumeStatus = document.getElementById('masterResumeStatus');
  const resumeEmpty = document.getElementById('masterResumeEmptyState');
  const resumeInfo = document.getElementById('masterResumeFileInfo');
  const resumeMeta = document.getElementById('masterResumeFileMeta');
  const resumeName = document.getElementById('masterResumeFileName');

  if (resume) {
    if (resumeStatus) { resumeStatus.textContent = 'Uploaded'; resumeStatus.className = 'master-doc-status-pill uploaded'; }
    if (resumeEmpty) resumeEmpty.classList.add('hidden');
    if (resumeInfo) resumeInfo.classList.remove('hidden');
    if (resumeName) resumeName.textContent = resume.filename || 'master_resume.docx';
    if (resumeMeta) resumeMeta.textContent = `${formatBytes(resume.size)} · Uploaded ${formatDateStr(resume.uploadedAt)}`;
  } else {
    if (resumeStatus) { resumeStatus.textContent = 'Not uploaded'; resumeStatus.className = 'master-doc-status-pill empty'; }
    if (resumeEmpty) resumeEmpty.classList.remove('hidden');
    if (resumeInfo) resumeInfo.classList.add('hidden');
  }

  // Master Cover Letter UI
  const coverStatus = document.getElementById('masterCoverStatus');
  const coverEmpty = document.getElementById('masterCoverEmptyState');
  const coverInfo = document.getElementById('masterCoverFileInfo');
  const coverMeta = document.getElementById('masterCoverFileMeta');
  const coverName = document.getElementById('masterCoverFileName');

  if (cover) {
    if (coverStatus) { coverStatus.textContent = 'Uploaded'; coverStatus.className = 'master-doc-status-pill uploaded'; }
    if (coverEmpty) coverEmpty.classList.add('hidden');
    if (coverInfo) coverInfo.classList.remove('hidden');
    if (coverName) coverName.textContent = cover.filename || 'master_cover_letter.docx';
    if (coverMeta) coverMeta.textContent = `${formatBytes(cover.size)} · Uploaded ${formatDateStr(cover.uploadedAt)}`;
  } else {
    if (coverStatus) { coverStatus.textContent = 'Not uploaded'; coverStatus.className = 'master-doc-status-pill empty'; }
    if (coverEmpty) coverEmpty.classList.remove('hidden');
    if (coverInfo) coverInfo.classList.add('hidden');
  }
}

function toggleMasterDocsPanel() {
  const bar = document.getElementById('masterDocsBar');
  if (bar) {
    bar.classList.toggle('collapsed');
  }
}

function triggerMasterDocUpload(type, event) {
  if (event) event.stopPropagation();
  const inputId = type === 'coverLetter' ? 'masterCoverFileInput' : 'masterResumeFileInput';
  const el = document.getElementById(inputId);
  if (el) el.click();
}

function onMasterDocFileSelect(event, type) {
  const file = event.target.files[0];
  if (file) {
    uploadMasterDocFile(type, file);
  }
  event.target.value = '';
}

function onMasterDocDragOver(event, type) {
  event.preventDefault();
  event.stopPropagation();
  const dropzoneId = type === 'coverLetter' ? 'masterCoverDropzone' : 'masterResumeDropzone';
  const el = document.getElementById(dropzoneId);
  if (el) el.classList.add('dragover');
}

function onMasterDocDragLeave(event, type) {
  event.preventDefault();
  event.stopPropagation();
  const dropzoneId = type === 'coverLetter' ? 'masterCoverDropzone' : 'masterResumeDropzone';
  const el = document.getElementById(dropzoneId);
  if (el) el.classList.remove('dragover');
}

function onMasterDocDrop(event, type) {
  event.preventDefault();
  event.stopPropagation();
  const dropzoneId = type === 'coverLetter' ? 'masterCoverDropzone' : 'masterResumeDropzone';
  const el = document.getElementById(dropzoneId);
  if (el) el.classList.remove('dragover');

  const files = event.dataTransfer.files;
  if (files && files.length > 0) {
    uploadMasterDocFile(type, files[0]);
  }
}

async function uploadMasterDocFile(type, file) {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    toast('Only .docx files are permitted for master base documents.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('docType', type);

  try {
    const label = type === 'coverLetter' ? 'Master Cover Letter' : 'Master Resume';
    toast(`Uploading ${label}...`, 'info');

    const res = await fetch(`/api/master-docs/upload/${type}`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    masterDocsData[type === 'coverLetter' ? 'coverLetter' : 'resume'] = data.data;
    renderMasterDocsUI();
    toast(`Successfully uploaded ${label} (.docx)!`, 'success');
  } catch (err) {
    console.error('Master doc upload error:', err);
    toast(err.message || 'Failed to upload master document', 'error');
  }
}

function downloadMasterDoc(event, type) {
  if (event) event.stopPropagation();
  window.open(`/api/master-docs/download/${type}`, '_blank');
}

async function deleteMasterDoc(event, type) {
  if (event) event.stopPropagation();
  const label = type === 'coverLetter' ? 'Master Cover Letter' : 'Master Resume';
  if (!confirm(`Are you sure you want to remove your ${label}?`)) return;

  try {
    const res = await fetch(`/api/master-docs/${type}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');

    masterDocsData[type === 'coverLetter' ? 'coverLetter' : 'resume'] = null;
    renderMasterDocsUI();
    toast(`Removed ${label}`, 'success');
  } catch (err) {
    console.error('Master doc delete error:', err);
    toast(err.message || 'Failed to delete master document', 'error');
  }
}

function formatDateStr(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return isoStr;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ── AI Document Generation (.docx / HTML) ───────────────────────────────────
async function generateAiDocument(docType) { // 'resume' | 'cover'
  if (!activeJobId) {
    toast('No active job task selected.', 'error');
    return;
  }

  const job = jobs.find(j => j.id === activeJobId);
  if (!job) {
    toast('Job task not found.', 'error');
    return;
  }

  const selectedModel = localStorage.getItem('jobboard_chat_model') || '';
  if (!selectedModel) {
    toast('Please select an AI Model in Copilot settings (⚙️) first.', 'error');
    toggleChatSettings();
    return;
  }

  // Check if content already exists in the related documents tab
  const targetEditorId = docType === 'resume' ? 'resumeEditor' : 'coverEditor';
  const targetEditorEl = document.getElementById(targetEditorId);
  const existingHtml = (docType === 'resume' ? job.resume : job.coverLetter) || (targetEditorEl ? targetEditorEl.innerHTML : '');
  const existingText = (existingHtml || '').replace(/<[^>]*>/g, '').trim();

  if (existingText.length > 0) {
    const docLabel = docType === 'resume' ? 'Resume' : 'Cover Letter';
    toast(`⚠️ A ${docLabel} already exists for this job. Please clear out the existing one before generating a new one.`, 'warning');
    switchRightTab('docs');
    switchDocSubTab(docType === 'resume' ? 'resume' : 'cover');
    return;
  }

  const apiKey = localStorage.getItem('jobboard_chat_apikey') || '';
  const label = docType === 'resume' ? 'Resume' : 'Cover Letter';
  const btnId = docType === 'resume' ? 'genResumeBtn' : 'genCoverBtn';
  const btnEl = document.getElementById(btnId);
  const origBtnHtml = btnEl ? btnEl.innerHTML : '';

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = `<span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:4px;"></span> Generating ${label}...`;
  }

  try {
    toast(`Compiling context and generating customized ${label}...`, 'info');

    // 1. Extract Master Base .docx document text if available
    let masterDocText = '';
    const masterEndpoint = docType === 'resume' ? '/api/master-docs/download/resume' : '/api/master-docs/download/coverLetter';
    try {
      const res = await fetch(masterEndpoint);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        if (typeof mammoth !== 'undefined') {
          const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
          masterDocText = (result.value || '').trim();
        }
      }
    } catch (e) {
      console.warn('[AI Gen] Could not load master doc:', e.message);
    }

    // 2. Gather Job Task Details (EXCLUDING Documents tab: job.resume and job.coverLetter)
    const title = (document.getElementById('editTitle')?.value || job.title || '').trim();
    const company = (document.getElementById('editCompany')?.value || job.company || '').trim();
    const status = (document.getElementById('editStatus')?.value || job.status || 'applied');
    const dateApplied = (document.getElementById('editDate')?.value || job.dateApplied || '');
    const url = (document.getElementById('editUrl')?.value || job.url || '').trim();

    let jobContext = `JOB TASK INFORMATION:\n`;
    jobContext += `- Target Position Title: ${title}\n`;
    jobContext += `- Company Name: ${company}\n`;
    jobContext += `- Application Status: ${status}\n`;
    if (dateApplied) jobContext += `- Date Applied: ${dateApplied}\n`;
    if (url) jobContext += `- Job Listing URL: ${url}\n`;

    if (Array.isArray(job.notes) && job.notes.length > 0) {
      jobContext += `\nUPDATE LOG & NOTES FOR THIS JOB:\n`;
      job.notes.forEach((n, idx) => {
        jobContext += `[Note ${idx + 1}] (${formatDateStr(n.timestamp)}): ${n.text}\n`;
      });
    }

    if (Array.isArray(job.emails) && job.emails.length > 0) {
      jobContext += `\nATTACHED EMAILS FOR THIS JOB:\n`;
      job.emails.forEach((em, idx) => {
        jobContext += `[Email ${idx + 1}] From: ${em.from} | Subject: ${em.subject} | Date: ${em.date}\n`;
        if (em.body) {
          const snippet = em.body.length > 500 ? em.body.substring(0, 500) + '...' : em.body;
          jobContext += `  Body snippet: ${snippet}\n`;
        }
      });
    }

    let promptMessage = '';
    let systemRolePrompt = '';

    if (docType === 'resume') {
      systemRolePrompt = 'You are an AI resume generator. You generate ONLY a clean HTML Resume. You NEVER include a cover letter, application letter, or introductory salutation. You NEVER change previous job titles or fabricate unmentioned experience.';
      promptMessage = `You are an expert executive resume writer. Your goal is to customize a high-impact, professional RESUME tailored specifically for the position of "${title}" at "${company}".\n\n`;
      if (masterDocText) {
        promptMessage += `MASTER BASE RESUME (Use as candidate background, experience, skills, and base template):\n"""\n${masterDocText}\n"""\n\n`;
      } else {
        promptMessage += `(Note: No Master Resume .docx file uploaded. Generate a realistic, highly tailored professional resume for this applicant.)\n\n`;
      }
      promptMessage += `${jobContext}\n\n`;
      promptMessage += `STRICT OUTPUT REQUIREMENTS:\n`;
      promptMessage += `1. Generate ONLY the candidate's Resume. Do NOT generate or include a cover letter, application letter, email body, or introductory text/salutation.\n`;
      promptMessage += `2. DO NOT CHANGE OR ALTER PREVIOUS JOB TITLES. Keep all actual job titles EXACTLY as listed in the candidate's master background history. Do NOT alter past job titles to better match the target role.\n`;
      promptMessage += `3. DO NOT FABRICATE OR ADD UNMENTIONED EXPERIENCE. Do not invent company names, technologies, tools, or achievements not explicitly stated in the candidate's master resume or job notes.\n`;
      promptMessage += `4. Tailor the candidate's professional summary, skills, and work experience bullet points specifically to emphasize fit for ${title} at ${company}.\n`;
      promptMessage += `5. Output clean, semantic HTML suitable for rich text display (use <h1>, <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em> tags).\n`;
      promptMessage += `6. Do NOT wrap output in markdown code fences (like \`\`\`html). Return ONLY the raw HTML body content. Do not include <html> or <body> tags.`;
    } else {
      systemRolePrompt = 'You are an AI cover letter generator. You generate ONLY a clean HTML Cover Letter. You NEVER include a resume, work history bullet points, or CV. You NEVER change job titles or fabricate unmentioned experience.';
      promptMessage = `You are an expert career consultant. Your goal is to write a compelling, tailored COVER LETTER for the position of "${title}" at "${company}".\n\n`;
      if (masterDocText) {
        promptMessage += `MASTER BASE COVER LETTER (Use as style/tone guide and applicant details template):\n"""\n${masterDocText}\n"""\n\n`;
      } else {
        promptMessage += `(Note: No Master Cover Letter .docx file uploaded. Generate a compelling, professional cover letter tailored for this job.)\n\n`;
      }
      promptMessage += `${jobContext}\n\n`;
      promptMessage += `STRICT OUTPUT REQUIREMENTS:\n`;
      promptMessage += `1. Generate ONLY the Cover Letter. Do NOT generate or include a resume, work history bullet points, or full curriculum vitae.\n`;
      promptMessage += `2. DO NOT ALTER PREVIOUS JOB TITLES OR FABRICATE EXPERIENCE. Stick strictly to actual past job titles and verified experience from the applicant's background.\n`;
      promptMessage += `3. Address the hiring team/manager at ${company} regarding the ${title} role.\n`;
      promptMessage += `4. Highlight enthusiasm, key experience, and align with notes/emails from the application.\n`;
      promptMessage += `5. Output clean, semantic HTML suitable for rich text display (use <h1>, <h2>, <p>, <ul>, <li>, <strong>, <em> tags).\n`;
      promptMessage += `6. Do NOT wrap output in markdown code fences (like \`\`\`html). Return ONLY the raw HTML body content. Do not include <html> or <body> tags.`;
    }

    // 3. Call Open WebUI Chat Completion API via proxy
    const response = await fetch('/api/chat-proxy/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey ? `Bearer ${apiKey}` : ''
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemRolePrompt },
          { role: 'user', content: promptMessage }
        ],
        stream: false
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(parseOpenWebUiError(errText, response.status));
    }

    const data = await response.json();
    let generatedContent = data.choices?.[0]?.message?.content || '';

    // Strip markdown code fences if model included them
    generatedContent = generatedContent
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    if (!generatedContent) {
      throw new Error('AI returned an empty document.');
    }

    // 4. Save to task and update Documents Tab
    if (docType === 'resume') {
      job.resume = generatedContent;
      const editor = document.getElementById('resumeEditor');
      if (editor) editor.innerHTML = generatedContent;
      const hint = document.getElementById('resumeSavedHint');
      if (hint) hint.textContent = 'AI Generated & Saved';
    } else {
      job.coverLetter = generatedContent;
      const editor = document.getElementById('coverEditor');
      if (editor) editor.innerHTML = generatedContent;
      const hint = document.getElementById('coverSavedHint');
      if (hint) hint.textContent = 'AI Generated & Saved';
    }

    // Switch to Documents tab and target subtab
    switchRightTab('docs');
    switchDocSubTab(docType === 'resume' ? 'resume' : 'cover');

    // Persist changes
    saveEditJob();

    toast(`✨ Customized ${label} generated and saved to Documents tab!`, 'success');

  } catch (err) {
    console.error(`[AI Gen Error] ${label}:`, err);
    toast(err.message || `Failed to generate ${label}`, 'error');
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = origBtnHtml;
    }
  }
}
