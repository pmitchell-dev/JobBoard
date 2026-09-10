/**
 * JobBoard Extension Background Service Worker (Manifest V3)
 */

// Helper to safely access contextMenus API
function initContextMenu() {
  try {
    if (typeof chrome !== 'undefined' && chrome && chrome.contextMenus) {
      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
          // ignore error if any
        }
        try {
          chrome.contextMenus.create({
            id: "add-to-jobboard",
            title: "Add Page to JobBoard",
            contexts: ["page", "selection"]
          }, () => {
            if (chrome.runtime.lastError) {
              // ignore error
            }
          });
        } catch (e) {
          console.warn('[JobBoard] Context menu creation warning:', e);
        }
      });
    }
  } catch (e) {
    console.warn('[JobBoard] Context menu init warning:', e);
  }
}

// Register on install / update
chrome.runtime.onInstalled.addListener(() => {
  initContextMenu();
});

// Register click listener safely
try {
  if (typeof chrome !== 'undefined' && chrome && chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info && info.menuItemId === "add-to-jobboard" && tab) {
        let serverUrl = '';
        try {
          const result = await chrome.storage.local.get(['serverUrl']);
          if (result && result.serverUrl) {
            serverUrl = result.serverUrl.trim();
          }
        } catch (e) {
          // fallback
        }
        if (!serverUrl) {
          console.warn('[JobBoard Extension] Cannot add job via context menu: No server URL configured.');
          return;
        }
        serverUrl = serverUrl.replace(/\/$/, '');

        const company = extractCompanyFromTitle(tab.title || '') || 'New Company';
        const title   = info.selectionText ? info.selectionText.trim() : (extractJobTitleFromTitle(tab.title || '') || tab.title || 'Position');
        const url     = tab.url || '';

        try {
          const res = await fetch(`${serverUrl}/api/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company,
              title,
              url,
              status: 'applied',
              dateApplied: new Date().toISOString().split('T')[0]
            })
          });

          if (res.ok) {
            console.log('[JobBoard Extension] Added job via context menu:', title);
          }
        } catch (err) {
          console.error('[JobBoard Extension] Failed to add job via context menu:', err);
        }
      }
    });
  }
} catch (err) {
  console.warn('[JobBoard] Context menu listener warning:', err);
}

function extractCompanyFromTitle(pageTitle) {
  if (!pageTitle) return '';
  if (pageTitle.includes(' at ')) {
    const parts = pageTitle.split(/\sat\s/i);
    return parts[1] ? parts[1].split(/[-–—|]/)[0].trim() : '';
  }
  if (pageTitle.includes(' - ')) {
    const parts = pageTitle.split(' - ');
    return parts[1] ? parts[1].trim() : '';
  }
  return '';
}

function extractJobTitleFromTitle(pageTitle) {
  if (!pageTitle) return '';
  if (pageTitle.includes(' at ')) {
    return pageTitle.split(/\sat\s/i)[0].trim();
  }
  if (pageTitle.includes(' - ')) {
    return pageTitle.split(' - ')[0].trim();
  }
  return pageTitle;
}
