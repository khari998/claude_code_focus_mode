#!/usr/bin/env node

/**
 * Record Claude Code activity timestamps
 * Called by PostToolUse hook to track when Claude is actively working
 *
 * After updating the activity file, notifies the daemon to broadcast
 * the update to all connected WebSocket clients for instant updates.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ACTIVITY_FILE = path.join(__dirname, '..', 'activity.json');
const DAEMON_URL = 'http://127.0.0.1:31415/notify';

async function main() {
  // Read hook input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch (e) {
    // If no valid JSON, still record activity
    hookData = {};
  }

  const sessionId = hookData.session_id || 'unknown';
  const toolName = hookData.tool_name || 'unknown';
  const timestamp = Date.now();

  // Read existing activity data
  let activityData = { sessions: {} };
  try {
    const existing = fs.readFileSync(ACTIVITY_FILE, 'utf-8');
    activityData = JSON.parse(existing);
  } catch (e) {
    // File doesn't exist or invalid JSON, start fresh
  }

  // Update session activity
  activityData.sessions[sessionId] = {
    lastActivity: timestamp,
    lastTool: toolName,
  };

  // Track most recent activity across all sessions
  activityData.lastActivity = timestamp;
  activityData.lastTool = toolName;
  activityData.activeSession = sessionId;

  // Clean up old sessions (older than 1 hour)
  const ONE_HOUR = 60 * 60 * 1000;
  for (const [sid, session] of Object.entries(activityData.sessions)) {
    if (timestamp - session.lastActivity > ONE_HOUR) {
      delete activityData.sessions[sid];
    }
  }

  // Atomic write using temp file
  const tempFile = `${ACTIVITY_FILE}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(activityData, null, 2));
    fs.renameSync(tempFile, ACTIVITY_FILE);
  } catch (e) {
    // Clean up temp file on error
    try {
      fs.unlinkSync(tempFile);
    } catch {}
    console.error('Failed to write activity:', e.message);
    process.exit(1);
  }

  // Notify daemon to broadcast update to connected WebSocket clients
  notifyDaemon();
}

/**
 * Notify the daemon to broadcast status update to all WebSocket clients.
 * This is fire-and-forget - we don't wait for the response.
 */
function notifyDaemon() {
  const req = http.request(DAEMON_URL, {
    method: 'POST',
    timeout: 1000,
  });

  req.on('error', () => {
    // Daemon might not be running - that's okay, extension will poll
  });

  req.end();
}

main().catch(console.error);
