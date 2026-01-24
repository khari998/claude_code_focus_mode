#!/usr/bin/env node

/**
 * Claude Code Focus Mode - Cross-Platform Installer
 * Works on macOS, Linux, and Windows
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PLATFORM = process.platform;
const HOME = os.homedir();

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
  console.error(`❌ Unsupported platform: ${PLATFORM}`);
  process.exit(1);
}

const SCRIPT_DIR = __dirname;
const REPO_DIR = path.dirname(SCRIPT_DIR);

function log(msg) {
  console.log(msg);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
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
    log('   ⚠️  Could not start daemon automatically. Run manually:');
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
    log('   ⚠️  Could not start daemon automatically. Run manually:');
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
    log('   ⚠️  Could not start daemon automatically.');
    log(`      Start manually: node "${paths.daemon}\\server.js"`);
  }
}

function setupDaemon() {
  log('⚙️  Setting up daemon auto-start...');

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
  log('🔧 Configuring Claude Code hook...');

  const settingsPath = path.join(paths.claude, 'settings.json');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      log('   ⚠️  Could not parse existing settings.json, creating new one');
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
  log('🔍 Verifying daemon...');

  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        const http = require('http');
        const req = http.get('http://127.0.0.1:31415/health', (res) => {
          if (res.statusCode === 200) {
            log('   ✅ Daemon is running!');
          } else {
            log('   ⚠️  Daemon responded but with unexpected status');
          }
          resolve();
        });
        req.on('error', () => {
          log('   ⚠️  Daemon not responding yet. It may take a moment to start.');
          log('      Check logs at: ' + paths.logs);
          resolve();
        });
        req.setTimeout(2000, () => {
          req.destroy();
          log('   ⚠️  Daemon connection timed out');
          resolve();
        });
      } catch (e) {
        log('   ⚠️  Could not verify daemon');
        resolve();
      }
    }, 2000);
  });
}

async function main() {
  console.log('');
  console.log('🚀 Installing Claude Code Focus Mode...');
  console.log(`   Platform: ${PLATFORM}`);
  console.log('');

  // Create directories
  log('📁 Creating directories...');
  ensureDir(paths.productivity);
  ensureDir(paths.daemon);
  ensureDir(paths.logs);
  ensureDir(paths.extension);

  // Copy daemon files
  log('📋 Copying daemon files...');
  copyFile(path.join(REPO_DIR, 'daemon', 'server.js'), path.join(paths.daemon, 'server.js'));
  copyFile(path.join(REPO_DIR, 'daemon', 'record-activity.js'), path.join(paths.daemon, 'record-activity.js'));

  // Copy extension files
  log('📋 Copying extension files...');
  copyDir(path.join(REPO_DIR, 'extension'), paths.extension);

  // Update Claude settings
  updateClaudeSettings();

  // Setup daemon auto-start
  setupDaemon();

  // Verify daemon is running
  await verifyDaemon();

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ Installation complete!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log('1. RESTART Claude Code to activate the hook');
  console.log('');
  console.log('2. Load the browser extension:');
  console.log('   • Open your browser and go to the extensions page:');
  console.log('     - Chrome: chrome://extensions');
  console.log('     - Arc: arc://extensions');
  console.log('     - Brave: brave://extensions');
  console.log('     - Edge: edge://extensions');
  console.log('   • Enable "Developer mode"');
  console.log('   • Click "Load unpacked"');
  console.log(`   • Select: ${paths.extension}`);
  console.log('');
  console.log('3. Configure (click extension icon in toolbar):');
  console.log('   • Toggle which sites to block');
  console.log('   • Adjust the pause timeout');
  console.log('   • Add custom sites');
  console.log('');
  console.log('Daemon status: curl http://127.0.0.1:31415/status');
  console.log('');
}

main().catch(e => {
  console.error('❌ Installation failed:', e.message);
  process.exit(1);
});
