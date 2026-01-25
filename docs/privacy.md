# Privacy Policy

**Claude Code Focus Mode**
*Last updated: January 2025*

## Overview

Claude Code Focus Mode is a browser extension that helps you stay focused by blocking distracting websites while Claude Code is inactive. This privacy policy explains what data the extension accesses and how it's used.

## Data Collection

**We do not collect, store, or transmit any personal data.**

The extension operates entirely locally on your device. No data is ever sent to external servers, analytics services, or third parties.

## Local Data Usage

The extension uses the following data locally on your device:

### Browser Storage (`chrome.storage.sync`)
- **Blocked site list**: Which websites you've enabled for blocking
- **Timeout setting**: Your configured inactivity timeout (1-10 minutes)
- **Extension enabled state**: Whether the extension is turned on or off

This data syncs across your Chrome browsers if you're signed into Chrome, using Chrome's built-in sync feature. We have no access to this data.

### Local Daemon Communication
- The extension communicates with a local daemon running on `127.0.0.1:31415` (localhost only)
- This daemon tracks Claude Code activity by monitoring tool usage timestamps
- All communication stays on your local machine - nothing is sent externally

### Tab Access
- The extension checks if your current tab matches a blocked site
- This is done locally to determine whether to show the blocking overlay
- No browsing history or tab data is collected or stored

## Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| `tabs` | Check if current site should be blocked |
| `storage` | Save your site list and timeout settings |
| `scripting` | Inject the blocking overlay on matched sites |
| `alarms` | Periodic status checks when WebSocket disconnects |
| `host_permissions` | Access blocked sites to show overlay, and localhost for daemon |

## Third-Party Services

This extension does not use any third-party services, analytics, tracking, or external APIs.

## Data Security

- All data stays on your local machine
- Communication with the daemon uses localhost only (127.0.0.1)
- No network requests are made to external servers
- No cookies, fingerprinting, or tracking of any kind

## Open Source

This extension is open source. You can review the complete source code at:
[https://github.com/khari998/claude_code_focus](https://github.com/khari998/claude_code_focus)

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository.

---

**Summary**: This extension runs 100% locally. We collect nothing. Your data never leaves your device.
