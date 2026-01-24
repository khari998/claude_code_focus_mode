/**
 * Claude Code Focus - Content Script
 * Injects blocking overlay on configured sites when Claude is inactive
 */

const OVERLAY_ID = 'claude-focus-overlay';
let mediaPausedByUs = false;
let mediaPauseInterval = null;
let currentTimeout = 2; // Default 2 minutes

// Find any playing media on the page
function getPlayingMedia() {
  const videos = document.querySelectorAll('video');
  const audios = document.querySelectorAll('audio');

  for (const video of videos) {
    if (!video.paused) return video;
  }
  for (const audio of audios) {
    if (!audio.paused) return audio;
  }

  return null;
}

// Pause any playing media
function pauseMedia() {
  const media = getPlayingMedia();
  if (media) {
    media.pause();
    mediaPausedByUs = true;
    console.log('[Claude Focus] Media paused');
  }
}

// Resume media if we paused it
function resumeMedia() {
  if (mediaPausedByUs) {
    // Find paused media and resume
    const videos = document.querySelectorAll('video');
    const audios = document.querySelectorAll('audio');

    for (const video of videos) {
      if (video.paused) {
        video.play().catch(() => {});
        console.log('[Claude Focus] Video resumed');
        break;
      }
    }
    for (const audio of audios) {
      if (audio.paused) {
        audio.play().catch(() => {});
        console.log('[Claude Focus] Audio resumed');
        break;
      }
    }

    mediaPausedByUs = false;
  }
}

// Watch for media to pause
function startMediaPauseWatcher() {
  if (mediaPauseInterval) return;

  pauseMedia();

  mediaPauseInterval = setInterval(() => {
    const media = getPlayingMedia();
    if (media && !mediaPausedByUs) {
      pauseMedia();
    }
  }, 500);
}

function stopMediaPauseWatcher() {
  if (mediaPauseInterval) {
    clearInterval(mediaPauseInterval);
    mediaPauseInterval = null;
  }
}

// Create blocking overlay
function createOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;

  console.log('[Claude Focus] Creating overlay');

  startMediaPauseWatcher();

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

// Remove overlay
function removeOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    console.log('[Claude Focus] Removing overlay');
    stopMediaPauseWatcher();
    overlay.classList.add('claude-overlay-hiding');
    setTimeout(() => {
      overlay.remove();
      resumeMedia();
    }, 300);
  }
}

// Update overlay status display
function updateOverlayStatus(status) {
  const statusText = document.querySelector('.claude-status-text');
  const statusDot = document.querySelector('.claude-status-dot');
  const hint = document.querySelector('.claude-overlay-hint');

  if (hint && status.timeout) {
    currentTimeout = status.timeout;
    hint.textContent = `Use any Claude Code tool to unblock for ${currentTimeout} minute${currentTimeout !== 1 ? 's' : ''}`;
  }

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

// Handle status updates
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

// Listen for messages from background
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

// Request initial status
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  console.log('[Claude Focus] Initial status:', response);
  if (response) {
    handleStatus(response);
  } else {
    handleStatus({ active: false, daemonOnline: false });
  }
});

// Create overlay immediately (fail-safe)
console.log('[Claude Focus] Content script loaded on:', window.location.href);
createOverlay();
