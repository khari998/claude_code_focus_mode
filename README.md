# Claude Code Focus

Block YouTube (and stay focused) unless Claude Code is actively working. The overlay disappears when you use any Claude Code tool and reappears after 2 minutes of inactivity.

## How It Works

```
Claude Code (any instance)
    │ PostToolUse hook
    ▼
~/.claude/productivity/activity.json  ← timestamp of last tool use
    │ read by
    ▼
Background Daemon (localhost:31415)
    │ polled by
    ▼
Browser Extension → Shows/hides overlay on YouTube
```

1. **Hook**: Every time Claude Code uses a tool, it records the timestamp
2. **Daemon**: A background service checks if activity happened within the last 2 minutes
3. **Extension**: Polls the daemon and shows/hides a blocking overlay on YouTube

## Requirements

- macOS (uses LaunchAgent for daemon auto-start)
- Node.js (v18+)
- Claude Code CLI
- Chrome, Arc, or Chromium-based browser

## Installation

### Quick Install

```bash
git clone https://github.com/YOUR_USERNAME/claude_code_focus.git
cd claude_code_focus
./scripts/install.sh
```

### Manual Installation

1. **Copy files to Claude directory:**
   ```bash
   mkdir -p ~/.claude/productivity/daemon/logs
   mkdir -p ~/.claude/productivity/extension

   cp daemon/* ~/.claude/productivity/daemon/
   cp -r extension/* ~/.claude/productivity/extension/
   ```

2. **Add the hook to `~/.claude/settings.json`:**
   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "node ~/.claude/productivity/daemon/record-activity.js"
             }
           ]
         }
       ]
     }
   }
   ```

3. **Create LaunchAgent at `~/Library/LaunchAgents/com.claude.productivity-daemon.plist`:**
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
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
       <string>/Users/YOUR_USERNAME/.claude/productivity/daemon/logs/stdout.log</string>
       <key>StandardErrorPath</key>
       <string>/Users/YOUR_USERNAME/.claude/productivity/daemon/logs/stderr.log</string>
       <key>WorkingDirectory</key>
       <string>/Users/YOUR_USERNAME/.claude/productivity/daemon</string>
   </dict>
   </plist>
   ```

4. **Start the daemon:**
   ```bash
   launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist
   ```

5. **Load the browser extension:**
   - Go to `chrome://extensions` (or `arc://extensions`)
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select `~/.claude/productivity/extension`

6. **Restart Claude Code** to activate the hook

## Usage

1. Open YouTube → Blocking overlay appears
2. Use any Claude Code tool → Overlay disappears, video resumes
3. Wait 2 minutes without using Claude → Overlay returns, video pauses

## Verification

Check daemon status:
```bash
curl http://127.0.0.1:31415/status
```

Check activity file:
```bash
cat ~/.claude/productivity/activity.json
```

Check daemon logs:
```bash
tail -f ~/.claude/productivity/daemon/logs/stderr.log
```

## Uninstallation

```bash
./scripts/uninstall.sh
```

Or manually:
1. `launchctl unload ~/Library/LaunchAgents/com.claude.productivity-daemon.plist`
2. `rm ~/Library/LaunchAgents/com.claude.productivity-daemon.plist`
3. `rm -rf ~/.claude/productivity`
4. Remove the hook from `~/.claude/settings.json`
5. Remove the extension from your browser

## Configuration

### Activity Timeout

Default is 2 minutes. To change, edit `~/.claude/productivity/daemon/server.js`:
```javascript
const ACTIVITY_TIMEOUT = 2 * 60 * 1000; // Change to desired milliseconds
```

### Blocked Sites

Currently only YouTube. To add more sites, edit the extension's `manifest.json`:
```json
"content_scripts": [{
  "matches": [
    "*://*.youtube.com/*",
    "*://*.twitter.com/*",
    "*://*.reddit.com/*"
  ],
  ...
}]
```

## Troubleshooting

### Overlay not appearing
1. Check extension is loaded: `arc://extensions`
2. Reload YouTube page
3. Check browser console for `[Claude Blocker]` logs

### Hook not triggering
1. Restart Claude Code after modifying settings.json
2. Verify hook in settings: `cat ~/.claude/settings.json`
3. Check activity file updates: `cat ~/.claude/productivity/activity.json`

### Daemon not running
1. Check status: `curl http://127.0.0.1:31415/health`
2. Check logs: `cat ~/.claude/productivity/daemon/logs/stderr.log`
3. Restart: `launchctl unload ~/Library/LaunchAgents/com.claude.productivity-daemon.plist && launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist`

## License

MIT
