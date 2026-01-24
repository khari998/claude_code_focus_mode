/**
 * Claude Code Focus - Background Service Worker
 * Handles status polling, settings management, and dynamic content injection
 */

const DAEMON_URL = 'http://127.0.0.1:31415';
const POLL_INTERVAL = 5000;

const DEFAULT_SITES = [
  { id: 'youtube', name: 'YouTube', patterns: ['*://*.youtube.com/*'], enabled: true, builtin: true },
  { id: 'twitter', name: 'Twitter/X', patterns: ['*://*.twitter.com/*', '*://*.x.com/*'], enabled: false, builtin: true },
  { id: 'reddit', name: 'Reddit', patterns: ['*://*.reddit.com/*'], enabled: false, builtin: true },
  { id: 'facebook', name: 'Facebook', patterns: ['*://*.facebook.com/*'], enabled: false, builtin: true },
  { id: 'instagram', name: 'Instagram', patterns: ['*://*.instagram.com/*'], enabled: false, builtin: true },
  { id: 'tiktok', name: 'TikTok', patterns: ['*://*.tiktok.com/*'], enabled: false, builtin: true },
  { id: 'twitch', name: 'Twitch', patterns: ['*://*.twitch.tv/*'], enabled: false, builtin: true },
  { id: 'netflix', name: 'Netflix', patterns: ['*://*.netflix.com/*'], enabled: false, builtin: true },
];

let settings = {
  enabled: true,
  timeout: 2,
  sites: [...DEFAULT_SITES],
};

let lastStatus = { active: false, daemonOnline: false };
let injectedTabs = new Set();

// Load settings from storage
async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(['enabled', 'timeout', 'sites']);

    if (stored.enabled !== undefined) settings.enabled = stored.enabled;
    if (stored.timeout !== undefined) settings.timeout = stored.timeout;
    if (stored.sites !== undefined) {
      // Merge with defaults
      const storedIds = new Set(stored.sites.map(s => s.id));
      const mergedSites = [...stored.sites];

      for (const defaultSite of DEFAULT_SITES) {
        if (!storedIds.has(defaultSite.id)) {
          mergedSites.push(defaultSite);
        }
      }

      settings.sites = mergedSites;
    }

    console.log('[Claude Focus BG] Settings loaded:', settings);
  } catch (e) {
    console.error('[Claude Focus BG] Failed to load settings:', e);
  }
}

// Get enabled site patterns
function getEnabledPatterns() {
  if (!settings.enabled) return [];

  const patterns = [];
  for (const site of settings.sites) {
    if (site.enabled) {
      patterns.push(...site.patterns);
    }
  }
  return patterns;
}

// Check if URL matches any enabled site
function urlMatchesEnabledSite(url) {
  if (!settings.enabled) return false;

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    for (const site of settings.sites) {
      if (!site.enabled) continue;

      for (const pattern of site.patterns) {
        // Convert match pattern to regex
        const regexPattern = pattern
          .replace(/\*/g, '.*')
          .replace(/\//g, '\\/')
          .replace(/\./g, '\\.');

        if (new RegExp(regexPattern).test(url)) {
          return true;
        }

        // Also check hostname directly
        const patternHost = pattern.match(/\*:\/\/\*?\.?([^\/]+)/)?.[1];
        if (patternHost && (hostname === patternHost || hostname.endsWith('.' + patternHost))) {
          return true;
        }
      }
    }
  } catch (e) {
    console.error('[Claude Focus BG] URL match error:', e);
  }

  return false;
}

// Inject content scripts into a tab
async function injectContentScript(tabId) {
  if (injectedTabs.has(tabId)) return;

  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles.css'],
    });

    // Inject media controller first (content.js depends on it)
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['media-controller.js'],
    });

    // Then inject content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });

    injectedTabs.add(tabId);
    console.log('[Claude Focus BG] Injected into tab:', tabId);

    // Send current status and settings
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        type: 'INIT',
        status: lastStatus,
        timeout: settings.timeout,
      }).catch(() => {});
    }, 100);

  } catch (e) {
    console.error('[Claude Focus BG] Injection failed:', e);
  }
}

// Check daemon status
async function checkStatus() {
  try {
    const response = await fetch(`${DAEMON_URL}/status?timeout=${settings.timeout}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // Apply custom timeout
    const timeoutMs = settings.timeout * 60 * 1000;
    const isActive = data.elapsed < timeoutMs;

    lastStatus = {
      ...data,
      active: isActive,
      daemonOnline: true,
      timeout: settings.timeout,
    };

    console.log('[Claude Focus BG] Status:', lastStatus);
  } catch (e) {
    console.log('[Claude Focus BG] Daemon error:', e.message);
    lastStatus = {
      active: false,
      daemonOnline: false,
      error: e.message,
      timeout: settings.timeout,
    };
  }

  // Broadcast to all matching tabs
  await broadcastStatus();
}

// Broadcast status to matching tabs
async function broadcastStatus() {
  if (!settings.enabled) return;

  const patterns = getEnabledPatterns();
  if (patterns.length === 0) return;

  try {
    // Query all tabs
    const allTabs = await chrome.tabs.query({});

    let matchCount = 0;
    for (const tab of allTabs) {
      if (!tab.url) continue;

      if (urlMatchesEnabledSite(tab.url)) {
        matchCount++;

        // Inject if needed
        if (!injectedTabs.has(tab.id)) {
          await injectContentScript(tab.id);
        }

        // Send status update
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'STATUS_UPDATE',
            status: lastStatus,
          });
        } catch (e) {
          // Tab might not have content script ready
          injectedTabs.delete(tab.id);
        }
      }
    }

    console.log('[Claude Focus BG] Broadcast to', matchCount, 'matching tabs');
  } catch (e) {
    console.error('[Claude Focus BG] Broadcast error:', e);
  }
}

// Handle tab updates (for newly navigated tabs)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    // Remove from injected set since page is reloading
    injectedTabs.delete(tabId);

    if (urlMatchesEnabledSite(tab.url)) {
      // Wait a bit for page to be ready
      setTimeout(() => injectContentScript(tabId), 500);
    }
  }
});

// Handle tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse(lastStatus);
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    sendResponse(settings);
    return true;
  }

  if (message.type === 'SETTINGS_CHANGED') {
    settings = message.settings;
    console.log('[Claude Focus BG] Settings updated:', settings);

    // Re-check all tabs
    injectedTabs.clear();
    broadcastStatus();
    return true;
  }

  return false;
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    console.log('[Claude Focus BG] Storage changed:', changes);
    loadSettings().then(() => {
      injectedTabs.clear();
      broadcastStatus();
    });
  }
});

// Initialize
loadSettings().then(() => {
  checkStatus();
  setInterval(checkStatus, POLL_INTERVAL);
});

console.log('[Claude Focus BG] Service worker started');
