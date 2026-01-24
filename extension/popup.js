/**
 * Claude Code Focus - Popup Settings Script
 */

const DAEMON_URL = 'http://127.0.0.1:31415';

const DEFAULT_SITES = [
  { id: 'youtube', name: 'YouTube', patterns: ['*://*.youtube.com/*'], enabled: true, builtin: true },
  { id: 'twitter', name: 'Twitter/X', patterns: ['*://*.twitter.com/*', '*://*.x.com/*'], enabled: false, builtin: true },
  { id: 'reddit', name: 'Reddit', patterns: ['*://*.reddit.com/*'], enabled: false, builtin: true },
  { id: 'twitch', name: 'Twitch', patterns: ['*://*.twitch.tv/*'], enabled: false, builtin: true },
  { id: 'netflix', name: 'Netflix', patterns: ['*://*.netflix.com/*'], enabled: false, builtin: true },
  { id: 'tiktok', name: 'TikTok', patterns: ['*://*.tiktok.com/*'], enabled: false, builtin: true },
];

const SITE_ICONS = {
  youtube: '▶',
  twitter: '𝕏',
  reddit: '◎',
  twitch: '◆',
  netflix: 'N',
  tiktok: '♪',
};

let settings = {
  enabled: true,
  timeout: 2,
  sites: [...DEFAULT_SITES],
};

// DOM Elements
const globalToggle = document.getElementById('global-toggle');
const timeoutSlider = document.getElementById('timeout-slider');
const timeoutDisplay = document.getElementById('timeout-display');
const sitesList = document.getElementById('sites-list');
const addSiteBtn = document.getElementById('add-site-btn');
const addSiteForm = document.getElementById('add-site-form');
const customSiteInput = document.getElementById('custom-site-input');
const cancelAddSite = document.getElementById('cancel-add-site');
const confirmAddSite = document.getElementById('confirm-add-site');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const popupContainer = document.querySelector('.popup-container');

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

    // Notify background script
    chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED', settings });
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Update UI from settings
function updateUI() {
  // Global toggle
  globalToggle.checked = settings.enabled;
  popupContainer.classList.toggle('disabled', !settings.enabled);

  // Timeout slider
  timeoutSlider.value = settings.timeout;
  timeoutDisplay.textContent = `${settings.timeout} min`;

  // Sites list
  renderSites();
}

// Render sites list
function renderSites() {
  sitesList.innerHTML = '';

  for (const site of settings.sites) {
    const siteEl = document.createElement('div');
    siteEl.className = `site-item${site.builtin ? '' : ' custom'}`;

    const icon = SITE_ICONS[site.id] || site.name.charAt(0).toUpperCase();

    siteEl.innerHTML = `
      <div class="site-info">
        <span class="site-icon">${icon}</span>
        <span class="site-name">
          ${site.name}
          ${!site.builtin ? '<button class="remove-site" data-id="' + site.id + '">×</button>' : ''}
        </span>
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
      const siteId = e.target.dataset.id;
      settings.sites = settings.sites.filter(s => s.id !== siteId);
      saveSettings();
      renderSites();
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
  } catch (e) {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Daemon offline';
  }
}

// Add custom site
function addCustomSite() {
  const domain = customSiteInput.value.trim().toLowerCase();

  if (!domain) return;

  // Validate domain format
  const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
  if (!domainRegex.test(domain)) {
    customSiteInput.style.borderColor = '#ef4444';
    return;
  }

  // Check for duplicates
  const exists = settings.sites.some(s =>
    s.patterns.some(p => p.includes(domain))
  );

  if (exists) {
    customSiteInput.style.borderColor = '#ef4444';
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
  customSiteInput.style.borderColor = '';
  addSiteForm.classList.add('hidden');
  addSiteBtn.classList.remove('hidden');
}

// Event Listeners
globalToggle.addEventListener('change', () => {
  settings.enabled = globalToggle.checked;
  popupContainer.classList.toggle('disabled', !settings.enabled);
  saveSettings();
});

timeoutSlider.addEventListener('input', () => {
  settings.timeout = parseInt(timeoutSlider.value);
  timeoutDisplay.textContent = `${settings.timeout} min`;
});

timeoutSlider.addEventListener('change', () => {
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
  customSiteInput.style.borderColor = '';
});

confirmAddSite.addEventListener('click', addCustomSite);

customSiteInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addCustomSite();
});

customSiteInput.addEventListener('input', () => {
  customSiteInput.style.borderColor = '';
});

// Initialize
loadSettings();
checkStatus();
setInterval(checkStatus, 5000);
