/**
 * Claude Code Focus Mode - Content Script
 * Injects blocking overlay on configured sites when Claude is inactive
 */

(function() {
  const DEBUG = false; // Set to true for verbose logging

  // Use a unique ID per extension load to detect reloads
  const SCRIPT_ID = chrome.runtime.id + '_' + Date.now();

  // Check if another instance is running with a VALID context
  if (window.__claudeFocusContent) {
    try {
      // Test if the old context is still valid
      chrome.runtime.id; // This throws if context is invalidated
      return; // Already injected with valid context
    } catch (e) {
      // Old context is invalidated, clean up and continue
      const oldOverlay = document.getElementById('claude-focus-overlay');
      if (oldOverlay) oldOverlay.remove();
    }
  }
  window.__claudeFocusContent = SCRIPT_ID;

  const OVERLAY_ID = 'claude-focus-overlay';
  let currentTimeout = 2; // Default 2 minutes
  let lastKnownStatus = null; // Track last status for elapsed timer
  let elapsedTimer = null; // Timer to update elapsed display

  // Media controller reference (injected before this script)
  const media = window.__claudeFocusMedia || {
    pauseAllMedia: () => {},
    resumeOurPausedMedia: () => {},
    startMediaWatcher: () => {},
    stopMediaWatcher: () => {},
  };

  /**
   * Create and show the blocking overlay
   */
  function createOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    // Start pausing media
    media.startMediaWatcher();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    const iconUrl = chrome.runtime.getURL('icon.svg');
    overlay.innerHTML = `
      <div class="claude-overlay-content">
        <div class="claude-overlay-icon">
          <img src="${iconUrl}" width="80" height="80" alt="Focus Mode">
        </div>
        <h1 class="claude-overlay-title">Focus Mode Active</h1>
        <p class="claude-overlay-message">This site is paused while Claude Code is not active.</p>
        <div class="claude-overlay-status">
          <span class="claude-status-dot"></span>
          <span class="claude-status-text">Waiting for Claude activity...</span>
        </div>
        <p class="claude-overlay-hint">Use any Claude Code tool to unblock for ${currentTimeout} minute${currentTimeout !== 1 ? 's' : ''}</p>
      </div>
    `;

    if (document.body) {
      document.body.insertBefore(overlay, document.body.firstChild);
    } else {
      document.documentElement.appendChild(overlay);
    }
  }

  /**
   * Remove the blocking overlay
   */
  function removeOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      // Stop media watcher
      media.stopMediaWatcher();

      // Fade out animation
      overlay.classList.add('claude-overlay-hiding');

      setTimeout(() => {
        overlay.remove();
        // Resume media after overlay is gone
        media.resumeOurPausedMedia();
      }, 300);
    }
  }

  /**
   * Start timer to update elapsed display every second
   */
  function startElapsedTimer() {
    stopElapsedTimer(); // Clear any existing timer

    elapsedTimer = setInterval(() => {
      if (lastKnownStatus && lastKnownStatus.lastActivity) {
        const now = Date.now();
        const elapsed = now - lastKnownStatus.lastActivity;
        const elapsedSeconds = Math.round(elapsed / 1000);

        const statusText = document.querySelector('.claude-status-text');
        if (statusText) {
          if (lastKnownStatus.daemonOnline === false) {
            statusText.textContent = 'Daemon offline - blocking by default';
          } else {
            statusText.textContent = `Claude inactive (${elapsedSeconds}s since last activity)`;
          }
        }

        // Check if we should now be active (in case WebSocket missed it)
        const timeoutMs = currentTimeout * 60 * 1000;
        if (elapsed < timeoutMs && document.getElementById(OVERLAY_ID)) {
          removeOverlay();
        }
      }
    }, 1000);
  }

  /**
   * Stop the elapsed timer
   */
  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  /**
   * Update the overlay's status display
   */
  function updateOverlayStatus(status) {
    const statusText = document.querySelector('.claude-status-text');
    const statusDot = document.querySelector('.claude-status-dot');
    const hint = document.querySelector('.claude-overlay-hint');

    // Update timeout display
    if (hint && status.timeout) {
      currentTimeout = status.timeout;
      hint.textContent = `Use any Claude Code tool to unblock for ${currentTimeout} minute${currentTimeout !== 1 ? 's' : ''}`;
    }

    if (!statusText || !statusDot) return;

    if (!status.daemonOnline) {
      statusText.textContent = 'Daemon offline - blocking by default';
      statusDot.className = 'claude-status-dot claude-status-offline';
    } else if (status.active) {
      const elapsed = Math.round(status.elapsed / 1000);
      statusText.textContent = `Claude active (${elapsed}s ago)`;
      statusDot.className = 'claude-status-dot claude-status-active';
    } else {
      const elapsed = status.elapsed ? Math.round(status.elapsed / 1000) : 'N/A';
      statusText.textContent = `Claude inactive (${elapsed}s since last activity)`;
      statusDot.className = 'claude-status-dot claude-status-inactive';
    }
  }

  /**
   * Handle status updates from background script
   */
  function handleStatus(status) {
    if (DEBUG) console.log('[Claude Focus] Status:', status.active ? 'active' : 'inactive');

    // Save status for elapsed timer
    lastKnownStatus = status;

    if (status.timeout) {
      currentTimeout = status.timeout;
    }

    if (status.active) {
      stopElapsedTimer();
      removeOverlay();
    } else {
      createOverlay();
      updateOverlayStatus(status);
      startElapsedTimer();
    }
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STATUS_UPDATE') {
      handleStatus(message.status);
      sendResponse({ received: true });
      return true;
    }

    if (message.type === 'INIT') {
      initialStatusReceived = true;
      if (message.timeout) currentTimeout = message.timeout;
      handleStatus(message.status);
      sendResponse({ received: true });
      return true;
    }

    return false;
  });

  let initialStatusReceived = false;

  // Request initial status from background
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      // Extension context might be invalidated or background not ready
      initialStatusReceived = true;
      handleStatus({ active: false, daemonOnline: false });
      return;
    }
    initialStatusReceived = true;
    if (response) {
      handleStatus(response);
    } else {
      handleStatus({ active: false, daemonOnline: false });
    }
  });

  // Fail-safe: if no response within 500ms, show overlay anyway
  setTimeout(() => {
    if (!initialStatusReceived) {
      handleStatus({ active: false, daemonOnline: false });
    }
  }, 500);

  // Periodically ping background to keep service worker alive
  const pingInterval = setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
            clearInterval(pingInterval);
            stopElapsedTimer();
            return;
          }
          return;
        }
        if (response) {
          handleStatus(response);
        }
      });
    } catch (e) {
      clearInterval(pingInterval);
      stopElapsedTimer();
    }
  }, 5000);
})();
