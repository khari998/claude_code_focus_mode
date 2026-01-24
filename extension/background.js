/**
 * Background service worker for Claude Productivity Blocker
 * Handles status polling and communication with content scripts
 */

const DAEMON_URL = 'http://127.0.0.1:31415';
const POLL_INTERVAL = 5000; // 5 seconds

let lastStatus = { active: false, daemonOnline: false };

async function checkStatus() {
  try {
    const response = await fetch(`${DAEMON_URL}/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    lastStatus = await response.json();
    lastStatus.daemonOnline = true;
    console.log('[Claude Blocker BG] Daemon status:', lastStatus);
  } catch (e) {
    // Daemon offline - default to blocking
    console.log('[Claude Blocker BG] Daemon error:', e.message);
    lastStatus = {
      active: false,
      daemonOnline: false,
      error: e.message,
    };
  }

  // Broadcast status to all YouTube tabs
  const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
  console.log('[Claude Blocker BG] Broadcasting to', tabs.length, 'YouTube tabs');
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'STATUS_UPDATE',
        status: lastStatus,
      });
    } catch (e) {
      // Tab might not have content script loaded yet
    }
  }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse(lastStatus);
  }
  return true;
});

// Start polling
setInterval(checkStatus, POLL_INTERVAL);
checkStatus(); // Initial check
