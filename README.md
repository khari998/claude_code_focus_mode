<p align="center">
  <img src="extension/icon.svg" alt="Claude Code Focus Mode" width="80" height="80">
</p>

# Claude Code Focus Mode

Pause distracting sites unless Claude Code is actively working. Configure which sites to pause and how long before the pause kicks in.

## Features

- **Configurable Sites**: Pause YouTube, Twitter, Reddit, Facebook, Instagram, TikTok, Twitch, Netflix, or add custom domains
- **Adjustable Timeout**: Set how long before sites get paused  
- **Media Pause/Resume**: Automatically pauses video/audio when paused, resumes when unpaused
- **Global Toggle**: Quickly enable/disable pausing without changing site settings
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
3. **Extension**: Polls the daemon and shows/hides a pausing overlay on enabled sites

## Requirements

- [Claude Code](https://claude.ai/code) must be installed first
- Node.js (v18+)
- Chrome, Arc, Brave, Edge, or any Chromium-based browser

---

## Installation

### Option 1: Chrome Web Store (End Users)

For users who just want to use the extension:

1. **Install the extension** from the Chrome Web Store *(link coming soon)*

2. **Run the setup command** shown on the onboarding page:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/khari998/claude_code_focus_mode/main/scripts/install.js | node
   ```

3. **Restart Claude Code** to activate the hook

The extension will automatically detect when the daemon is running.

---

### Option 2: Local Development (Contributors & Forkers)

For developers who want to contribute or customize the extension:

#### 1. Clone the repository

```bash
git clone https://github.com/khari998/claude_code_focus_mode.git
cd claude_code_focus_mode
```

#### 2. Run the installer with --dev flag

```bash
node scripts/install.js --dev
```

This will:
- Download and install the daemon files
- Copy the extension files to `~/.claude/productivity/extension/`
- Set up the Claude Code hook
- Start the daemon with auto-start on boot

#### 3. Load the extension in your browser

**Chrome:**
1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select `~/.claude/productivity/extension`

**Arc:**
1. Go to `arc://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `~/.claude/productivity/extension`

**Brave:**
1. Go to `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `~/.claude/productivity/extension`

**Edge:**
1. Go to `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `~/.claude/productivity/extension`

#### 4. Restart Claude Code

Restart Claude Code to activate the hook.

---

### Development Workflow

When making changes to the extension:

1. Edit files in the `extension/` folder in your cloned repo
2. Re-run `node scripts/install.js --dev` to copy updated files
3. Go to your browser's extensions page and click the refresh icon on the extension
4. Test your changes

Alternatively, you can load the extension directly from the repo folder instead of the productivity folder to skip the copy step.

---

## Configuration

Click the extension icon in your browser toolbar to open the settings popup.

### Pause After
Set how many minutes of Claude inactivity before sites get paused (1-10 minutes, default 2).

### Paused Sites
Toggle which sites are paused:
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
Use the toggle in the header to quickly enable/disable all pausing without changing your site settings.

## Usage

1. Open a paused site → Pausing overlay appears, media pauses
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
curl -fsSL https://raw.githubusercontent.com/khari998/claude_code_focus_mode/main/scripts/uninstall.js | node
```

Then remove the browser extension from your extensions page.

## Troubleshooting

### Extension shows "Daemon offline"
1. Run the install command: `curl -fsSL https://raw.githubusercontent.com/khari998/claude_code_focus_mode/main/scripts/install.js | node`
2. Check daemon status: `curl http://127.0.0.1:31415/health`
3. Check logs in `~/.claude/productivity/daemon/logs/`

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
Restart daemon:
```bash
# macOS
launchctl unload ~/Library/LaunchAgents/com.claude.productivity-daemon.plist
launchctl load ~/Library/LaunchAgents/com.claude.productivity-daemon.plist

# Linux
systemctl --user restart claude-focus-daemon

# Windows - restart via Task Manager or reboot
```

## Contributing

1. Fork the repository
2. Clone your fork
3. Run `node scripts/install.js --dev`
4. Make your changes
5. Test locally
6. Submit a pull request

## License

MIT
