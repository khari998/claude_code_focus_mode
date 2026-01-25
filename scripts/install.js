#!/usr/bin/env node

/**
 * Claude Code Focus Mode - Cross-Platform Installer
 *
 * Usage:
 *   From Chrome Web Store (extension already installed):
 *     curl -fsSL https://raw.githubusercontent.com/khari998/claude_code_focus/main/scripts/install.js | node
 *
 *   For local development (side-loading extension):
 *     node scripts/install.js --dev
 *
 * The --dev flag copies extension files for side-loading in the browser.
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
const IS_DEV_MODE = process.argv.includes('--dev');

// GitHub raw URLs for daemon files
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/khari998/claude_code_focus/main';
const DAEMON_FILES = [
  { name: 'server.js', url: `${GITHUB_RAW_BASE}/daemon/server.js` },
  { name: 'record-activity.js', url: `${GITHUB_RAW_BASE}/daemon/record-activity.js` },
];

const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'media-controller.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'styles.css',
  'onboarding.html',
  'onboarding.js',
  'onboarding.css',
  'icon16.png',
  'icon48.png',
  'icon128.png',
];

// Platform-specific paths
const PATHS = {
  darwin: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
    daemon: path.join(HOME, '.claude', 'productivity', 'daemon'),
    logs: path.join(HOME, '.claude', 'productivity', 'daemon', 'logs'),
    extension: path.join(HOME, '.claude', 'productivity', 'extension'),
    launchAgent: path.join(HOME, 'Library', 'LaunchAgents', 'com.claude.productivity-daemon.plist'),
  },
  linux: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
    daemon: path.join(HOME, '.claude', 'productivity', 'daemon'),
    logs: path.join(HOME, '.claude', 'productivity', 'daemon', 'logs'),
    extension: path.join(HOME, '.claude', 'productivity', 'extension'),
    systemdUser: path.join(HOME, '.config', 'systemd', 'user'),
    systemdService: path.join(HOME, '.config', 'systemd', 'user', 'claude-focus-daemon.service'),
  },
  win32: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
    daemon: path.join(HOME, '.claude', 'productivity', 'daemon'),
    logs: path.join(HOME, '.claude', 'productivity', 'daemon', 'logs'),
    extension: path.join(HOME, '.claude', 'productivity', 'extension'),
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

/**
 * Download all extension files from GitHub (for --dev mode)
 */
async function downloadExtensionFiles() {
  log('Downloading extension files from GitHub...');
  ensureDir(paths.extension);

  for (const fileName of EXTENSION_FILES) {
    const url = `${GITHUB_RAW_BASE}/extension/${fileName}`;
    const destPath = path.join(paths.extension, fileName);
    try {
      await downloadFile(url, destPath);
      log(`   Downloaded ${fileName}`);
    } catch (e) {
      throw new Error(`Failed to download ${fileName}: ${e.message}`);
    }
  }
}

/**
 * Copy extension files from local repo (for --dev mode when run from repo)
 */
function copyExtensionFilesFromRepo() {
  // Try to find the repo's extension folder
  const scriptDir = __dirname;
  const repoDir = path.dirname(scriptDir);
  const repoExtension = path.join(repoDir, 'extension');

  if (fs.existsSync(repoExtension)) {
    log('Copying extension files from local repo...');
    ensureDir(paths.extension);

    const files = fs.readdirSync(repoExtension);
    for (const file of files) {
      const srcPath = path.join(repoExtension, file);
      const destPath = path.join(paths.extension, file);

      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, destPath);
        log(`   Copied ${file}`);
      }
    }
    return true;
  }
  return false;
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

/**
 * Comprehensive verification of all installed components
 */
async function verifyInstallation() {
  log('');
  log('Verifying installation...');
  log('');

  const checks = [];
  let allPassed = true;

  function check(name, passed, details = '') {
    const status = passed ? '✅' : '❌';
    checks.push({ name, passed, details });
    if (!passed) allPassed = false;
    log(`${status} ${name}${details ? ` (${details})` : ''}`);
  }

  // 1. Check daemon files
  check('server.js installed', fs.existsSync(path.join(paths.daemon, 'server.js')));
  check('record-activity.js installed', fs.existsSync(path.join(paths.daemon, 'record-activity.js')));

  // Check server.js has WebSocket support
  const serverContent = fs.existsSync(path.join(paths.daemon, 'server.js'))
    ? fs.readFileSync(path.join(paths.daemon, 'server.js'), 'utf-8')
    : '';
  check('WebSocket support in server.js', serverContent.includes('wsClients'));

  // Check record-activity.js notifies daemon
  const recordContent = fs.existsSync(path.join(paths.daemon, 'record-activity.js'))
    ? fs.readFileSync(path.join(paths.daemon, 'record-activity.js'), 'utf-8')
    : '';
  check('Daemon notify in record-activity.js', recordContent.includes('notifyDaemon'));

  // 2. Check Claude settings hook
  const settingsPath = path.join(paths.claude, 'settings.json');
  let hookConfigured = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      hookConfigured = settings.hooks?.PostToolUse?.some(h =>
        h.hooks?.some(hh => hh.command?.includes('record-activity.js'))
      );
    } catch {}
  }
  check('PostToolUse hook configured', hookConfigured);

  // 3. Check platform-specific auto-start
  if (PLATFORM === 'darwin') {
    check('LaunchAgent installed', fs.existsSync(paths.launchAgent));
    const plistContent = fs.existsSync(paths.launchAgent)
      ? fs.readFileSync(paths.launchAgent, 'utf-8')
      : '';
    check('LaunchAgent configured correctly', plistContent.includes('productivity/daemon/server.js'));
  } else if (PLATFORM === 'linux') {
    check('systemd service installed', fs.existsSync(paths.systemdService));
  } else if (PLATFORM === 'win32') {
    check('Startup script installed', fs.existsSync(paths.startupScript));
  }

  // 4. Check if extension files exist (dev mode only)
  if (IS_DEV_MODE) {
    const manifestExists = fs.existsSync(path.join(paths.extension, 'manifest.json'));
    check('Extension files copied', manifestExists);
  }

  // 5. Check daemon is responding
  const daemonHealth = await new Promise((resolve) => {
    setTimeout(() => {
      const http = require('http');
      const req = http.get('http://127.0.0.1:31415/health', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(null);
      });
    }, 2000); // Wait 2 seconds for daemon to start
  });

  if (daemonHealth) {
    check('Daemon running', true, `uptime: ${Math.round(daemonHealth.uptime)}s`);
    check('Daemon healthy', daemonHealth.ok === true);
  } else {
    check('Daemon running', false, 'Not responding on port 31415');
    allPassed = false;
  }

  log('');
  return allPassed;
}

async function main() {
  console.log('');
  console.log('Installing Claude Code Focus Mode...');
  console.log(`   Platform: ${PLATFORM}`);
  if (IS_DEV_MODE) {
    console.log('   Mode: Development (side-loading extension)');
  }
  console.log('');

  // Create directories
  log('Creating directories...');
  ensureDir(paths.productivity);
  ensureDir(paths.daemon);
  ensureDir(paths.logs);

  // Download daemon files from GitHub
  await downloadDaemonFiles();

  // In dev mode, also get extension files
  if (IS_DEV_MODE) {
    // Try to copy from local repo first, fall back to downloading
    if (!copyExtensionFilesFromRepo()) {
      await downloadExtensionFiles();
    }
  }

  // Update Claude settings
  updateClaudeSettings();

  // Setup daemon auto-start
  setupDaemon();

  // Verify installation
  const installSuccess = await verifyInstallation();

  console.log('============================================================');
  if (installSuccess) {
    console.log('✅ Installation successful! All checks passed.');
  } else {
    console.log('⚠️  Installation completed with warnings.');
    console.log('   Some checks failed - review the output above.');
  }
  console.log('============================================================');
  console.log('');

  if (IS_DEV_MODE) {
    console.log('Next steps:');
    console.log('');
    console.log('1. Load the browser extension:');
    console.log('   - Go to chrome://extensions (or your browser equivalent)');
    console.log('   - Enable "Developer mode"');
    console.log('   - Click "Load unpacked"');
    console.log(`   - Select: ${paths.extension}`);
    console.log('');
    console.log('2. Restart Claude Code to activate the hook');
    console.log('');
  } else {
    console.log('Next step:');
    console.log('');
    console.log('   RESTART Claude Code to activate the hook');
    console.log('');
    console.log('The browser extension will detect the daemon automatically.');
    console.log('');
  }

  console.log('Useful commands:');
  console.log('   Check status: curl http://127.0.0.1:31415/status');
  console.log('   Check health: curl http://127.0.0.1:31415/health');
  console.log('');

  if (!installSuccess) {
    console.log('Troubleshooting:');
    if (PLATFORM === 'darwin') {
      console.log('   Restart daemon: launchctl unload ~/Library/LaunchAgents/com.claude.productivity-daemon.plist && launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist');
      console.log(`   Check logs: tail -f ${paths.logs}/stderr.log`);
    } else if (PLATFORM === 'linux') {
      console.log('   Restart daemon: systemctl --user restart claude-focus-daemon');
      console.log('   Check logs: journalctl --user -u claude-focus-daemon -f');
    }
    console.log('');
  }
}

main().catch(e => {
  console.error('Installation failed:', e.message);
  process.exit(1);
});
