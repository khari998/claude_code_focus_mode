#!/usr/bin/env node

/**
 * Productivity Daemon - HTTP server for browser extension
 * Serves activity status on localhost:31415
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 31415;
const ACTIVITY_FILE = path.join(__dirname, '..', 'activity.json');
const ACTIVITY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

function getActivityStatus() {
  try {
    const data = fs.readFileSync(ACTIVITY_FILE, 'utf-8');
    const activity = JSON.parse(data);
    const now = Date.now();
    const lastActivity = activity.lastActivity || 0;
    const elapsed = now - lastActivity;

    return {
      active: elapsed < ACTIVITY_TIMEOUT_MS,
      lastActivity: lastActivity,
      elapsed: elapsed,
      lastTool: activity.lastTool || null,
      activeSession: activity.activeSession || null,
      sessionCount: Object.keys(activity.sessions || {}).length,
    };
  } catch (e) {
    // File doesn't exist or invalid - default to inactive
    return {
      active: false,
      lastActivity: 0,
      elapsed: Infinity,
      lastTool: null,
      activeSession: null,
      sessionCount: 0,
      error: e.message,
    };
  }
}

const server = http.createServer((req, res) => {
  // CORS headers for browser extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/status') {
    const status = getActivityStatus();
    res.writeHead(200);
    res.end(JSON.stringify(status));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Productivity daemon running on http://127.0.0.1:${PORT}`);
  console.log(`Activity file: ${ACTIVITY_FILE}`);
  console.log(`Timeout: ${ACTIVITY_TIMEOUT_MS / 1000}s`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Interrupted, shutting down...');
  server.close(() => process.exit(0));
});
