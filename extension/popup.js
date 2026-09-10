/**
 * JobBoard Chrome Extension Controller (popup.js)
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ── State Variables ──────────────────────────────────────────────────────────
  let serverUrl = '';
  let allJobs = [];
  let activeStatuses = new Set(['all']);
  let currentAppliedFilter = 'all';
  let currentUpdatedFilter = 'all';
  let searchQuery = '';
  let activeJob = null; // Currently opened job in drawer

  // ── DOM References ───────────────────────────────────────────────────────────
  const serverStatusBadge = document.getElementById('serverStatus');
  const searchInput       = document.getElementById('searchInput');
  const statusPills       = document.querySelectorAll('.status-pills .pill');
  const appliedPills      = document.querySelectorAll('.applied-pill');
  const updatedPills      = document.querySelectorAll('.updated-pill');
  const jobsListEl        = document.getElementById('jobsList');
  const loadingSpinner    = document.getElementById('loadingSpinner');
  const emptyStateEl      = document.getElementById('emptyState');
  const emptyMessageEl    = document.getElementById('emptyMessage');
  
  // Header Buttons
  const addJobBtn         = document.getElementById('addJobBtn');
  const settingsBtn       = document.getElementById('settingsBtn');
  const quickAddTabBtn    = document.getElementById('quickAddTabBtn');

  // Job Modal
  const jobModal          = document.getElementById('jobModal');
  const closeJobModal     = document.getElementById('closeJobModal');
  const cancelJobBtn      = document.getElementById('cancelJobBtn');
  const jobForm           = document.getElementById('jobForm');
  const modalTitle        = document.getElementById('modalTitle');
  const jobIdInput        = document.getElementById('jobId');
  const formCompany       = document.getElementById('formCompany');
  const formTitle         = document.getElementById('formTitle');
  const formUrl           = document.getElementById('formUrl');
  const formStatus        = document.getElementById('formStatus');
  const formDate          = document.getElementById('formDate');

  // Detail Drawer & Editable Fields
  const detailDrawer       = document.getElementById('detailDrawer');
  const closeDrawer        = document.getElementById('closeDrawer');
  const drawerCompany      = document.getElementById('drawerCompany');
  const drawerTitle        = document.getElementById('drawerTitle');
  const drawerTabs         = document.querySelectorAll('.drawer-tab');
  const drawerTabInfo      = document.getElementById('drawerTabInfo');
  const drawerTabNotes     = document.getElementById('drawerTabNotes');
  const drawerTabDocs      = document.getElementById('drawerTabDocs');
  const drawerNotesCount   = document.getElementById('drawerNotesCount');
  
  const drawerEditCompany  = document.getElementById('drawerEditCompany');
  const drawerEditTitle    = document.getElementById('drawerEditTitle');
  const drawerEditUrl      = document.getElementById('drawerEditUrl');
  const drawerEditDate     = document.getElementById('drawerEditDate');
  const drawerStatusSelect = document.getElementById('drawerStatusSelect');
  const drawerUrlLink      = document.getElementById('drawerUrlLink');
  const drawerCreated      = document.getElementById('drawerCreated');
  const saveDrawerEditsBtn = document.getElementById('saveDrawerEditsBtn');

  const newNoteText        = document.getElementById('newNoteText');
  const saveNoteBtn        = document.getElementById('saveNoteBtn');
  const notesListEl        = document.getElementById('notesList');

  // AI Document Elements
  const generateResumeBtn  = document.getElementById('generateResumeBtn');
  const downloadResumeBtn  = document.getElementById('downloadResumeBtn');
  const resumeTextarea     = document.getElementById('resumeTextarea');
  const resumeStatusMsg    = document.getElementById('resumeStatusMsg');

  const generateCoverBtn   = document.getElementById('generateCoverBtn');
  const downloadCoverBtn   = document.getElementById('downloadCoverBtn');
  const coverTextarea      = document.getElementById('coverTextarea');
  const coverStatusMsg     = document.getElementById('coverStatusMsg');

  // Settings Modal
  const settingsModal     = document.getElementById('settingsModal');
  const closeSettingsModal= document.getElementById('closeSettingsModal');
  const serverUrlInput    = document.getElementById('serverUrlInput');
  const testConnBtn       = document.getElementById('testConnBtn');
  const saveSettingsBtn   = document.getElementById('saveSettingsBtn');
  const settingsAlert     = document.getElementById('settingsAlert');

  // Setup Screen Elements
  const setupScreen       = document.getElementById('setupScreen');
  const setupUrlInput     = document.getElementById('setupUrlInput');
  const saveSetupBtn      = document.getElementById('saveSetupBtn');
  const testSetupConnBtn  = document.getElementById('testSetupConnBtn');
  const setupAlert        = document.getElementById('setupAlert');
  const controlsSection   = document.querySelector('.controls-section');
  const quickActionBar    = document.querySelector('.quick-action-bar');

  // Count Badges
  const countAll          = document.getElementById('countAll');
  const countApplied      = document.getElementById('countApplied');
  const countScreening    = document.getElementById('countScreening');
  const countInterview    = document.getElementById('countInterview');
  const countOffer        = document.getElementById('countOffer');
  const countRejected     = document.getElementById('countRejected');

  // ── 1. Storage & Initialization ─────────────────────────────────────────────
  await loadServerUrl();
  if (!serverUrl) {
    showSetupScreen();
  } else {
    showMainBoard();
    await refreshData();
  }

  function showSetupScreen() {
    if (setupScreen) setupScreen.classList.remove('hidden');
    if (loadingSpinner) loadingSpinner.classList.add('hidden');
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    if (jobsListEl) jobsListEl.classList.add('hidden');
    if (controlsSection) controlsSection.classList.add('hidden');
    if (quickActionBar) quickActionBar.classList.add('hidden');
    if (serverStatusBadge) {
      serverStatusBadge.textContent = '● Not Configured';
      serverStatusBadge.className = 'status-badge status-offline';
    }
  }

  function showMainBoard() {
    if (setupScreen) setupScreen.classList.add('hidden');
    if (jobsListEl) jobsListEl.classList.remove('hidden');
    if (controlsSection) controlsSection.classList.remove('hidden');
    if (quickActionBar) quickActionBar.classList.remove('hidden');
  }

  // Setup Chips Handler
  const setupChips = document.querySelectorAll('.setup-chip');
  setupChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.url && setupUrlInput) {
        setupUrlInput.value = chip.dataset.url;
      }
    });
  });

  // Setup Test Connection Handler
  if (testSetupConnBtn) {
    testSetupConnBtn.addEventListener('click', async () => {
      const rawVal = setupUrlInput ? setupUrlInput.value.trim() : '';
      if (!rawVal) {
        if (setupAlert) {
          setupAlert.textContent = 'Please enter a valid server address.';
          setupAlert.className = 'alert alert-error';
          setupAlert.classList.remove('hidden');
        }
        return;
      }

      const testUrl = cleanServerUrl(rawVal);
      if (setupUrlInput) setupUrlInput.value = testUrl;
      if (setupAlert) setupAlert.className = 'alert hidden';
      testSetupConnBtn.textContent = 'Testing...';

      try {
        let isConnected = false;
        let res = await fetch(`${testUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          isConnected = true;
        } else {
          const jobsRes = await fetch(`${testUrl}/api/jobs`, { signal: AbortSignal.timeout(3000) });
          if (jobsRes.ok) isConnected = true;
        }

        if (isConnected && setupAlert) {
          setupAlert.textContent = 'Connected successfully!';
          setupAlert.className = 'alert alert-success';
          setupAlert.classList.remove('hidden');
        } else {
          throw new Error('Server unreachable');
        }
      } catch (e) {
        if (setupAlert) {
          setupAlert.textContent = `Connection failed: ${e.message}. Please verify address.`;
          setupAlert.className = 'alert alert-error';
          setupAlert.classList.remove('hidden');
        }
      } finally {
        testSetupConnBtn.textContent = 'Test Connection';
      }
    });
  }

  // Setup Save & Connect Handler
  if (saveSetupBtn) {
    saveSetupBtn.addEventListener('click', async () => {
      const rawVal = setupUrlInput ? setupUrlInput.value.trim() : '';
      if (!rawVal) {
        if (setupAlert) {
          setupAlert.textContent = 'Please enter a valid server address.';
          setupAlert.className = 'alert alert-error';
          setupAlert.classList.remove('hidden');
        }
        return;
      }

      const cleanUrl = cleanServerUrl(rawVal);
      await saveServerUrl(cleanUrl);
      showMainBoard();
      await refreshData();
    });
  }

  function cleanServerUrl(input) {
    let url = (input || '').trim();
    if (!url) return '';

    let protocol = 'http://';
    if (/^https:\/\//i.test(url)) {
      protocol = 'https://';
    }

    // 1. Remove duplicate/repeated protocols (e.g. http://http:// -> http://)
    url = url.replace(/^(https?:\/\/)+/gi, '');

    // 2. Auto-fix typos like 192.168.50.217/:3001 -> 192.168.50.217:3001
    url = url.replace(/:\/+(\d+)/g, ':$1');
    url = url.replace(/([a-zA-Z0-9.-]+)\/+:(\d+)/g, '$1:$2');

    // 3. Re-attach single protocol
    url = protocol + url;

    // 4. Remove trailing slashes
    return url.replace(/\/+$/, '');
  }

  async function loadServerUrl() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['serverUrl'], result => {
          if (result && result.serverUrl) {
            serverUrl = cleanServerUrl(result.serverUrl);
          } else {
            serverUrl = '';
          }
          serverUrlInput.value = serverUrl;
          if (setupUrlInput) setupUrlInput.value = serverUrl;
          resolve();
        });
      } else {
        serverUrlInput.value = serverUrl;
        if (setupUrlInput) setupUrlInput.value = serverUrl;
        resolve();
      }
    });
  }

  async function saveServerUrl(url) {
    const cleanUrl = cleanServerUrl(url);
    serverUrl = cleanUrl;
    serverUrlInput.value = cleanUrl;
    if (setupUrlInput) setupUrlInput.value = cleanUrl;
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        if (cleanUrl) {
          chrome.storage.local.set({ serverUrl: cleanUrl }, resolve);
        } else {
          chrome.storage.local.remove(['serverUrl'], resolve);
        }
      } else {
        resolve();
      }
    });
  }

  // ── 2. API Communication ───────────────────────────────────────────────────
  async function checkHealth() {
    if (!serverUrl) {
      serverStatusBadge.textContent = '● Not Configured';
      serverStatusBadge.className = 'status-badge status-offline';
      return false;
    }

    try {
      let res = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        serverStatusBadge.textContent = '● Online';
        serverStatusBadge.className = 'status-badge status-online';
        return true;
      }
      // Fallback check to /api/jobs
      res = await fetch(`${serverUrl}/api/jobs`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        serverStatusBadge.textContent = '● Online';
        serverStatusBadge.className = 'status-badge status-online';
        return true;
      }
    } catch (e) {
      console.warn('Health check failed:', e);
    }
    serverStatusBadge.textContent = '● Offline';
    serverStatusBadge.className = 'status-badge status-offline';
    return false;
  }

  async function refreshData() {
    loadingSpinner.classList.remove('hidden');
    emptyStateEl.classList.add('hidden');
    jobsListEl.innerHTML = '';

    if (!serverUrl) {
      loadingSpinner.classList.add('hidden');
      renderUnconfiguredState();
      updateCounts([]);
      return;
    }

    const isOnline = await checkHealth();
    if (!isOnline) {
      loadingSpinner.classList.add('hidden');
      emptyMessageEl.innerHTML = 'Cannot connect to JobBoard API server.<br>Please check settings.';
      emptyStateEl.classList.remove('hidden');
      updateCounts([]);
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/api/jobs`);
      if (!res.ok) throw new Error('Failed to fetch jobs');
      allJobs = await res.json();
      updateCounts(allJobs);
      renderJobs();
    } catch (err) {
      console.error('Error loading jobs:', err);
      emptyMessageEl.textContent = 'Error loading jobs from server.';
      emptyStateEl.classList.remove('hidden');
    } finally {
      loadingSpinner.classList.add('hidden');
    }
  }

  async function notifyDashboardOfUpdate() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      if (!serverUrl) return;
      try {
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => {
          if (tab.url && tab.url.startsWith(serverUrl)) {
            chrome.tabs.reload(tab.id);
          }
        });
      } catch (e) {
        console.warn('Could not reload dashboard tabs', e);
      }
    }
  }

  // ── 3. Counts & Filtering ──────────────────────────────────────────────────
  function updateCounts(jobs) {
    const counts = { all: jobs.length, applied: 0, screening: 0, interview: 0, offer: 0, rejected: 0 };
    jobs.forEach(j => {
      const s = (j.status || 'applied').toLowerCase();
      if (counts[s] !== undefined) counts[s]++;
    });

    countAll.textContent       = counts.all;
    countApplied.textContent   = counts.applied;
    countScreening.textContent = counts.screening;
    countInterview.textContent = counts.interview;
    countOffer.textContent     = counts.offer;
    countRejected.textContent  = counts.rejected;
  }

  function getFilteredJobs() {
    return allJobs.filter(job => {
      // Status filter
      const jobStatus = (job.status || '').toLowerCase();
      if (!activeStatuses.has('all') && !activeStatuses.has(jobStatus)) {
        return false;
      }

      // Date filter
      const todayStr = new Date().toISOString().split('T')[0];
      
      if (currentAppliedFilter !== 'all') {
        const rawDate = job.dateApplied || job.createdAt;
        if (!rawDate) return false;
        const jobDateStr = typeof rawDate === 'string' ? rawDate.split('T')[0] : new Date(rawDate).toISOString().split('T')[0];

        if (currentAppliedFilter === 'today') {
          if (jobDateStr !== todayStr) return false;
        } else if (currentAppliedFilter === '7days') {
          const d7 = new Date(); d7.setDate(d7.getDate() - 7);
          if (jobDateStr < d7.toISOString().split('T')[0] || jobDateStr > todayStr) return false;
        } else if (currentAppliedFilter === '30days') {
          const d30 = new Date(); d30.setDate(d30.getDate() - 30);
          if (jobDateStr < d30.toISOString().split('T')[0] || jobDateStr > todayStr) return false;
        } else if (currentAppliedFilter === 'this-month') {
          const dMonth = new Date(); dMonth.setDate(1);
          if (jobDateStr < dMonth.toISOString().split('T')[0] || jobDateStr > todayStr) return false;
        }
      }

      if (currentUpdatedFilter !== 'all') {
        const rawUpdated = job.updatedAt || job.createdAt;
        if (!rawUpdated) return false;
        const jobUpdatedStr = typeof rawUpdated === 'string' ? rawUpdated.split('T')[0] : new Date(rawUpdated).toISOString().split('T')[0];

        if (currentUpdatedFilter === 'today') {
          if (jobUpdatedStr !== todayStr) return false;
        } else if (currentUpdatedFilter === '7days') {
          const d7 = new Date(); d7.setDate(d7.getDate() - 7);
          if (jobUpdatedStr < d7.toISOString().split('T')[0] || jobUpdatedStr > todayStr) return false;
        } else if (currentUpdatedFilter === '30days') {
          const d30 = new Date(); d30.setDate(d30.getDate() - 30);
          if (jobUpdatedStr < d30.toISOString().split('T')[0] || jobUpdatedStr > todayStr) return false;
        } else if (currentUpdatedFilter === 'this-month') {
          const dMonth = new Date(); dMonth.setDate(1);
          if (jobUpdatedStr < dMonth.toISOString().split('T')[0] || jobUpdatedStr > todayStr) return false;
        }
      }

      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const company = (job.company || '').toLowerCase();
        const title   = (job.title || '').toLowerCase();
        const url     = (job.url || '').toLowerCase();
        const notes   = (job.notes || []).map(n => n.text || '').join(' ').toLowerCase();
        return company.includes(q) || title.includes(q) || url.includes(q) || notes.includes(q);
      }
      return true;
    });
  }

  // ── 4. Rendering Job List ──────────────────────────────────────────────────
  function renderJobs() {
    const jobsToRender = getFilteredJobs();
    jobsListEl.innerHTML = '';

    if (jobsToRender.length === 0) {
      emptyMessageEl.textContent = searchQuery
        ? 'No jobs match your search query.'
        : `No job applications match selected stage/date filters.`;
      emptyStateEl.classList.remove('hidden');
      return;
    }

    emptyStateEl.classList.add('hidden');

    jobsToRender.forEach(job => {
      const card = document.createElement('div');
      card.className = 'job-card';
      card.dataset.id = job.id;
      card.title = "Double-click entry to edit details or generate AI Resume/Cover Letter";

      const dateStr = job.dateApplied || (job.createdAt ? job.createdAt.split('T')[0] : '');

      card.innerHTML = `
        <div class="card-top">
          <div>
            <div class="company-name">${escapeHtml(job.company || 'Unknown Company')}</div>
            <div class="job-title">${escapeHtml(job.title || 'Untitled Position')}</div>
          </div>
          <div class="card-actions">
            <button class="action-btn delete-btn" title="Delete Job">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
        <div class="card-meta">
          <span class="date-badge">📅 ${dateStr}</span>
          <select class="status-select-card" data-id="${job.id}" data-status="${job.status || 'applied'}">
            <option value="applied" ${job.status === 'applied' ? 'selected' : ''}>Applied</option>
            <option value="screening" ${job.status === 'screening' ? 'selected' : ''}>Screening</option>
            <option value="interview" ${job.status === 'interview' ? 'selected' : ''}>Interview</option>
            <option value="offer" ${job.status === 'offer' ? 'selected' : ''}>Offer</option>
            <option value="rejected" ${job.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </div>
      `;

      // Double-click to pop open drawer with full edits & AI tools
      card.addEventListener('dblclick', () => openDrawer(job));

      const deleteBtn = card.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteJob(job.id);
      });
      
      const statusSelect = card.querySelector('.status-select-card');
      statusSelect.addEventListener('click', (e) => e.stopPropagation());
      statusSelect.addEventListener('change', async (e) => {
        const newStatus = e.target.value;
        statusSelect.dataset.status = newStatus;
        await patchJobStatus(job.id, newStatus);
      });

      jobsListEl.appendChild(card);
    });
  }

  // ── 5. Auto-Detect Active Tab & Quick Add ───────────────────────────────────
  quickAddTabBtn.addEventListener('click', async () => {
    if (!serverUrl) {
      openSettingsModal();
      return;
    }

    let activeTab = null;
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) activeTab = tabs[0];
    }

    let detectedCompany = '';
    let detectedTitle   = '';
    let detectedUrl     = activeTab ? activeTab.url : '';

    if (activeTab && activeTab.title) {
      const parsed = parsePageTitle(activeTab.title, activeTab.url);
      detectedCompany = parsed.company;
      detectedTitle   = parsed.title;
    }

    openJobModal({
      id: null,
      company: detectedCompany,
      title: detectedTitle,
      url: detectedUrl,
      status: 'applied',
      dateApplied: new Date().toISOString().split('T')[0]
    });
  });

  function parsePageTitle(rawTitle, rawUrl) {
    let title = rawTitle.trim();
    let company = '';

    // Heuristics for common job sites (LinkedIn, Indeed, Glassdoor, Lever, Greenhouse)
    if (rawUrl.includes('linkedin.com')) {
      // e.g. "Software Engineer - Acme Corp | LinkedIn"
      const parts = title.replace('| LinkedIn', '').split(/[-–—|]/);
      if (parts.length >= 2) {
        title = parts[0].trim();
        company = parts[1].trim();
      }
    } else if (rawUrl.includes('indeed.com')) {
      // e.g. "Senior Developer - Acme Corp - City, ST"
      const parts = title.split(/[-–—|]/);
      if (parts.length >= 2) {
        title = parts[0].trim();
        company = parts[1].trim();
      }
    } else if (title.includes(' at ')) {
      // e.g. "Software Engineer at Google"
      const parts = title.split(/\sat\s/i);
      title = parts[0].trim();
      company = parts[1].split(/[-–—|]/)[0].trim();
    } else if (title.includes(' - ')) {
      const parts = title.split(' - ');
      title = parts[0].trim();
      company = parts[1].trim();
    }

    return { company, title };
  }

  // ── 6. Job Add / Edit Modal ────────────────────────────────────────────────
  addJobBtn.addEventListener('click', () => {
    if (!serverUrl) {
      openSettingsModal();
      return;
    }
    openJobModal({
      id: null,
      company: '',
      title: '',
      url: '',
      status: 'applied',
      dateApplied: new Date().toISOString().split('T')[0]
    });
  });

  function openJobModal(job = {}) {
    jobIdInput.value   = job.id || '';
    formCompany.value  = job.company || '';
    formTitle.value    = job.title || '';
    formUrl.value      = job.url || '';
    formStatus.value   = job.status || 'applied';
    formDate.value     = job.dateApplied || new Date().toISOString().split('T')[0];

    modalTitle.textContent = job.id ? 'Edit Job Entry' : 'Add New Job Entry';
    jobModal.classList.remove('hidden');
    formCompany.focus();
  }

  function closeModal() {
    jobModal.classList.add('hidden');
    jobForm.reset();
  }

  closeJobModal.addEventListener('click', closeModal);
  cancelJobBtn.addEventListener('click', closeModal);

  jobForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!serverUrl) {
      alert('No server URL configured. Please enter a server address in Settings.');
      openSettingsModal();
      return;
    }

    const id = jobIdInput.value;
    const payload = {
      company: formCompany.value.trim(),
      title: formTitle.value.trim(),
      url: formUrl.value.trim(),
      status: formStatus.value,
      dateApplied: formDate.value
    };

    try {
      if (id) {
        // Edit via PUT/PATCH
        await fetch(`${serverUrl}/api/jobs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // Create via POST
        await fetch(`${serverUrl}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      closeModal();
      await refreshData();
      notifyDashboardOfUpdate();
    } catch (err) {
      alert('Error saving job: ' + err.message);
    }
  });

  // ── 7. Status Patch & Deletion ─────────────────────────────────────────────
  async function patchJobStatus(id, newStatus) {
    if (!serverUrl) return;
    try {
      await fetch(`${serverUrl}/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const localJob = allJobs.find(j => j.id === id);
      if (localJob) localJob.status = newStatus;
      updateCounts(allJobs);
      notifyDashboardOfUpdate();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function deleteJob(id) {
    if (!serverUrl) return;
    if (!confirm('Are you sure you want to delete this job record?')) return;
    try {
      await fetch(`${serverUrl}/api/jobs/${id}`, { method: 'DELETE' });
      await refreshData();
      notifyDashboardOfUpdate();
    } catch (err) {
      alert('Failed to delete job: ' + err.message);
    }
  }

  // ── 8. Job Detail Drawer, Edits, Notes & AI Tools ──────────────────────────
  function openDrawer(job) {
    activeJob = job;
    drawerCompany.textContent = job.company || 'Unknown Company';
    drawerTitle.textContent   = job.title || 'Untitled Position';

    // Populate editable fields
    drawerEditCompany.value  = job.company || '';
    drawerEditTitle.value    = job.title || '';
    drawerEditUrl.value      = job.url || '';
    drawerStatusSelect.value = job.status || 'applied';
    drawerEditDate.value     = job.dateApplied || (job.createdAt ? job.createdAt.split('T')[0] : '');
    drawerCreated.textContent= job.createdAt ? new Date(job.createdAt).toLocaleString() : 'N/A';

    if (job.url) {
      drawerUrlLink.href = job.url;
      drawerUrlLink.style.display = 'inline-block';
    } else {
      drawerUrlLink.style.display = 'none';
    }

    // Populate AI document fields
    resumeTextarea.value = job.resumeText || '';
    coverTextarea.value  = job.coverLetterText || '';
    if (resumeStatusMsg) resumeStatusMsg.classList.add('hidden');
    if (coverStatusMsg)  coverStatusMsg.classList.add('hidden');

    renderNotes(job.notes || []);
    detailDrawer.classList.remove('hidden');
  }

  closeDrawer.addEventListener('click', () => {
    detailDrawer.classList.add('hidden');
    activeJob = null;
  });

  if (saveDrawerEditsBtn) {
    saveDrawerEditsBtn.addEventListener('click', async () => {
      if (!activeJob) return;
      if (!serverUrl) {
        alert('No server URL configured.');
        return;
      }

      const payload = {
        company: drawerEditCompany.value.trim(),
        title: drawerEditTitle.value.trim(),
        url: drawerEditUrl.value.trim(),
        status: drawerStatusSelect.value,
        dateApplied: drawerEditDate.value
      };

      try {
        await fetch(`${serverUrl}/api/jobs/${activeJob.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        Object.assign(activeJob, payload);
        drawerCompany.textContent = activeJob.company;
        drawerTitle.textContent   = activeJob.title;
        await refreshData();
        notifyDashboardOfUpdate();
        alert('Job entry details updated successfully!');
      } catch (err) {
        alert('Failed to save changes: ' + err.message);
      }
    });
  }

  drawerStatusSelect.addEventListener('change', async (e) => {
    if (!activeJob) return;
    const newStatus = e.target.value;
    activeJob.status = newStatus;
    await patchJobStatus(activeJob.id, newStatus);
    renderJobs();
  });

  // Drawer Tabs
  drawerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      drawerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      if (drawerTabInfo) drawerTabInfo.classList.toggle('hidden', target !== 'info');
      if (drawerTabNotes) drawerTabNotes.classList.toggle('hidden', target !== 'notes');
      if (drawerTabDocs)  drawerTabDocs.classList.toggle('hidden', target !== 'docs');
    });
  });

  function renderNotes(notes) {
    drawerNotesCount.textContent = notes.length;
    notesListEl.innerHTML = '';

    if (notes.length === 0) {
      notesListEl.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:12px; font-size:11px;">No notes added yet.</div>';
      return;
    }

    notes.slice().reverse().forEach(note => {
      const item = document.createElement('div');
      item.className = 'note-item';
      const timeStr = note.timestamp ? new Date(note.timestamp).toLocaleString() : '';
      item.innerHTML = `
        <div class="note-time">${timeStr}</div>
        <div class="note-text">${escapeHtml(note.text || '')}</div>
        <span class="note-delete" title="Delete note" data-id="${note.id}">&times;</span>
      `;

      item.querySelector('.note-delete').addEventListener('click', () => deleteNote(note.id));
      notesListEl.appendChild(item);
    });
  }

  saveNoteBtn.addEventListener('click', async () => {
    if (!activeJob) return;
    if (!serverUrl) {
      alert('No server URL configured.');
      openSettingsModal();
      return;
    }

    const text = newNoteText.value.trim();
    if (!text) return;

    try {
      const res = await fetch(`${serverUrl}/api/jobs/${activeJob.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const note = await res.json();
      activeJob.notes = activeJob.notes || [];
      activeJob.notes.push(note);
      newNoteText.value = '';
      renderNotes(activeJob.notes);
      await refreshData();
      notifyDashboardOfUpdate();
    } catch (err) {
      alert('Failed to add note: ' + err.message);
    }
  });

  async function deleteNote(noteId) {
    if (!activeJob) return;
    if (!serverUrl) return;
    try {
      await fetch(`${serverUrl}/api/jobs/${activeJob.id}/notes/${noteId}`, { method: 'DELETE' });
      activeJob.notes = (activeJob.notes || []).filter(n => n.id !== noteId);
      renderNotes(activeJob.notes);
      await refreshData();
      notifyDashboardOfUpdate();
    } catch (err) {
      alert('Failed to delete note: ' + err.message);
    }
  }

  // ── 9. AI Resume & Cover Letter Generator & File Downloader ────────────────
  async function getOpenWebUiSettings() {
    try {
      const res = await fetch(`${serverUrl}/api/settings`);
      if (res.ok) return await res.json();
    } catch (e) { console.error('Failed to fetch settings', e); }
    return {};
  }

  async function fetchMasterDoc(type) {
    try {
      const res = await fetch(`${serverUrl}/api/master-docs/parse-sections/${type}`);
      if (res.ok) return await res.json();
    } catch (e) { console.warn(`Failed to fetch master ${type}`, e); }
    return null;
  }

  async function queryAiProxy(messages, model, apiKey) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      
      const res = await fetch(`${serverUrl}/api/chat-proxy/api/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'llama3',
          messages: messages
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.choices && data.choices.length > 0) {
          return data.choices[0].message.content;
        }
      }
    } catch(e) {
      console.warn('AI Generation failed via proxy', e);
    }
    return null;
  }

  function downloadTextFile(filename, text) {
    if (!text || !text.trim()) {
      alert('No document text available to download.');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (generateResumeBtn) {
    generateResumeBtn.addEventListener('click', async () => {
      if (!activeJob) return;
      resumeStatusMsg.textContent = '⚡ Generating tailored resume summary with AI...';
      resumeStatusMsg.classList.remove('hidden');
      generateResumeBtn.disabled = true;

      const settings = await getOpenWebUiSettings();
      const masterResume = await fetchMasterDoc('resume');
      
      let masterContext = '';
      if (masterResume) {
        masterContext = `\n\n--- BASE MASTER RESUME ---\n${JSON.stringify(masterResume, null, 2)}\n---------------------------\n`;
      }

      const notesSummary = (activeJob.notes || []).map(n => n.text).join('; ');
      let prompt = `Write a targeted resume profile summary and key experience bullet points tailored for the position of "${activeJob.title}" at "${activeJob.company}". Include key skills in systems administration, infrastructure engineering, software development, and automation. Job Listing URL: ${activeJob.url || 'N/A'}. Additional notes: ${notesSummary || 'None'}.`;
      
      if (masterContext) {
        prompt += `\nPlease use the following master resume details as the foundational context to craft the tailored resume:\n${masterContext}`;
      }

      const messages = [];
      if (settings.openWebUiSystemPrompt) {
        messages.push({ role: 'system', content: settings.openWebUiSystemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      let resultText = await queryAiProxy(messages, settings.openWebUiModel, settings.openWebUiApiKey);
      if (!resultText) {
        resultText = `========================================================================\nTAILORED RESUME SUMMARY & HIGHLIGHTS\nPosition: ${activeJob.title}\nCompany: ${activeJob.company}\nDate Prepared: ${new Date().toLocaleDateString()}\nListing URL: ${activeJob.url || 'N/A'}\n========================================================================\n\nPROFESSIONAL SUMMARY\nHighly skilled technical professional applying for ${activeJob.title} at ${activeJob.company}. Proven expertise in system architecture, automated workflow development, infrastructure monitoring, and software engineering.\n\nCORE COMPETENCIES\n• Infrastructure & Server Management (Linux, Windows Server, Virtualization)\n• Software Engineering & REST API Development\n• Systems Reliability, Monitoring & Process Automation\n• Technical Problem Resolution & Continuous Integration\n\nTARGETED EXPERIENCE HIGHLIGHTS FOR ${activeJob.company.toUpperCase()}\n• Engineered high-availability server environment and streamlined deployment pipelines.\n• Automated routine technical workflows, significantly reducing operational downtime.\n• Collaborated cross-functionally to implement secure, reliable infrastructure solutions.\n`;
      }

      resumeTextarea.value = resultText;
      activeJob.resumeText = resultText;
      resumeStatusMsg.textContent = '✓ Resume generated!';
      generateResumeBtn.disabled = false;

      if (serverUrl && activeJob.id) {
        fetch(`${serverUrl}/api/jobs/${activeJob.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeText: resultText })
        }).catch(err => console.error('Failed to save resumeText:', err));
      }
    });
  }

  if (downloadResumeBtn) {
    downloadResumeBtn.addEventListener('click', () => {
      if (!activeJob) return;
      const safeCompany = (activeJob.company || 'Company').replace(/[^a-z0-9]/gi, '_');
      const safeTitle   = (activeJob.title || 'Job').replace(/[^a-z0-9]/gi, '_');
      downloadTextFile(`${safeCompany}_${safeTitle}_Resume.txt`, resumeTextarea.value);
    });
  }

  if (generateCoverBtn) {
    generateCoverBtn.addEventListener('click', async () => {
      if (!activeJob) return;
      coverStatusMsg.textContent = '⚡ Writing tailored cover letter with AI...';
      coverStatusMsg.classList.remove('hidden');
      generateCoverBtn.disabled = true;

      const settings = await getOpenWebUiSettings();
      const masterResume = await fetchMasterDoc('resume');
      const masterCover = await fetchMasterDoc('cover');
      
      let masterContext = '';
      if (masterResume) {
        masterContext += `\n--- BASE MASTER RESUME ---\n${JSON.stringify(masterResume, null, 2)}\n`;
      }
      if (masterCover) {
        masterContext += `\n--- BASE MASTER COVER LETTER ---\n${JSON.stringify(masterCover, null, 2)}\n`;
      }

      const notesSummary = (activeJob.notes || []).map(n => n.text).join('; ');
      let prompt = `Write a formal, compelling, and professional cover letter applying to "${activeJob.title}" at "${activeJob.company}". Express enthusiastic interest, highlight technical skills in systems administration and software automation, and reference key details. Notes: ${notesSummary || 'None'}.`;
      
      if (masterContext) {
        prompt += `\nPlease use the following master document details as the foundational context to craft the tailored cover letter:\n${masterContext}`;
      }

      const messages = [];
      if (settings.openWebUiSystemPrompt) {
        messages.push({ role: 'system', content: settings.openWebUiSystemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      let resultText = await queryAiProxy(messages, settings.openWebUiModel, settings.openWebUiApiKey);
      if (!resultText) {
        const todayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        resultText = `${todayDate}\n\nHiring Manager\n${activeJob.company}\n\nRE: Application for ${activeJob.title} position\n\nDear Hiring Manager at ${activeJob.company},\n\nI am writing to express my strong enthusiasm for the ${activeJob.title} role at ${activeJob.company}. With my background in systems administration, software automation, and infrastructure engineering, I am confident in my ability to deliver immediate value to your organization.\n\nMy technical experience encompasses designing robust server architectures, building automated integration tools, and optimizing system uptime. I am drawn to ${activeJob.company}'s mission and would be thrilled to bring my problem-solving drive and technical expertise to your team.\n\nThank you for considering my application. I look forward to the opportunity to discuss how my qualifications align with your requirements.\n\nSincerely,\n\nPatrick Mitchell\n`;
      }

      coverTextarea.value = resultText;
      activeJob.coverLetterText = resultText;
      coverStatusMsg.textContent = '✓ Cover letter generated!';
      generateCoverBtn.disabled = false;

      if (serverUrl && activeJob.id) {
        fetch(`${serverUrl}/api/jobs/${activeJob.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coverLetterText: resultText })
        }).catch(err => console.error('Failed to save coverLetterText:', err));
      }
    });
  }

  if (downloadCoverBtn) {
    downloadCoverBtn.addEventListener('click', () => {
      if (!activeJob) return;
      const safeCompany = (activeJob.company || 'Company').replace(/[^a-z0-9]/gi, '_');
      const safeTitle   = (activeJob.title || 'Job').replace(/[^a-z0-9]/gi, '_');
      downloadTextFile(`${safeCompany}_${safeTitle}_Cover_Letter.txt`, coverTextarea.value);
    });
  }

  // ── 10. Settings Modal & Filters ──────────────────────────────────────────
  function openSettingsModal() {
    settingsAlert.className = 'alert hidden';
    serverUrlInput.value = serverUrl;
    settingsModal.classList.remove('hidden');
    serverUrlInput.focus();
  }

  settingsBtn.addEventListener('click', openSettingsModal);

  const presetChips = document.querySelectorAll('.preset-chip');
  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.url) {
        serverUrlInput.value = chip.dataset.url;
      }
    });
  });

  closeSettingsModal.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  testConnBtn.addEventListener('click', async () => {
    const rawVal = serverUrlInput.value.trim();
    if (!rawVal) {
      settingsAlert.textContent = 'Please enter a server address to test.';
      settingsAlert.className = 'alert alert-error';
      return;
    }

    const testUrl = cleanServerUrl(rawVal);
    serverUrlInput.value = testUrl;
    settingsAlert.className = 'alert hidden';
    testConnBtn.textContent = 'Testing...';

    try {
      let res = await fetch(`${testUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        settingsAlert.textContent = `Connected! Service: ${data.service || 'JobBoard'} (Jobs: ${data.jobCount ?? 'Available'})`;
        settingsAlert.className = 'alert alert-success';
      } else {
        // Fallback to /api/jobs
        const jobsRes = await fetch(`${testUrl}/api/jobs`, { signal: AbortSignal.timeout(3000) });
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          settingsAlert.textContent = `Connected to JobBoard! (Jobs: ${Array.isArray(jobsData) ? jobsData.length : 0})`;
          settingsAlert.className = 'alert alert-success';
        } else {
          throw new Error('HTTP ' + jobsRes.status);
        }
      }
    } catch (e) {
      settingsAlert.textContent = `Connection failed: ${e.message}`;
      settingsAlert.className = 'alert alert-error';
    } finally {
      testConnBtn.textContent = 'Test Connection';
    }
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const newUrl = serverUrlInput.value.trim();
    if (!newUrl) {
      await saveServerUrl('');
      settingsModal.classList.add('hidden');
      await refreshData();
      return;
    }
    await saveServerUrl(newUrl);
    settingsModal.classList.add('hidden');
    await refreshData();
  });

  // ── 11. Controls & Filter Handlers ─────────────────────────────────────────
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderJobs();
  });

  statusPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const status = pill.dataset.status;
      if (status === 'all') {
        activeStatuses.clear();
        activeStatuses.add('all');
        statusPills.forEach(p => {
          if (p.dataset.status === 'all') p.classList.add('active');
          else p.classList.remove('active');
        });
      } else {
        activeStatuses.delete('all');
        const allPill = Array.from(statusPills).find(p => p.dataset.status === 'all');
        if (allPill) allPill.classList.remove('active');

        if (activeStatuses.has(status)) {
          activeStatuses.delete(status);
          pill.classList.remove('active');
          if (activeStatuses.size === 0) {
            activeStatuses.add('all');
            if (allPill) allPill.classList.add('active');
          }
        } else {
          activeStatuses.add(status);
          pill.classList.add('active');
        }
      }
      renderJobs();
    });
  });

  appliedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      appliedPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentAppliedFilter = pill.dataset.appliedDate;
      renderJobs();
    });
  });

  updatedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      updatedPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentUpdatedFilter = pill.dataset.updatedDate;
      renderJobs();
    });
  });

  // Popout Feature
  const popoutBtn = document.getElementById('popoutBtn');
  if (popoutBtn) {
    popoutBtn.addEventListener('click', () => {
      chrome.windows.create({
        url: 'popup.html',
        type: 'popup',
        width: 420,
        height: 620
      });
      window.close();
    });
  }

  // Helper Utility
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
