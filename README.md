# Claude Code Focus Mode

Block distracting sites unless Claude Code is actively working. Configure which sites to block and how long before the block kicks in.

## Features

- **Configurable Sites**: Block YouTube, Twitter, Reddit, Facebook, Instagram, TikTok, Twitch, Netflix, or add custom domains
- **Adjustable Timeout**: Set how long before sites get blocked (1-10 minutes)
- **Media Pause/Resume**: Automatically pauses video/audio when blocked, resumes when unblocked
- **Global Toggle**: Quickly enable/disable blocking without changing site settings
- **Status Indicator**: See Claude activity status in the extension popup
- **Cross-Platform**: Works on macOS, Linux, and Windows

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

- Node.js (v18+)
- Claude Code CLI
- Chrome, Arc, Brave, Edge, or any Chromium-based browser

## Installation

### Quick Install

```bash
git clone https://github.com/khari998/claude_code_focus.git
cd claude_code_focus
node scripts/install.js
```

The installer automatically:
- Creates the productivity directory structure
- Copies daemon and extension files
- Sets up auto-start (LaunchAgent on macOS, systemd on Linux, Startup script on Windows)
- Configures the Claude Code hook

### After Installation

1. **Restart Claude Code** to activate the hook

2. **Load the browser extension:**
   - Open your browser's extension page (see below)
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select `~/.claude/productivity/extension`

### Loading the Browser Extension

#### Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Navigate to `~/.claude/productivity/extension` (press Cmd+Shift+G / Ctrl+Shift+G and paste the path)
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

### Pause After
Set how many minutes of Claude inactivity before sites get blocked (1-10 minutes, default 2).

### Blocked Sites
Toggle which sites are blocked:
- **YouTube** (enabled by default)
- **Twitter/X**
- **Reddit**
- **Facebook**
- **Instagram**
- **TikTok**
- **Twitch**
- **Netflix**

### Custom Sites
Click **+ Add Custom Site** to add any domain (e.g., `hulu.com`).

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
# macOS/Linux
tail -f ~/.claude/productivity/daemon/logs/stderr.log

# Windows
type %USERPROFILE%\.claude\productivity\daemon\logs\stderr.log
```

## Uninstallation

```bash
node scripts/uninstall.js
```

Don't forget to also remove the browser extension from your extensions page.

## Troubleshooting

### Extension popup not opening
- Make sure you loaded the extension from `~/.claude/productivity/extension` (not the repo folder)
- Try removing and re-adding the extension

### Overlay not appearing on a site
1. Check the extension popup - is the site enabled?
2. Check if global toggle is ON
3. Look for `[Claude Focus]` logs in browser console (Cmd+Option+J / Ctrl+Shift+J)
4. Reload the page

### Hook not triggering
1. Restart Claude Code after installation
2. Verify hook in settings: `cat ~/.claude/settings.json`
3. Check activity file updates: `cat ~/.claude/productivity/activity.json`

### Daemon not running
1. Check status: `curl http://127.0.0.1:31415/health`
2. Check logs in `~/.claude/productivity/daemon/logs/`
3. Restart daemon:
   ```bash
   # macOS
   launchctl unload ~/Library/LaunchAgents/com.claude.productivity-daemon.plist
   launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist

   # Linux
   systemctl --user restart claude-focus-daemon

   # Windows - restart via Task Manager or reboot
   ```

### Settings not saving
- Check if you have Chrome sync enabled (settings use `chrome.storage.sync`)
- Try clearing extension data and reconfiguring

## License

MIT
