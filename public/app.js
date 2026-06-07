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
  document.getElementById('addDate').value = todayStr();
  await loadJobs();
  renderBoard();
  applyFilter();
  renderStats();
  loadBackupStatus();
  setupGlobalListeners();
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
        await api('POST', `/api/screenshot/${job.id}`, { imageData: pendingAddScreenshot });
        job.screenshot = true;
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

  // Word-compatible HTML document wrapper
  const wordDoc = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; margin: 1in; color: #000; }
    h1   { font-size: 16pt; font-weight: bold; margin-bottom: 6pt; }
    h2   { font-size: 13pt; font-weight: bold; margin-bottom: 4pt; }
    h3   { font-size: 11pt; font-weight: bold; margin-bottom: 3pt; }
    p    { margin: 0 0 6pt; }
    ul   { margin: 0 0 6pt 18pt; list-style-type: disc; }
    ol   { margin: 0 0 6pt 18pt; }
    li   { margin-bottom: 2pt; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 6pt; }
    td, th { border: 1px solid #ccc; padding: 4pt 6pt; font-size: 10pt; }
    a  { color: #1155cc; }
    b, strong { font-weight: bold; }
    i, em     { font-style: italic; }
    u         { text-decoration: underline; }
  </style>
</head>
<body>${html}</body>
</html>`;

  const blob = new Blob([wordDoc], { type: 'application/msword' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${safeName}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`📄 "${safeName}.doc" downloaded`, 'success');
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

// ── Modal helpers ─────────────────────────────────────────────────────────
function handleOverlayClick(e, id) {
  if (e.target.id === id) {
    if (id === 'addModal') closeAddModal();
    else if (id === 'editModal') closeEditModal();
    else if (id === 'importModal') closeImportModal();
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
