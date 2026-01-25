/**
 * Claude Code Focus Mode - Onboarding Page
 * Guides users through setup and detects when daemon is running
 */

const DAEMON_URL = 'http://127.0.0.1:31415';
const POLL_INTERVAL = 2000;

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
 * Check if daemon is running
 */
async function checkDaemon() {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (response.ok) {
      onConnected();
      return true;
    }
  } catch (e) {
    // Daemon not running
  }

  return false;
}

/**
 * Called when daemon connection is established
 */
function onConnected() {
  if (isConnected) return;
  isConnected = true;

  // Update status indicator
  statusIndicator.classList.add('connected');
  statusIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
  statusText.textContent = 'Extension connected!';

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

// Start polling for daemon
checkDaemon().then(connected => {
  if (!connected) {
    pollInterval = setInterval(checkDaemon, POLL_INTERVAL);
  }
});
