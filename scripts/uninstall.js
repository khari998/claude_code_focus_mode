#!/usr/bin/env node

/**
 * Claude Code Focus Mode - Cross-Platform Uninstaller
 *
 * This script can be run via curl:
 *   curl -fsSL https://raw.githubusercontent.com/khari998/claude_code_focus/main/scripts/uninstall.js | node
 *
 * Works on macOS, Linux, and Windows.
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
    launchAgent: path.join(HOME, 'Library', 'LaunchAgents', 'com.claude.productivity-daemon.plist'),
  },
  linux: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
    systemdService: path.join(HOME, '.config', 'systemd', 'user', 'claude-focus-daemon.service'),
  },
  win32: {
    claude: path.join(HOME, '.claude'),
    productivity: path.join(HOME, '.claude', 'productivity'),
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

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
  return false;
}

function removeFile(file) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

function stopDaemonMacOS() {
  try {
    execSync(`launchctl unload "${paths.launchAgent}" 2>/dev/null || true`, { stdio: 'pipe' });
  } catch (e) {}

  if (removeFile(paths.launchAgent)) {
    log('   LaunchAgent removed');
  } else {
    log('   LaunchAgent not found');
  }
}

function stopDaemonLinux() {
  try {
    execSync('systemctl --user stop claude-focus-daemon 2>/dev/null || true', { stdio: 'pipe' });
    execSync('systemctl --user disable claude-focus-daemon 2>/dev/null || true', { stdio: 'pipe' });
  } catch (e) {}

  if (removeFile(paths.systemdService)) {
    log('   systemd service removed');
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    } catch (e) {}
  } else {
    log('   systemd service not found');
  }
}

function stopDaemonWindows() {
  // Kill running daemon
  try {
    execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq claude-focus*" 2>nul', {
      stdio: 'pipe',
      shell: true
    });
  } catch (e) {}

  if (removeFile(paths.startupScript)) {
    log('   Startup script removed');
  } else {
    log('   Startup script not found');
  }
}

function stopDaemon() {
  log('Stopping daemon...');

  switch (PLATFORM) {
    case 'darwin':
      stopDaemonMacOS();
      break;
    case 'linux':
      stopDaemonLinux();
      break;
    case 'win32':
      stopDaemonWindows();
      break;
  }
}

function removeHookFromSettings() {
  log('Removing Claude Code hook...');

  const settingsPath = path.join(paths.claude, 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    log('   settings.json not found');
    return;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    if (settings.hooks && settings.hooks.PostToolUse) {
      const originalLength = settings.hooks.PostToolUse.length;

      settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h =>
        !(h.hooks && h.hooks.some(hh => hh.command && hh.command.includes('record-activity.js')))
      );

      if (settings.hooks.PostToolUse.length === 0) {
        delete settings.hooks.PostToolUse;
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      if (settings.hooks?.PostToolUse?.length !== originalLength) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        log('   Hook removed from settings.json');
      } else {
        log('   Hook not found in settings.json');
      }
    } else {
      log('   No hooks found in settings.json');
    }
  } catch (e) {
    log('   Could not modify settings.json: ' + e.message);
  }
}

function main() {
  console.log('');
  console.log('Uninstalling Claude Code Focus Mode...');
  console.log(`   Platform: ${PLATFORM}`);
  console.log('');

  // Stop and remove daemon
  stopDaemon();

  // Remove productivity directory
  log('Removing files...');
  if (removeDir(paths.productivity)) {
    log(`   Removed ${paths.productivity}`);
  } else {
    log('   Productivity directory not found');
  }

  // Remove hook from settings
  removeHookFromSettings();

  console.log('');
  console.log('============================================================');
  console.log('Uninstallation complete!');
  console.log('============================================================');
  console.log('');
  console.log('Don\'t forget to:');
  console.log('1. Remove the browser extension from your extensions page');
  console.log('2. Restart Claude Code to apply settings changes');
  console.log('');
}

main();
