#!/bin/bash

# Claude Code Focus - Uninstallation Script

set -e

CLAUDE_DIR="$HOME/.claude"
PRODUCTIVITY_DIR="$CLAUDE_DIR/productivity"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$LAUNCH_AGENTS_DIR/com.claude.productivity-daemon.plist"

echo "🗑️  Uninstalling Claude Code Focus..."

# Stop and unload LaunchAgent
echo "⏹️  Stopping daemon..."
if [ -f "$PLIST_FILE" ]; then
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    rm "$PLIST_FILE"
    echo "   LaunchAgent removed"
else
    echo "   LaunchAgent not found"
fi

# Remove productivity directory
echo "📁 Removing files..."
if [ -d "$PRODUCTIVITY_DIR" ]; then
    rm -rf "$PRODUCTIVITY_DIR"
    echo "   Removed $PRODUCTIVITY_DIR"
else
    echo "   Directory not found"
fi

# Remove hook from settings.json
echo "🔧 Removing hook from Claude Code settings..."
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

if [ -f "$SETTINGS_FILE" ]; then
    node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));

if (settings.hooks && settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h =>
        !(h.hooks && h.hooks.some(hh => hh.command && hh.command.includes('record-activity.js')))
    );
    if (settings.hooks.PostToolUse.length === 0) {
        delete settings.hooks.PostToolUse;
    }
    if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
    }
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
    console.log('   Hook removed from settings.json');
} else {
    console.log('   No hook found in settings.json');
}
" 2>/dev/null || echo "   Could not modify settings.json"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Uninstallation complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Don't forget to:"
echo "1. Remove the browser extension from chrome://extensions"
echo "2. Restart Claude Code to apply settings changes"
echo ""
