/**
 * Claude Code Focus Mode - Background Service Worker
 * Handles status polling, settings management, and dynamic content injection
 *
 * Uses WebSocket for instant updates when Claude Code uses a tool.
 * Falls back to HTTP polling when WebSocket is disconnected.
 *
 * NOTE: MV3 service workers are ephemeral - they get terminated after ~30s of inactivity.
 * We use chrome.alarms API for reliable periodic polling that persists across restarts.
 *
 * Broadcast serialization: only one broadcast runs at a time. If a new broadcast is
 * requested while one is in progress, it is queued (latest wins). This prevents
 * concurrent tab-iteration from sending conflicting messages.
 */

const DAEMON_URL = 'http://127.0.0.1:31415';
const DAEMON_WS_URL = 'ws://127.0.0.1:31415';
const POLL_INTERVAL_MS = 5000;
const WS_RECONNECT_DELAY_MS = 3000;
const ALARM_NAME = 'claude-focus-status-check';
const ALARM_PERIOD_MINUTES = 0.5; // 30 seconds fallback when WS is down
const DEBUG = false;

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

// ─── Broadcast serialization ───────────────────────────────────────
// Prevents concurrent broadcasts from sending conflicting messages.
let broadcastInProgress = false;
let broadcastQueued = false;

async function serializedBroadcast() {
  if (broadcastInProgress) {
    broadcastQueued = true;
    return;
  }
  broadcastInProgress = true;
  try {
    await broadcastStatus();
  } finally {
    broadcastInProgress = false;
    if (broadcastQueued) {
      broadcastQueued = false;
      // Use setTimeout(0) to avoid deep recursion on rapid-fire updates
      setTimeout(() => serializedBroadcast(), 0);
    }
  }
}

// ─── updateAllSites serialization ──────────────────────────────────
// Generation counter: each call gets a generation number. If a newer call
// starts while we're iterating, the older call stops sending messages.
let updateGeneration = 0;

async function serializedUpdateAllSites() {
  const gen = ++updateGeneration;
  await updateAllSites(gen);
}

// ─── Settings ──────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(['enabled', 'timeout', 'sites']);

    if (stored.enabled !== undefined) settings.enabled = stored.enabled;
    if (stored.timeout !== undefined) settings.timeout = stored.timeout;
    if (stored.sites !== undefined) {
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

function urlMatchesEnabledSite(url) {
  if (!settings.enabled) return false;

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    for (const site of settings.sites) {
      if (!site.enabled) continue;

      for (const pattern of site.patterns) {
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\//g, '\\/');

        if (new RegExp(regexPattern).test(url)) {
          return true;
        }

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

// ─── Content script injection ──────────────────────────────────────

async function injectContentScript(tabId) {
  if (injectedTabs.has(tabId)) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles.css'],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['media-controller.js'],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });

    injectedTabs.add(tabId);
    if (DEBUG) console.log('[Claude Focus BG] Injected into tab:', tabId);

    // Send INIT immediately — no delay. The content script is ready right after
    // executeScript resolves.
    chrome.tabs.sendMessage(tabId, {
      type: 'INIT',
      status: lastStatus,
      timeout: settings.timeout,
    }).catch(() => {
      // Tab might have navigated away already
    });

  } catch (e) {
    if (DEBUG) console.log('[Claude Focus BG] Injection failed for tab:', tabId);
  }
}

// ─── Status checking ───────────────────────────────────────────────

async function checkStatus() {
  try {
    const response = await fetch(`${DAEMON_URL}/status?timeout=${settings.timeout}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
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

  await serializedBroadcast();
}

// ─── WebSocket ─────────────────────────────────────────────────────

function connectWebSocket() {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    wsConnection = new WebSocket(DAEMON_WS_URL);

    wsConnection.onopen = () => {
      if (DEBUG) console.log('[Claude Focus BG] WebSocket connected');
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    wsConnection.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status') {
          const timeoutMs = settings.timeout * 60 * 1000;
          const isActive = data.elapsed < timeoutMs;

          lastStatus = {
            ...data,
            active: isActive,
            daemonOnline: true,
            timeout: settings.timeout,
          };

          await serializedBroadcast();
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

function scheduleReconnect() {
  if (wsReconnectTimer) return;

  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, WS_RECONNECT_DELAY_MS);
}

// ─── Broadcasting ──────────────────────────────────────────────────

async function broadcastStatus() {
  try {
    const allTabs = await chrome.tabs.query({});

    if (!settings.enabled) {
      for (const tab of allTabs) {
        if (!tab.url || !tab.url.startsWith('http')) continue;

        if (urlMatchesAnySite(tab.url)) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'STATUS_UPDATE',
              status: { active: true, disabled: true },
            });
          } catch (e) {
            // Content script not present
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
      }
    }
  } catch (e) {
    console.error('[Claude Focus BG] Broadcast error:', e);
  }
}

/**
 * Update all sites in one pass after a settings change.
 * Accepts a generation number — stops iterating if a newer generation started.
 */
async function updateAllSites(gen) {
  try {
    const allTabs = await chrome.tabs.query({});

    for (const tab of allTabs) {
      // Bail out if a newer settings change superseded us
      if (gen !== updateGeneration) return;

      if (!tab.url || !tab.url.startsWith('http')) continue;

      if (urlMatchesAnySite(tab.url)) {
        if (settings.enabled && urlMatchesEnabledSite(tab.url)) {
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
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'STATUS_UPDATE',
              status: { active: true, disabled: true },
            });
          } catch (e) {
            // Content script not present
          }
        }
      }
    }
  } catch (e) {
    console.error('[Claude Focus BG] Update all sites error:', e);
  }
}

// ─── Tab event handling ────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Handle full page loads — inject when page is complete (not loading)
  // This eliminates the old 500ms setTimeout race window.
  if (changeInfo.status === 'complete' && tab.url) {
    injectedTabs.delete(tabId);

    if (urlMatchesEnabledSite(tab.url)) {
      await injectContentScript(tabId);
    }
  }

  // Handle SPA navigations (YouTube, etc.) — the URL changes within the
  // same page. Re-send status so the content script re-pauses any new
  // media elements (e.g. a new video player after clicking a video link).
  // YouTube fires changeInfo.url alongside changeInfo.status, so we check
  // for url changes regardless of whether status is also present. The
  // content script's FSM handles duplicate same-state updates as no-ops.
  if (changeInfo.url && injectedTabs.has(tabId)) {
    if (urlMatchesEnabledSite(changeInfo.url)) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'STATUS_UPDATE',
          status: { ...lastStatus, timeout: settings.timeout },
        });
      } catch (e) {
        injectedTabs.delete(tabId);
      }
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// ─── Message handling ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    if (!settings.enabled || (sender.tab?.url && !urlMatchesEnabledSite(sender.tab.url))) {
      sendResponse({ active: true, disabled: true });
      return true;
    }

    checkStatus().then(() => {
      const response = lastStatus || { active: false, daemonOnline: false, timeout: settings.timeout };
      sendResponse(response);
    }).catch(() => {
      sendResponse({ active: false, daemonOnline: false, timeout: settings.timeout });
    });
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    sendResponse(settings);
    return true;
  }

  if (message.type === 'SETTINGS_CHANGED') {
    settings = message.settings;
    if (DEBUG) console.log('[Claude Focus BG] Settings updated');

    // Do NOT clear injectedTabs — that causes unnecessary re-injection thrash.
    // The content script guards against double injection already.
    // Use serialized update to prevent concurrent iterations.
    serializedUpdateAllSites();
    return true;
  }

  return false;
});

// Listen for storage changes from other sources (e.g. sync from another device)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    loadSettings();
  }
});

// ─── Extension lifecycle ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const { onboardingComplete } = await chrome.storage.local.get('onboardingComplete');

    if (!onboardingComplete) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding.html'),
      });
    }
  }
});

// ─── Alarm-based polling (survives service worker termination) ─────

async function setupAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      connectWebSocket();
      checkStatus();
    }
  }
});

self.addEventListener('activate', () => {
  checkStatus();
});

// ─── Initialize ────────────────────────────────────────────────────

loadSettings().then(async () => {
  await setupAlarm();
  connectWebSocket();
  checkStatus();

  setInterval(() => {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      checkStatus();
    }
  }, POLL_INTERVAL_MS);
});
