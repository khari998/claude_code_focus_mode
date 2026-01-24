/**
 * Claude Code Focus - Content Script
 * Injects blocking overlay on configured sites when Claude is inactive
 */

(function() {
  // Prevent multiple injections
  if (window.__claudeFocusContent) return;
  window.__claudeFocusContent = true;

  const OVERLAY_ID = 'claude-focus-overlay';
  let currentTimeout = 2; // Default 2 minutes

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

    console.log('[Claude Focus] Creating overlay');

    // Start pausing media
    media.startMediaWatcher();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div class="claude-overlay-content">
        <div class="claude-overlay-icon">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <h1 class="claude-overlay-title">Focus Mode Active</h1>
        <p class="claude-overlay-message">This site is blocked while Claude Code is not working.</p>
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
      console.log('[Claude Focus] Removing overlay');

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
    console.log('[Claude Focus] Status update:', status);

    if (status.timeout) {
      currentTimeout = status.timeout;
    }

    if (status.active) {
      removeOverlay();
    } else {
      createOverlay();
      updateOverlayStatus(status);
    }
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STATUS_UPDATE') {
      handleStatus(message.status);
    }

    if (message.type === 'INIT') {
      if (message.timeout) currentTimeout = message.timeout;
      handleStatus(message.status);
    }

    return true;
  });

  // Request initial status from background
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    console.log('[Claude Focus] Initial status:', response);
    if (response) {
      handleStatus(response);
    } else {
      // No response - default to blocking
      handleStatus({ active: false, daemonOnline: false });
    }
  });

  // Create overlay immediately (fail-safe blocking)
  console.log('[Claude Focus] Content script loaded on:', window.location.href);
  createOverlay();
})();
