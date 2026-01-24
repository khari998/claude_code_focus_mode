#!/bin/bash

# Claude Code Focus - Installation Script
# Blocks YouTube unless Claude Code is actively working

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="$HOME/.claude"
PRODUCTIVITY_DIR="$CLAUDE_DIR/productivity"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

echo "🚀 Installing Claude Code Focus..."

# Create directories
echo "📁 Creating directories..."
mkdir -p "$PRODUCTIVITY_DIR/daemon/logs"
mkdir -p "$PRODUCTIVITY_DIR/extension"
mkdir -p "$LAUNCH_AGENTS_DIR"

# Copy daemon files
echo "📋 Copying daemon files..."
cp "$REPO_DIR/daemon/server.js" "$PRODUCTIVITY_DIR/daemon/"
cp "$REPO_DIR/daemon/record-activity.js" "$PRODUCTIVITY_DIR/daemon/"
chmod +x "$PRODUCTIVITY_DIR/daemon/server.js"
chmod +x "$PRODUCTIVITY_DIR/daemon/record-activity.js"

# Copy extension files
echo "📋 Copying extension files..."
cp -r "$REPO_DIR/extension/"* "$PRODUCTIVITY_DIR/extension/"

# Create LaunchAgent plist
echo "⚙️  Creating LaunchAgent..."
cat > "$LAUNCH_AGENTS_DIR/com.claude.productivity-daemon.plist" << EOF
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
    <string>${HOME}/.claude/productivity/daemon/logs/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${HOME}/.claude/productivity/daemon/logs/stderr.log</string>

    <key>WorkingDirectory</key>
    <string>${HOME}/.claude/productivity/daemon</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

# Update Claude Code settings.json to add the hook
echo "🔧 Configuring Claude Code hook..."
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

if [ -f "$SETTINGS_FILE" ]; then
    # Check if hook already exists
    if grep -q "record-activity.js" "$SETTINGS_FILE"; then
        echo "   Hook already configured in settings.json"
    else
        # Use node to safely merge the hook into existing settings
        node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));

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
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
    console.log('   Hook added to settings.json');
} else {
    console.log('   Hook already exists in settings.json');
}
"
    fi
else
    # Create new settings file
    cat > "$SETTINGS_FILE" << 'SETTINGS'
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
SETTINGS
    echo "   Created settings.json with hook"
fi

# Load LaunchAgent
echo "🚀 Starting daemon..."
launchctl unload "$LAUNCH_AGENTS_DIR/com.claude.productivity-daemon.plist" 2>/dev/null || true
launchctl load "$LAUNCH_AGENTS_DIR/com.claude.productivity-daemon.plist"

# Verify daemon is running
sleep 2
if curl -s http://127.0.0.1:31415/health > /dev/null 2>&1; then
    echo "✅ Daemon is running!"
else
    echo "⚠️  Daemon may not be running. Check logs at:"
    echo "   $PRODUCTIVITY_DIR/daemon/logs/stderr.log"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Installation complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "1. RESTART Claude Code to activate the hook"
echo ""
echo "2. Load the browser extension:"
echo "   • Open your browser and go to: chrome://extensions (or arc://extensions)"
echo "   • Enable 'Developer mode'"
echo "   • Click 'Load unpacked'"
echo "   • Select: ~/.claude/productivity/extension"
echo ""
echo "3. Test it:"
echo "   • Open YouTube - you should see the blocking overlay"
echo "   • Use any Claude Code tool - overlay disappears"
echo "   • Wait 2 minutes - overlay returns"
echo ""
echo "Daemon status: curl http://127.0.0.1:31415/status"
echo ""
