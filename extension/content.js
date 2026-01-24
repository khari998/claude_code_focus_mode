/**
 * Content script for Claude Productivity Blocker
 * Injects blocking overlay on YouTube when Claude is inactive
 */

const OVERLAY_ID = 'claude-productivity-overlay';
let videoPausedByUs = false;
let videoPauseInterval = null;

function getYouTubeVideo() {
  // Main video player
  return document.querySelector('video.html5-main-video') || document.querySelector('video');
}

function pauseVideo() {
  const video = getYouTubeVideo();
  if (video && !video.paused) {
    video.pause();
    videoPausedByUs = true;
    console.log('[Claude Blocker] Video paused');
  }
}

function resumeVideo() {
  if (videoPausedByUs) {
    const video = getYouTubeVideo();
    if (video && video.paused) {
      video.play().catch(() => {
        // Autoplay might be blocked, ignore
      });
      console.log('[Claude Blocker] Video resumed');
    }
    videoPausedByUs = false;
  }
}

// Keep trying to pause video until it's found and paused
function startVideoPauseWatcher() {
  if (videoPauseInterval) return;

  // Try immediately
  pauseVideo();

  // Keep checking every 500ms for new videos
  videoPauseInterval = setInterval(() => {
    const video = getYouTubeVideo();
    if (video && !video.paused && !videoPausedByUs) {
      pauseVideo();
    }
  }, 500);
}

function stopVideoPauseWatcher() {
  if (videoPauseInterval) {
    clearInterval(videoPauseInterval);
    videoPauseInterval = null;
  }
}

function createOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;

  console.log('[Claude Blocker] Creating overlay');

  // Start watching for videos to pause
  startVideoPauseWatcher();

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
      <p class="claude-overlay-message">YouTube is blocked while Claude Code is not working.</p>
      <div class="claude-overlay-status">
        <span class="claude-status-dot"></span>
        <span class="claude-status-text">Waiting for Claude activity...</span>
      </div>
      <p class="claude-overlay-hint">Use any Claude Code tool to unblock for 2 minutes</p>
    </div>
  `;

  // Insert at start of body or document
  if (document.body) {
    document.body.insertBefore(overlay, document.body.firstChild);
  } else {
    document.documentElement.appendChild(overlay);
  }
}

function removeOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    console.log('[Claude Blocker] Removing overlay');
    stopVideoPauseWatcher();
    overlay.classList.add('claude-overlay-hiding');
    setTimeout(() => {
      overlay.remove();
      // Resume video after overlay is gone
      resumeVideo();
    }, 300);
  }
}

function updateOverlayStatus(status) {
  const statusText = document.querySelector('.claude-status-text');
  const statusDot = document.querySelector('.claude-status-dot');

  if (!statusText || !statusDot) return;

  if (!status.daemonOnline) {
    statusText.textContent = 'Daemon offline - blocking by default';
    statusDot.classList.add('claude-status-offline');
    statusDot.classList.remove('claude-status-active', 'claude-status-inactive');
  } else if (status.active) {
    const elapsed = Math.round(status.elapsed / 1000);
    statusText.textContent = `Claude active (${elapsed}s ago)`;
    statusDot.classList.add('claude-status-active');
    statusDot.classList.remove('claude-status-inactive', 'claude-status-offline');
  } else {
    const elapsed = status.elapsed ? Math.round(status.elapsed / 1000) : 'N/A';
    statusText.textContent = `Claude inactive (${elapsed}s since last activity)`;
    statusDot.classList.add('claude-status-inactive');
    statusDot.classList.remove('claude-status-active', 'claude-status-offline');
  }
}

function handleStatus(status) {
  console.log('[Claude Blocker] Status update:', status);
  if (status.active) {
    removeOverlay();
  } else {
    createOverlay();
    updateOverlayStatus(status);
  }
}

// Listen for status updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STATUS_UPDATE') {
    handleStatus(message.status);
  }
});

// Request initial status
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  console.log('[Claude Blocker] Initial status:', response);
  if (response) {
    handleStatus(response);
  } else {
    // No response means extension just loaded, default to blocking
    handleStatus({ active: false, daemonOnline: false });
  }
});

// Create overlay immediately (fail-safe blocking)
console.log('[Claude Blocker] Content script loaded on:', window.location.href);
createOverlay();
