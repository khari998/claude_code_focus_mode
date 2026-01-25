/**
 * Claude Code Focus - Background Service Worker
 * Handles status polling, settings management, and dynamic content injection
 *
 * Uses WebSocket for instant updates when Claude Code uses a tool.
 * Falls back to HTTP polling when WebSocket is disconnected.
 *
 * NOTE: MV3 service workers are ephemeral - they get terminated after ~30s of inactivity.
 * We use chrome.alarms API for reliable periodic polling that persists across restarts.
 */

const DAEMON_URL = 'http://127.0.0.1:31415';
const DAEMON_WS_URL = 'ws://127.0.0.1:31415';
const POLL_INTERVAL_MS = 5000;
const WS_RECONNECT_DELAY_MS = 3000;
const ALARM_NAME = 'claude-focus-status-check';
const ALARM_PERIOD_MINUTES = 0.5; // 30 seconds fallback when WS is down
const DEBUG = false; // Set to true for verbose logging

let wsConnection = null;
let wsReconnectTimer = null;

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

    if (DEBUG) console.log('[Claude Focus BG] Settings loaded:', settings);
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
        // IMPORTANT: Must escape . BEFORE converting * to .* otherwise the . in .* gets escaped
        const regexPattern = pattern
          .replace(/\./g, '\\.')     // First: escape dots
          .replace(/\*/g, '.*')      // Then: convert * to .*
          .replace(/\//g, '\\/');    // Finally: escape slashes

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
    if (DEBUG) console.log('[Claude Focus BG] Injected into tab:', tabId);

    // Send current status and settings
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        type: 'INIT',
        status: lastStatus,
        timeout: settings.timeout,
      }).catch(() => {
        // Tab might not be ready yet, will get status via polling
      });
    }, 100);

  } catch (e) {
    // Injection can fail for chrome:// pages, etc.
    if (DEBUG) console.log('[Claude Focus BG] Injection failed for tab:', tabId);
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

    if (DEBUG) console.log('[Claude Focus BG] Status:', lastStatus.active ? 'active' : 'inactive');
  } catch (e) {
    if (DEBUG) console.log('[Claude Focus BG] Daemon offline');
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

/**
 * Connect to daemon via WebSocket for instant updates
 */
function connectWebSocket() {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    return; // Already connected
  }

  try {
    wsConnection = new WebSocket(DAEMON_WS_URL);

    wsConnection.onopen = () => {
      if (DEBUG) console.log('[Claude Focus BG] WebSocket connected');
      // Clear any reconnect timer
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    wsConnection.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status') {
          // Apply custom timeout
          const timeoutMs = settings.timeout * 60 * 1000;
          const isActive = data.elapsed < timeoutMs;

          lastStatus = {
            ...data,
            active: isActive,
            daemonOnline: true,
            timeout: settings.timeout,
          };

          // Immediately broadcast to all tabs
          await broadcastStatus();
        }
      } catch (e) {
        console.error('[Claude Focus BG] WebSocket message error:', e);
      }
    };

    wsConnection.onclose = () => {
      wsConnection = null;
      scheduleReconnect();
    };

    wsConnection.onerror = () => {
      wsConnection = null;
      scheduleReconnect();
    };
  } catch (e) {
    scheduleReconnect();
  }
}

/**
 * Schedule WebSocket reconnection
 */
function scheduleReconnect() {
  if (wsReconnectTimer) return; // Already scheduled

  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, WS_RECONNECT_DELAY_MS);
}

// Update all tabs in one pass - enabled sites get status, disabled sites get removed
// This prevents flicker by not doing remove-then-add
async function updateAllSites() {
  try {
    const allTabs = await chrome.tabs.query({});

    for (const tab of allTabs) {
      if (!tab.url || !tab.url.startsWith('http')) continue;

      // Check if this tab matches any site pattern
      if (urlMatchesAnySite(tab.url)) {
        // Check if this specific site is currently enabled
        if (settings.enabled && urlMatchesEnabledSite(tab.url)) {
          // Site is enabled - inject if needed and send current status
          try {
            if (!injectedTabs.has(tab.id)) {
              await injectContentScript(tab.id);
            }
            await chrome.tabs.sendMessage(tab.id, {
              type: 'STATUS_UPDATE',
              status: { ...lastStatus, timeout: settings.timeout },
            });
          } catch (e) {
            injectedTabs.delete(tab.id);
          }
        } else {
          // Site is disabled (or global is off) - remove overlay
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'STATUS_UPDATE',
              status: { active: true, disabled: true },
            });
          } catch (e) {
            // Content script not present, that's fine
          }
        }
      }
    }
  } catch (e) {
    console.error('[Claude Focus BG] Update all sites error:', e);
  }
}

// Check if URL matches ANY site pattern (regardless of enabled state)
function urlMatchesAnySite(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    for (const site of settings.sites) {
      for (const pattern of site.patterns) {
        const patternHost = pattern.match(/\*:\/\/\*?\.?([^\/]+)/)?.[1];
        if (patternHost && (hostname === patternHost || hostname.endsWith('.' + patternHost))) {
          return true;
        }
      }
    }
  } catch (e) {
    // Invalid URL
  }
  return false;
}

// Broadcast status to matching tabs
async function broadcastStatus() {
  try {
    // Query all tabs
    const allTabs = await chrome.tabs.query({});

    // If extension is disabled, tell ALL potentially-affected tabs to remove overlay
    // Don't rely on injectedTabs - just try to send to any tab that matches our site patterns
    if (!settings.enabled) {
      for (const tab of allTabs) {
        if (!tab.url || !tab.url.startsWith('http')) continue;

        // Check if this tab could have an overlay (matches any site pattern)
        if (urlMatchesAnySite(tab.url)) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'STATUS_UPDATE',
              status: { active: true, disabled: true },
            });
          } catch (e) {
            // Content script not present, that's fine
          }
        }
      }
      return;
    }

    const patterns = getEnabledPatterns();
    if (patterns.length === 0) return;

    for (const tab of allTabs) {
      if (!tab.url) continue;

      if (urlMatchesEnabledSite(tab.url)) {
        try {
          // Inject if needed
          if (!injectedTabs.has(tab.id)) {
            await injectContentScript(tab.id);
          }

          // Send status update (always use current settings.timeout)
          await chrome.tabs.sendMessage(tab.id, {
            type: 'STATUS_UPDATE',
            status: { ...lastStatus, timeout: settings.timeout },
          });
        } catch (e) {
          // Tab might be closed, navigated, or not ready
          injectedTabs.delete(tab.id);
        }
      }
    }
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
    // Check if sender's site is still enabled (global toggle + site toggle)
    // If not, tell content script to remove overlay
    if (!settings.enabled || (sender.tab?.url && !urlMatchesEnabledSite(sender.tab.url))) {
      sendResponse({ active: true, disabled: true });
      return true;
    }

    // Do a fresh check and respond
    checkStatus().then(() => {
      const response = lastStatus || { active: false, daemonOnline: false, timeout: settings.timeout };
      sendResponse(response);
    }).catch(() => {
      sendResponse({ active: false, daemonOnline: false, timeout: settings.timeout });
    });
    return true; // Indicates async response
  }

  if (message.type === 'GET_SETTINGS') {
    sendResponse(settings);
    return true;
  }

  if (message.type === 'SETTINGS_CHANGED') {
    settings = message.settings;
    if (DEBUG) console.log('[Claude Focus BG] Settings updated');

    // Clear injected tabs tracking
    injectedTabs.clear();

    // Update all sites in one pass - prevents flicker by not doing remove-then-add
    // Enabled sites get current status, disabled sites get removed
    updateAllSites();
    return true;
  }

  return false;
});

// Listen for storage changes (e.g., from other extension pages or sync)
// Note: When popup sends SETTINGS_CHANGED message, that handler takes care of everything.
// This listener is mainly for changes from other sources (e.g., chrome sync from another device)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    // Just reload settings - don't broadcast here to avoid race with SETTINGS_CHANGED handler
    // The periodic status check or next navigation will pick up the changes
    loadSettings();
  }
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Check if onboarding was already completed (e.g., reinstall)
    const { onboardingComplete } = await chrome.storage.local.get('onboardingComplete');

    if (!onboardingComplete) {
      // Open onboarding page
      chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding.html'),
      });
    }
  }
});

// Set up persistent alarm for reliable polling (survives service worker termination)
async function setupAlarm() {
  // Clear any existing alarm
  await chrome.alarms.clear(ALARM_NAME);

  // Create a repeating alarm
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES,
  });
}

// Listen for alarm - this fires even if service worker was terminated
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    // Try to reconnect WebSocket if not connected
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      connectWebSocket();
      checkStatus(); // Only poll if WebSocket is down
    }
  }
});

// Also listen for service worker startup to immediately check status
self.addEventListener('activate', () => {
  checkStatus();
});

// Initialize
loadSettings().then(async () => {
  // Set up persistent alarm as fallback
  await setupAlarm();

  // Connect to WebSocket for instant updates
  connectWebSocket();

  // Immediate check on startup
  checkStatus();

  // Also use setInterval as fallback while worker is active
  setInterval(() => {
    // Only poll if WebSocket is not connected
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      checkStatus();
    }
  }, POLL_INTERVAL_MS);
});
