# Claude Code Focus

Block distracting sites unless Claude Code is actively working. Configure which sites to block and how long before the block kicks in.

## Features

- **Configurable Sites**: Block YouTube, Twitter, Reddit, Twitch, Netflix, TikTok, or add custom domains
- **Adjustable Timeout**: Set how long before sites get blocked (1-10 minutes)
- **Media Pause/Resume**: Automatically pauses video/audio when blocked, resumes when unblocked
- **Global Toggle**: Quickly enable/disable blocking without changing site settings
- **Status Indicator**: See Claude activity status in the extension popup

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
Browser Extension → Shows/hides overlay on configured sites
```

1. **Hook**: Every time Claude Code uses a tool, it records the timestamp
2. **Daemon**: A background service checks if activity happened within your configured timeout
3. **Extension**: Polls the daemon and shows/hides a blocking overlay on enabled sites

## Requirements

- macOS (uses LaunchAgent for daemon auto-start)
- Node.js (v18+)
- Claude Code CLI
- Chrome, Arc, Brave, Edge, or any Chromium-based browser

## Installation

### Quick Install

```bash
git clone https://github.com/khari998/claude_code_focus.git
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

3. **Create LaunchAgent** (see `scripts/install.sh` for the full plist content)

4. **Start the daemon:**
   ```bash
   launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist
   ```

5. **Load the browser extension** (see below)

6. **Restart Claude Code** to activate the hook

### Loading the Browser Extension

#### Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Navigate to `~/.claude/productivity/extension` (press Cmd+Shift+G and paste the path)
5. Click **Select**

#### Arc
1. Go to `arc://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `~/.claude/productivity/extension`

#### Brave
1. Go to `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `~/.claude/productivity/extension`

#### Edge
1. Go to `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `~/.claude/productivity/extension`

## Configuration

Click the extension icon in your browser toolbar to open the settings popup.

### Timeout
Set how many minutes of Claude inactivity before sites get blocked (1-10 minutes, default 2).

### Blocked Sites
Toggle which sites are blocked:
- **YouTube** (enabled by default)
- **Twitter/X**
- **Reddit**
- **Twitch**
- **Netflix**
- **TikTok**

### Custom Sites
Click **+ Add Custom Site** to add any domain (e.g., `instagram.com`).

### Global Toggle
Use the toggle in the header to quickly enable/disable all blocking without changing your site settings.

## Usage

1. Open a blocked site → Blocking overlay appears, media pauses
2. Use any Claude Code tool → Overlay disappears, media resumes
3. Wait until timeout expires → Overlay returns, media pauses

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

## Troubleshooting

### Extension popup not opening
- Make sure you loaded the extension from `~/.claude/productivity/extension` (not the repo folder)
- Try removing and re-adding the extension

### Overlay not appearing on a site
1. Check the extension popup - is the site enabled?
2. Check if global toggle is ON
3. Look for `[Claude Focus]` logs in browser console (Cmd+Option+J)
4. Reload the page

### Hook not triggering
1. Restart Claude Code after modifying settings.json
2. Verify hook in settings: `cat ~/.claude/settings.json`
3. Check activity file updates: `cat ~/.claude/productivity/activity.json`

### Daemon not running
1. Check status: `curl http://127.0.0.1:31415/health`
2. Check logs: `cat ~/.claude/productivity/daemon/logs/stderr.log`
3. Restart daemon:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.claude.productivity-daemon.plist
   launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist
   ```

### Settings not saving
- Check if you have Chrome sync enabled (settings use `chrome.storage.sync`)
- Try clearing extension data and reconfiguring

## License

MIT
