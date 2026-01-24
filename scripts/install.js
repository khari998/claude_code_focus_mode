#!/usr/bin/env node

/**
 * Claude Code Focus Mode - Cross-Platform Installer
 *
 * This script is designed to be run via curl:
 *   curl -fsSL https://raw.githubusercontent.com/khari998/claude_code_focus/main/scripts/install.js | node
 *
 * It downloads the daemon files from GitHub and sets up everything needed
 * for the browser extension to communicate with Claude Code.
 *
 * Works on macOS, Linux, and Windows.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const PLATFORM = process.platform;
const HOME = os.homedir();

// GitHub raw URLs for daemon files
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/khari998/claude_code_focus/main';
const DAEMON_FILES = [
  { name: 'server.js', url: `${GITHUB_RAW_BASE}/daemon/server.js` },
  { name: 'record-activity.js', url: `${GITHUB_RAW_BASE}/daemon/record-activity.js` },
];

// Platform-specific paths
const PATHS = {
  darwin: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
    daemon: path.join(HOME, '.claude', 'productivity', 'daemon'),
    logs: path.join(HOME, '.claude', 'productivity', 'daemon', 'logs'),
    launchAgent: path.join(HOME, 'Library', 'LaunchAgents', 'com.claude.productivity-daemon.plist'),
  },
  linux: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
    daemon: path.join(HOME, '.claude', 'productivity', 'daemon'),
    logs: path.join(HOME, '.claude', 'productivity', 'daemon', 'logs'),
    systemdUser: path.join(HOME, '.config', 'systemd', 'user'),
    systemdService: path.join(HOME, '.config', 'systemd', 'user', 'claude-focus-daemon.service'),
  },
  win32: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
    daemon: path.join(HOME, '.claude', 'productivity', 'daemon'),
    logs: path.join(HOME, '.claude', 'productivity', 'daemon', 'logs'),
    startupFolder: path.join(HOME, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    startupScript: path.join(HOME, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'claude-focus-daemon.vbs'),
  },
};

const paths = PATHS[PLATFORM];
if (!paths) {
  console.error(`Unsupported platform: ${PLATFORM}`);
  process.exit(1);
}

function log(msg) {
  console.log(msg);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Download a file from a URL
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/**
 * Download all daemon files from GitHub
 */
async function downloadDaemonFiles() {
  log('Downloading daemon files from GitHub...');

  for (const file of DAEMON_FILES) {
    const destPath = path.join(paths.daemon, file.name);
    try {
      await downloadFile(file.url, destPath);
      log(`   Downloaded ${file.name}`);
    } catch (e) {
      throw new Error(`Failed to download ${file.name}: ${e.message}`);
    }
  }
}

// Platform-specific daemon setup
function setupDaemonMacOS() {
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.productivity-daemon</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>source ~/.nvm/nvm.sh 2>/dev/null || true; node ~/.claude/productivity/daemon/server.js</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${paths.logs}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${paths.logs}/stderr.log</string>

    <key>WorkingDirectory</key>
    <string>${paths.daemon}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>`;

  ensureDir(path.dirname(paths.launchAgent));
  fs.writeFileSync(paths.launchAgent, plistContent);

  try {
    execSync(`launchctl unload "${paths.launchAgent}" 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`launchctl load "${paths.launchAgent}"`, { stdio: 'pipe' });
    log('   LaunchAgent installed and started');
  } catch (e) {
    log('   Could not start daemon automatically. Run manually:');
    log(`      launchctl load "${paths.launchAgent}"`);
  }
}

function setupDaemonLinux() {
  const serviceContent = `[Unit]
Description=Claude Code Focus Mode Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node ${paths.daemon}/server.js
Restart=always
RestartSec=5
WorkingDirectory=${paths.daemon}
StandardOutput=append:${paths.logs}/stdout.log
StandardError=append:${paths.logs}/stderr.log

[Install]
WantedBy=default.target
`;

  ensureDir(paths.systemdUser);
  fs.writeFileSync(paths.systemdService, serviceContent);

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    execSync('systemctl --user enable claude-focus-daemon', { stdio: 'pipe' });
    execSync('systemctl --user start claude-focus-daemon', { stdio: 'pipe' });
    log('   systemd user service installed and started');
  } catch (e) {
    log('   Could not start daemon automatically. Run manually:');
    log('      systemctl --user start claude-focus-daemon');
  }
}

function setupDaemonWindows() {
  // Create a VBScript to run Node silently at startup
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node ""${paths.daemon.replace(/\\/g, '\\\\')}\\server.js""", 0, False
`;

  ensureDir(paths.startupFolder);
  fs.writeFileSync(paths.startupScript, vbsContent);

  // Also start it now
  try {
    execSync(`start /B node "${paths.daemon}\\server.js"`, {
      stdio: 'pipe',
      shell: true,
      windowsHide: true
    });
    log('   Startup script installed and daemon started');
  } catch (e) {
    log('   Could not start daemon automatically.');
    log(`      Start manually: node "${paths.daemon}\\server.js"`);
  }
}

function setupDaemon() {
  log('Setting up daemon auto-start...');

  switch (PLATFORM) {
    case 'darwin':
      setupDaemonMacOS();
      break;
    case 'linux':
      setupDaemonLinux();
      break;
    case 'win32':
      setupDaemonWindows();
      break;
  }
}

function updateClaudeSettings() {
  log('Configuring Claude Code hook...');

  const settingsPath = path.join(paths.claude, 'settings.json');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      log('   Could not parse existing settings.json, creating new one');
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  // Check if hook already exists
  const hookExists = settings.hooks.PostToolUse.some(h =>
    h.hooks && h.hooks.some(hh => hh.command && hh.command.includes('record-activity.js'))
  );

  if (!hookExists) {
    settings.hooks.PostToolUse.push({
      matcher: '*',
      hooks: [{
        type: 'command',
        command: 'node ~/.claude/productivity/daemon/record-activity.js'
      }]
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    log('   Hook added to settings.json');
  } else {
    log('   Hook already exists in settings.json');
  }
}

function verifyDaemon() {
  log('Verifying daemon...');

  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        const http = require('http');
        const req = http.get('http://127.0.0.1:31415/health', (res) => {
          if (res.statusCode === 200) {
            log('   Daemon is running!');
          } else {
            log('   Daemon responded but with unexpected status');
          }
          resolve();
        });
        req.on('error', () => {
          log('   Daemon not responding yet. It may take a moment to start.');
          log('      Check logs at: ' + paths.logs);
          resolve();
        });
        req.setTimeout(2000, () => {
          req.destroy();
          log('   Daemon connection timed out');
          resolve();
        });
      } catch (e) {
        log('   Could not verify daemon');
        resolve();
      }
    }, 2000);
  });
}

async function main() {
  console.log('');
  console.log('Installing Claude Code Focus Mode...');
  console.log(`   Platform: ${PLATFORM}`);
  console.log('');

  // Create directories
  log('Creating directories...');
  ensureDir(paths.productivity);
  ensureDir(paths.daemon);
  ensureDir(paths.logs);

  // Download daemon files from GitHub
  await downloadDaemonFiles();

  // Update Claude settings
  updateClaudeSettings();

  // Setup daemon auto-start
  setupDaemon();

  // Verify daemon is running
  await verifyDaemon();

  console.log('');
  console.log('============================================================');
  console.log('Installation complete!');
  console.log('============================================================');
  console.log('');
  console.log('Next step:');
  console.log('');
  console.log('   RESTART Claude Code to activate the hook');
  console.log('');
  console.log('The browser extension will detect the daemon automatically.');
  console.log('');
  console.log('Daemon status: curl http://127.0.0.1:31415/status');
  console.log('');
}

main().catch(e => {
  console.error('Installation failed:', e.message);
  process.exit(1);
});
