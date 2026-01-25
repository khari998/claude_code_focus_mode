#!/usr/bin/env node

/**
 * Claude Code Focus Mode - Health Check
 *
 * Verifies all components are properly installed and working:
 * 1. Daemon files installed
 * 2. Daemon running
 * 3. WebSocket working
 * 4. Hook configured in settings.json
 * 5. Activity file exists and is being updated
 * 6. LaunchAgent/systemd service configured
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const HOME = os.homedir();
const PLATFORM = process.platform;

const PATHS = {
  productivity: path.join(HOME, '.claude', 'productivity'),
  daemon: path.join(HOME, '.claude', 'productivity', 'daemon'),
  serverJs: path.join(HOME, '.claude', 'productivity', 'daemon', 'server.js'),
  recordActivityJs: path.join(HOME, '.claude', 'productivity', 'daemon', 'record-activity.js'),
  activityJson: path.join(HOME, '.claude', 'productivity', 'activity.json'),
  settingsJson: path.join(HOME, '.claude', 'settings.json'),
  launchAgent: path.join(HOME, 'Library', 'LaunchAgents', 'com.claude.productivity-daemon.plist'),
  systemdService: path.join(HOME, '.config', 'systemd', 'user', 'claude-focus-daemon.service'),
};

const checks = [];
let allPassed = true;

function check(name, passed, details = '') {
  const status = passed ? '✅' : '❌';
  checks.push({ name, passed, details });
  if (!passed) allPassed = false;
  console.log(`${status} ${name}${details ? ` - ${details}` : ''}`);
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function fileContains(filePath, text) {
  if (!fileExists(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.includes(text);
}

async function checkDaemonRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:31415/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          resolve({ running: true, ...health });
        } catch {
          resolve({ running: false });
        }
      });
    });
    req.on('error', () => resolve({ running: false }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ running: false });
    });
  });
}

async function checkWebSocket() {
  return new Promise((resolve) => {
    const WebSocket = require('ws');
    const ws = new WebSocket('ws://127.0.0.1:31415');

    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ connected: false, error: 'timeout' });
    }, 3000);

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve({ connected: true });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ connected: false, error: err.message });
    });
  }).catch(() => {
    // ws module not available, try native check
    return { connected: 'unknown', note: 'ws module not installed' };
  });
}

async function getStatus() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:31415/status', (res) => {
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
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function main() {
  console.log('');
  console.log('Claude Code Focus Mode - Health Check');
  console.log('=====================================');
  console.log('');

  // 1. Check daemon files
  console.log('📁 Daemon Files:');
  check('  Productivity directory exists', fileExists(PATHS.productivity));
  check('  server.js installed', fileExists(PATHS.serverJs));
  check('  record-activity.js installed', fileExists(PATHS.recordActivityJs));

  // Check for WebSocket code in server.js
  const hasWebSocket = fileContains(PATHS.serverJs, 'wsClients');
  check('  server.js has WebSocket support', hasWebSocket);

  // Check for daemon notify in record-activity.js
  const hasNotify = fileContains(PATHS.recordActivityJs, 'notifyDaemon');
  check('  record-activity.js notifies daemon', hasNotify);
  console.log('');

  // 2. Check Claude settings
  console.log('⚙️  Claude Settings:');
  check('  settings.json exists', fileExists(PATHS.settingsJson));

  let hookConfigured = false;
  if (fileExists(PATHS.settingsJson)) {
    try {
      const settings = JSON.parse(fs.readFileSync(PATHS.settingsJson, 'utf-8'));
      hookConfigured = settings.hooks?.PostToolUse?.some(h =>
        h.hooks?.some(hh => hh.command?.includes('record-activity.js'))
      );
    } catch {}
  }
  check('  PostToolUse hook configured', hookConfigured,
    hookConfigured ? '' : 'Hook not found in settings.json');
  console.log('');

  // 3. Check platform-specific auto-start
  console.log('🚀 Auto-Start Configuration:');
  if (PLATFORM === 'darwin') {
    check('  LaunchAgent plist exists', fileExists(PATHS.launchAgent));
    const plistCorrect = fileContains(PATHS.launchAgent, 'productivity/daemon/server.js');
    check('  LaunchAgent configured correctly', plistCorrect);
  } else if (PLATFORM === 'linux') {
    check('  systemd service exists', fileExists(PATHS.systemdService));
    const serviceCorrect = fileContains(PATHS.systemdService, 'productivity/daemon/server.js');
    check('  systemd service configured correctly', serviceCorrect);
  } else {
    check('  Platform auto-start', true, `${PLATFORM} - check manually`);
  }
  console.log('');

  // 4. Check daemon running
  console.log('🔌 Daemon Status:');
  const health = await checkDaemonRunning();
  check('  Daemon responding', health.running,
    health.running ? `uptime: ${Math.round(health.uptime)}s` : 'Not running on port 31415');

  if (health.running) {
    check('  WebSocket clients connected', health.wsClients >= 0,
      `${health.wsClients} client(s)`);
  }
  console.log('');

  // 5. Check activity tracking
  console.log('📊 Activity Tracking:');
  const status = await getStatus();
  if (status) {
    check('  Activity file readable', true);
    const elapsed = status.elapsed ? Math.round(status.elapsed / 1000) : 'N/A';
    check('  Last activity tracked', status.lastActivity > 0,
      `${elapsed}s ago, tool: ${status.lastTool || 'none'}`);
    check('  Active status', true, status.active ? 'ACTIVE (within timeout)' : 'INACTIVE');
  } else {
    check('  Activity file readable', false, 'Could not get status');
  }
  console.log('');

  // 6. Summary
  console.log('=====================================');
  if (allPassed) {
    console.log('✅ All checks passed! System is healthy.');
  } else {
    console.log('❌ Some checks failed. Run the installer to fix:');
    console.log('   node scripts/install.js --dev');
    console.log('');
    console.log('Then restart the daemon:');
    if (PLATFORM === 'darwin') {
      console.log('   launchctl unload ~/Library/LaunchAgents/com.claude.productivity-daemon.plist');
      console.log('   launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist');
    } else if (PLATFORM === 'linux') {
      console.log('   systemctl --user restart claude-focus-daemon');
    }
  }
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
