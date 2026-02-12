/**
 * Claude Code Focus Mode - Onboarding / Update Page
 * Guides users through setup and detects when daemon is running.
 * When opened with ?update=true, handles daemon update flow instead.
 */

const DAEMON_URL = 'http://127.0.0.1:31415';
const POLL_INTERVAL = 2000;

const IS_UPDATE = new URLSearchParams(window.location.search).get('update') === 'true';
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

let pollInterval = null;
let isConnected = false;

// DOM elements
const statusSection = document.getElementById('status-section');
const statusIndicator = document.getElementById('status-indicator');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');
const setupSection = document.getElementById('setup-section');
const successSection = document.getElementById('success-section');
const copyBtn = document.getElementById('copy-btn');
const copyIcon = document.getElementById('copy-icon');
const command = document.getElementById('command');
const openSettingsBtn = document.getElementById('open-settings-btn');

/**
 * Adapt page content for update flow
 */
function setupUpdateMode() {
  document.title = 'Claude Code Focus Mode - Update';
  document.getElementById('page-title').textContent = 'Update Daemon';
  document.getElementById('page-subtitle').textContent = 'A new version of the daemon is available';
  document.getElementById('prerequisite').style.display = 'none';
  document.getElementById('setup-title').textContent = 'Update Daemon';
  document.getElementById('setup-description').textContent = 'Run this command in your terminal to update the daemon:';
  document.getElementById('success-title').textContent = 'Daemon updated!';
  document.getElementById('success-reminder').innerHTML = 'The daemon is now running <strong>v' + EXTENSION_VERSION + '</strong>. You can close this tab.';

  // Update steps for the update flow
  const steps = document.querySelectorAll('.step-text');
  if (steps.length >= 3) {
    steps[0].textContent = 'Copy and run the command above';
    steps[1].textContent = 'Wait for the daemon to restart automatically';
    steps[2].textContent = 'This page will detect the update when it\'s ready';
  }

  // Update status text
  statusText.textContent = 'Waiting for daemon update...';
}

/**
 * Check if daemon is running (and on the correct version for updates)
 */
async function checkDaemon() {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (response.ok) {
      if (IS_UPDATE) {
        const health = await response.json();
        // For updates, only succeed when daemon reports the current extension version
        if (health.version && !versionLessThan(health.version, EXTENSION_VERSION)) {
          onConnected();
          return true;
        }
        // Daemon is running but still on old version — keep polling
        return false;
      }
      onConnected();
      return true;
    }
  } catch (e) {
    // Daemon not running
  }

  return false;
}

/**
 * Compare semver strings: returns true if a < b
 */
function versionLessThan(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false;
}

/**
 * Called when daemon connection is established (and version is current for updates)
 */
function onConnected() {
  if (isConnected) return;
  isConnected = true;

  // Update status indicator
  statusIndicator.classList.add('connected');
  statusIcon.remove();
  statusText.textContent = IS_UPDATE ? 'Daemon updated!' : 'Extension connected!';

  // Hide setup, show success
  setupSection.style.display = 'none';
  successSection.style.display = 'block';

  // Stop polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // Mark onboarding as complete
  chrome.storage.local.set({ onboardingComplete: true });
}

/**
 * Show toast notification
 */
function showToast(message) {
  // Remove existing toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  // Create toast
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fa-solid fa-circle-check"></i><span>${message}</span>`;
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Remove after delay
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/**
 * Copy command to clipboard
 */
async function copyCommand() {
  try {
    await navigator.clipboard.writeText(command.textContent);

    // Visual feedback on button
    copyIcon.className = 'fa-solid fa-check';
    copyBtn.classList.add('copied');

    // Show toast
    showToast('Command copied to clipboard');

    setTimeout(() => {
      copyIcon.className = 'fa-regular fa-clipboard';
      copyBtn.classList.remove('copied');
    }, 2000);
  } catch (e) {
    console.error('Failed to copy:', e);
  }
}

/**
 * Open extension popup/settings
 */
function openSettings() {
  // Close this tab and let user use the extension popup
  window.close();
}

// Event listeners
copyBtn.addEventListener('click', copyCommand);
openSettingsBtn.addEventListener('click', openSettings);

// Configure page for update mode if needed
if (IS_UPDATE) {
  setupUpdateMode();
}

// Start polling for daemon
checkDaemon().then(connected => {
  if (!connected) {
    pollInterval = setInterval(checkDaemon, POLL_INTERVAL);
  }
});
