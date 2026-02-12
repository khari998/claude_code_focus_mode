/**
 * Claude Code Focus Mode - Popup Settings Script
 */

const DAEMON_URL = 'http://127.0.0.1:31415';

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

const SITE_ICONS = {
  youtube: '<i class="fa-brands fa-youtube" style="color: #ff0000"></i>',
  twitter: '<i class="fa-brands fa-x-twitter" style="color: #faf9f5"></i>',
  reddit: '<i class="fa-brands fa-reddit-alien" style="color: #ff4500"></i>',
  facebook: '<i class="fa-brands fa-facebook-f" style="color: #1877f2"></i>',
  instagram: '<i class="fa-brands fa-instagram" style="color: #e4405f"></i>',
  tiktok: '<i class="fa-brands fa-tiktok" style="color: #faf9f5"></i>',
  twitch: '<i class="fa-brands fa-twitch" style="color: #9146ff"></i>',
  netflix: '<i class="fa-solid fa-n" style="color: #e50914"></i>',
};

let settings = {
  enabled: true,
  timeout: 2,
  sites: [...DEFAULT_SITES],
};

// DOM Elements
const globalToggle = document.getElementById('global-toggle');
const timeoutInput = document.getElementById('timeout-input');
const sitesList = document.getElementById('sites-list');
const addSiteBtn = document.getElementById('add-site-btn');
const addSiteForm = document.getElementById('add-site-form');
const customSiteInput = document.getElementById('custom-site-input');
const cancelAddSite = document.getElementById('cancel-add-site');
const confirmAddSite = document.getElementById('confirm-add-site');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const popupContainer = document.querySelector('.popup-container');
const updateBanner = document.getElementById('update-banner');
const updateVersions = document.getElementById('update-versions');
const updateBtn = document.getElementById('update-btn');

const EXTENSION_VERSION = chrome.runtime.getManifest().version;

// Load settings from storage
async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(['enabled', 'timeout', 'sites']);

    if (stored.enabled !== undefined) settings.enabled = stored.enabled;
    if (stored.timeout !== undefined) settings.timeout = stored.timeout;
    if (stored.sites !== undefined) {
      // Merge with defaults to ensure new built-in sites are included
      const storedIds = new Set(stored.sites.map(s => s.id));
      const mergedSites = [...stored.sites];

      for (const defaultSite of DEFAULT_SITES) {
        if (!storedIds.has(defaultSite.id)) {
          mergedSites.push(defaultSite);
        }
      }

      settings.sites = mergedSites;
    }

    updateUI();
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

// Save settings to storage
async function saveSettings() {
  try {
    await chrome.storage.sync.set({
      enabled: settings.enabled,
      timeout: settings.timeout,
      sites: settings.sites,
    });

    // Notify background script (don't wait for response)
    chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED', settings }).catch(() => {
      // Ignore - popup may close before background responds
    });
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Update UI from settings
function updateUI() {
  // Global toggle
  globalToggle.checked = settings.enabled;
  popupContainer.classList.toggle('disabled', !settings.enabled);

  // Timeout input
  timeoutInput.value = settings.timeout;

  // Sites list
  renderSites();
}

// Render sites list
function renderSites() {
  sitesList.innerHTML = '';

  for (const site of settings.sites) {
    const siteEl = document.createElement('div');
    siteEl.className = `site-item${site.builtin ? '' : ' custom'}`;

    // For custom sites, put remove button in icon position
    const iconHtml = site.builtin
      ? `<span class="site-icon">${SITE_ICONS[site.id] || site.name.charAt(0).toUpperCase()}</span>`
      : `<button class="site-icon remove-site" data-id="${site.id}"><i class="fa-solid fa-xmark"></i></button>`;

    siteEl.innerHTML = `
      <div class="site-info">
        ${iconHtml}
        <span class="site-name">${site.name}</span>
      </div>
      <label class="toggle-switch small">
        <input type="checkbox" data-site-id="${site.id}" ${site.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    `;

    sitesList.appendChild(siteEl);
  }

  // Add event listeners for toggles
  sitesList.querySelectorAll('input[data-site-id]').forEach(input => {
    input.addEventListener('change', (e) => {
      const siteId = e.target.dataset.siteId;
      const site = settings.sites.find(s => s.id === siteId);
      if (site) {
        site.enabled = e.target.checked;
        saveSettings();
      }
    });
  });

  // Add event listeners for remove buttons
  sitesList.querySelectorAll('.remove-site').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const button = e.currentTarget;
      const siteId = button.dataset.id;
      const siteItem = button.closest('.site-item');

      // Animate out
      siteItem.classList.add('removing');

      // Remove after animation completes
      setTimeout(() => {
        settings.sites = settings.sites.filter(s => s.id !== siteId);
        saveSettings();
        renderSites();
      }, 350);
    });
  });
}

// Check daemon status
async function checkStatus() {
  try {
    const response = await fetch(`${DAEMON_URL}/status`);
    const status = await response.json();

    if (status.active) {
      const elapsed = Math.round(status.elapsed / 1000);
      statusDot.className = 'status-dot active';
      statusText.textContent = `Active (${elapsed}s ago)`;
    } else {
      const elapsed = status.elapsed ? Math.round(status.elapsed / 1000) : null;
      statusDot.className = 'status-dot inactive';
      statusText.textContent = elapsed ? `Inactive (${elapsed}s ago)` : 'Inactive';
    }

    // Check daemon version
    checkDaemonVersion();
  } catch (e) {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Daemon offline';
    updateBanner.style.display = 'none';
  }
}

// Compare two version strings, returns true if a < b
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

// Check if daemon version is older than extension version
async function checkDaemonVersion() {
  try {
    const response = await fetch(`${DAEMON_URL}/health`);
    const health = await response.json();
    const daemonVersion = health.version;

    if (!daemonVersion || versionLessThan(daemonVersion, EXTENSION_VERSION)) {
      updateVersions.textContent = daemonVersion
        ? `v${daemonVersion} → v${EXTENSION_VERSION}`
        : `pre-1.6 → v${EXTENSION_VERSION}`;
      updateBanner.style.display = 'flex';
    } else {
      updateBanner.style.display = 'none';
    }
  } catch (e) {
    // Daemon offline — don't show version banner (offline status shown instead)
    updateBanner.style.display = 'none';
  }
}

// Show error message on input
function showInputError(message) {
  customSiteInput.style.borderColor = '#ef4444';
  let errorEl = document.querySelector('.input-error');
  if (!errorEl) {
    errorEl = document.createElement('span');
    errorEl.className = 'input-error';
    customSiteInput.parentNode.insertBefore(errorEl, customSiteInput.nextSibling);
  }
  errorEl.textContent = message;
}

// Clear error message
function clearInputError() {
  customSiteInput.style.borderColor = '';
  const errorEl = document.querySelector('.input-error');
  if (errorEl) errorEl.remove();
}

// Add custom site
function addCustomSite() {
  const domain = customSiteInput.value.trim().toLowerCase();

  if (!domain) return;

  // Validate domain format - just needs a dot with characters on both sides
  const dotIndex = domain.indexOf('.');
  if (dotIndex < 1 || dotIndex === domain.length - 1 || domain.includes(' ')) {
    showInputError('Enter a valid domain (e.g. example.com)');
    return;
  }

  // Check for duplicates
  const exists = settings.sites.some(s =>
    s.patterns.some(p => p.includes(domain))
  );

  if (exists) {
    showInputError('This site is already in the list');
    return;
  }

  // Add new site
  const newSite = {
    id: `custom-${Date.now()}`,
    name: domain,
    patterns: [`*://*.${domain}/*`, `*://${domain}/*`],
    enabled: true,
    builtin: false,
  };

  settings.sites.push(newSite);
  saveSettings();
  renderSites();

  // Reset form
  customSiteInput.value = '';
  clearInputError();
  addSiteForm.classList.add('hidden');
  addSiteBtn.classList.remove('hidden');
}

// Event Listeners
globalToggle.addEventListener('change', () => {
  settings.enabled = globalToggle.checked;
  popupContainer.classList.toggle('disabled', !settings.enabled);
  saveSettings();
});

timeoutInput.addEventListener('input', () => {
  const value = parseInt(timeoutInput.value);
  if (!isNaN(value) && value >= 0) {
    settings.timeout = value;
  }
});

timeoutInput.addEventListener('change', () => {
  let value = parseInt(timeoutInput.value);
  if (isNaN(value) || value < 0) value = 0;
  timeoutInput.value = value;
  settings.timeout = value;
  saveSettings();
});

addSiteBtn.addEventListener('click', () => {
  addSiteBtn.classList.add('hidden');
  addSiteForm.classList.remove('hidden');
  customSiteInput.focus();
});

cancelAddSite.addEventListener('click', () => {
  addSiteForm.classList.add('hidden');
  addSiteBtn.classList.remove('hidden');
  customSiteInput.value = '';
  clearInputError();
});

confirmAddSite.addEventListener('click', addCustomSite);

customSiteInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addCustomSite();
});

customSiteInput.addEventListener('input', () => {
  clearInputError();
});

updateBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html?update=true') });
});

// Initialize
loadSettings();
checkStatus();
setInterval(checkStatus, 5000);
