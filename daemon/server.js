#!/usr/bin/env node

/**
 * Productivity Daemon - HTTP + WebSocket server for browser extension
 * Serves activity status on localhost:31415
 *
 * HTTP endpoints:
 *   GET /status - Current activity status
 *   GET /health - Health check
 *   POST /notify - Called by record-activity.js to broadcast updates
 *
 * WebSocket:
 *   Connects at ws://127.0.0.1:31415
 *   Receives JSON messages: { type: 'status', ...status }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAEMON_VERSION = '1.6.2';
const PORT = 31415;
const ACTIVITY_FILE = path.join(__dirname, '..', 'activity.json');
const ACTIVITY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const VERBOSE = process.env.CLAUDE_FOCUS_VERBOSE === 'true';

// Track connected WebSocket clients
const wsClients = new Set();

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

/**
 * Broadcast status to all connected WebSocket clients
 */
function broadcastStatus() {
  const status = getActivityStatus();
  const message = JSON.stringify({ type: 'status', ...status });
  const frame = encodeWebSocketFrame(message);

  for (const client of wsClients) {
    try {
      client.write(frame);
    } catch (e) {
      wsClients.delete(client);
    }
  }

  if (VERBOSE) {
    console.log(`[WS] Broadcast to ${wsClients.size} clients:`, status.active ? 'active' : 'inactive');
  }
}

/**
 * Encode a message as a WebSocket frame
 */
function encodeWebSocketFrame(message) {
  const payload = Buffer.from(message);
  const length = payload.length;

  let frame;
  if (length < 126) {
    frame = Buffer.alloc(2 + length);
    frame[0] = 0x81; // Text frame, FIN bit set
    frame[1] = length;
    payload.copy(frame, 2);
  } else if (length < 65536) {
    frame = Buffer.alloc(4 + length);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    payload.copy(frame, 4);
  } else {
    frame = Buffer.alloc(10 + length);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
    payload.copy(frame, 10);
  }

  return frame;
}

/**
 * Handle WebSocket upgrade
 */
function handleWebSocketUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    '',
  ].join('\r\n');

  socket.write(headers);
  wsClients.add(socket);
  if (VERBOSE) console.log(`[WS] Client connected (${wsClients.size} total)`);

  // Send initial status
  const status = getActivityStatus();
  socket.write(encodeWebSocketFrame(JSON.stringify({ type: 'status', ...status })));

  // Handle close
  socket.on('close', () => {
    wsClients.delete(socket);
    if (VERBOSE) console.log(`[WS] Client disconnected (${wsClients.size} remaining)`);
  });

  socket.on('error', () => {
    wsClients.delete(socket);
  });

  // Handle incoming messages (ping/pong, close frames)
  socket.on('data', (data) => {
    if (data.length > 0) {
      const opcode = data[0] & 0x0f;
      if (opcode === 0x08) {
        // Close frame
        socket.end();
        wsClients.delete(socket);
      } else if (opcode === 0x09) {
        // Ping - respond with pong
        const pong = Buffer.from([0x8a, 0x00]);
        socket.write(pong);
      }
    }
  });
}

const server = http.createServer((req, res) => {
  // CORS headers for browser extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    res.end(JSON.stringify({ ok: true, version: DAEMON_VERSION, uptime: process.uptime(), wsClients: wsClients.size }));
    return;
  }

  // Called by record-activity.js to trigger immediate broadcast
  if (url.pathname === '/notify' && req.method === 'POST') {
    broadcastStatus();
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, clients: wsClients.size }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  if (req.headers.upgrade?.toLowerCase() === 'websocket') {
    handleWebSocketUpgrade(req, socket);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Productivity daemon running on http://127.0.0.1:${PORT}`);
  console.log(`Activity file: ${ACTIVITY_FILE}`);
  console.log(`Timeout: ${ACTIVITY_TIMEOUT_MS / 1000}s`);

  // Periodically broadcast status to all WebSocket clients
  // This ensures clients know when inactivity timeout is reached
  setInterval(() => {
    if (wsClients.size > 0) {
      broadcastStatus();
    }
  }, 5000); // Every 5 seconds
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
