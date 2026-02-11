/**
 * Claude Code Focus Mode - Content Script
 *
 * Uses an explicit FocusStateMachine to manage overlay and media state.
 * All external status sources (background messages, direct daemon polling)
 * funnel through a single transition() method with a queue, preventing
 * race conditions between concurrent updates.
 *
 * States:
 *   ACTIVE   – Claude is active, no overlay, media plays normally
 *   INACTIVE – Claude is inactive (or daemon offline), overlay shown, media paused
 *   DISABLED – Extension toggled off (or site disabled), no overlay
 */

(function() {
  const DEBUG = false;

  // Unique ID per injection to detect stale instances
  const SCRIPT_ID = chrome.runtime.id + '_' + Date.now();

  // Guard against duplicate injection
  if (window.__claudeFocusContent) {
    try {
      chrome.runtime.id; // Throws if context invalidated
      return; // Already running with valid context
    } catch (e) {
      // Old context invalidated — clean up and continue
      const old = document.getElementById('claude-focus-overlay');
      if (old) old.remove();
    }
  }
  window.__claudeFocusContent = SCRIPT_ID;

  const OVERLAY_ID = 'claude-focus-overlay';
  const DAEMON_URL = 'http://127.0.0.1:31415';
  const POLL_INTERVAL_MS = 3000;

  // Media controller (injected before this script)
  const media = window.__claudeFocusMedia || {
    pauseAllMedia: () => 0,
    resumeOurPausedMedia: () => 0,
    startMediaWatcher: () => {},
    stopMediaWatcher: () => {},
  };

  // ─── FocusStateMachine ─────────────────────────────────────────────

  const State = Object.freeze({
    ACTIVE:   'ACTIVE',
    INACTIVE: 'INACTIVE',
    DISABLED: 'DISABLED',
  });

  class FocusStateMachine {
    constructor() {
      // Start in ACTIVE — the transition to INACTIVE/DISABLED will happen
      // once we get the first status update from the background script.
      this._state = State.ACTIVE;
      this._transitioning = false;
      this._pendingTransition = null; // { state, data } — only latest queued
      this._timeout = 2; // minutes
      this._statusData = null; // last received status payload
      this._pollTimer = null;
      this._elapsedTimer = null;
    }

    /** Current state (read-only) */
    get state() { return this._state; }

    /** Configured timeout in minutes */
    get timeout() { return this._timeout; }
    set timeout(val) { this._timeout = val; }

    /**
     * Request a state transition. All external status sources call this.
     * If a transition is already in progress, the request is queued (latest wins).
     */
    transition(newState, statusData) {
      if (DEBUG) console.log(`[FSM] transition requested: ${this._state} → ${newState}`);

      if (this._transitioning) {
        // Queue it — only keep the latest request
        this._pendingTransition = { state: newState, data: statusData };
        return;
      }

      this._executeTransition(newState, statusData);
    }

    /**
     * Internal: execute a transition synchronously with lock.
     */
    async _executeTransition(newState, statusData) {
      if (newState === this._state) {
        // Same state — just update status data (e.g. new elapsed time)
        if (statusData) this._statusData = statusData;
        this._updateOverlayStatus();
        // Re-pause any media that started playing (e.g. after SPA navigation
        // added a new video element while we're already INACTIVE)
        if (this._state === State.INACTIVE) {
          media.pauseAllMedia();
        }
        return;
      }

      this._transitioning = true;
      const prevState = this._state;
      this._state = newState;
      if (statusData) this._statusData = statusData;
      if (statusData?.timeout) this._timeout = statusData.timeout;

      try {
        // Execute the appropriate enter-state handler
        switch (newState) {
          case State.INACTIVE:
            this._enterInactive(prevState);
            break;
          case State.ACTIVE:
            await this._enterActive(prevState);
            break;
          case State.DISABLED:
            await this._enterDisabled(prevState);
            break;
        }
      } finally {
        this._transitioning = false;

        // Process queued transition (if any)
        if (this._pendingTransition) {
          const { state, data } = this._pendingTransition;
          this._pendingTransition = null;
          this._executeTransition(state, data);
        }
      }
    }

    /**
     * Enter INACTIVE state: pause media immediately, show overlay.
     */
    _enterInactive(prevState) {
      if (DEBUG) console.log('[FSM] entering INACTIVE');

      // Pause media FIRST — before any DOM work
      media.startMediaWatcher();

      // Show overlay
      this._createOverlay();
      this._updateOverlayStatus();
      this._startElapsedTimer();
      this._startPolling();
    }

    /**
     * Enter ACTIVE state: stop media watcher, fade out overlay, then resume media.
     * The fade is cosmetic — state is already ACTIVE when this starts.
     */
    async _enterActive(prevState) {
      if (DEBUG) console.log('[FSM] entering ACTIVE');

      // Stop media watcher (no new pauses)
      media.stopMediaWatcher();
      this._stopElapsedTimer();
      this._stopPolling();

      // Fade out overlay (cosmetic)
      await this._fadeOutOverlay();

      // Resume media AFTER overlay is gone
      media.resumeOurPausedMedia();
    }

    /**
     * Enter DISABLED state: remove overlay, stop media watcher, resume media.
     */
    async _enterDisabled(prevState) {
      if (DEBUG) console.log('[FSM] entering DISABLED');

      media.stopMediaWatcher();
      this._stopElapsedTimer();
      this._stopPolling();

      await this._fadeOutOverlay();
      media.resumeOurPausedMedia();
    }

    // ─── Overlay management ────────────────────────────────────────

    _createOverlay() {
      if (document.getElementById(OVERLAY_ID)) return;

      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      const iconUrl = chrome.runtime.getURL('icon.svg');
      const t = this._timeout;
      overlay.innerHTML = `
        <div class="claude-overlay-content">
          <div class="claude-overlay-icon">
            <img src="${iconUrl}" width="80" height="80" alt="Focus Mode">
          </div>
          <h1 class="claude-overlay-title">Focus Mode Active</h1>
          <p class="claude-overlay-message">This site is paused while Claude Code is not active.</p>
          <div class="claude-overlay-status">
            <span class="claude-status-dot"></span>
            <span class="claude-status-text">Waiting for Claude activity...</span>
          </div>
          <p class="claude-overlay-hint">Use any Claude Code tool to unblock for ${t} minute${t !== 1 ? 's' : ''}</p>
        </div>
      `;

      if (document.body) {
        document.body.insertBefore(overlay, document.body.firstChild);
      } else {
        document.documentElement.appendChild(overlay);
      }
    }

    /**
     * Animate overlay out and remove from DOM.
     * Returns a promise that resolves when the element is gone.
     */
    _fadeOutOverlay() {
      return new Promise((resolve) => {
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) { resolve(); return; }

        // If already hiding (e.g. previous transition started fade), skip animation
        if (overlay.classList.contains('claude-overlay-hiding')) {
          overlay.remove();
          resolve();
          return;
        }

        overlay.classList.add('claude-overlay-hiding');
        setTimeout(() => {
          overlay.remove();
          resolve();
        }, 300);
      });
    }

    _updateOverlayStatus() {
      const status = this._statusData;
      if (!status) return;

      const statusText = document.querySelector('.claude-status-text');
      const statusDot = document.querySelector('.claude-status-dot');
      const hint = document.querySelector('.claude-overlay-hint');

      if (hint) {
        const t = this._timeout;
        hint.textContent = `Use any Claude Code tool to unblock for ${t} minute${t !== 1 ? 's' : ''}`;
      }

      if (!statusText || !statusDot) return;

      if (!status.daemonOnline) {
        statusText.textContent = 'Daemon offline - blocking by default';
        statusDot.className = 'claude-status-dot claude-status-offline';
      } else if (status.active) {
        const elapsed = Math.round(status.elapsed / 1000);
        statusText.textContent = `Claude active (${elapsed}s ago)`;
        statusDot.className = 'claude-status-dot claude-status-active';
      } else {
        const elapsed = status.elapsed ? Math.round(status.elapsed / 1000) : 'N/A';
        statusText.textContent = `Claude inactive (${elapsed}s since last activity)`;
        statusDot.className = 'claude-status-dot claude-status-inactive';
      }
    }

    // ─── Elapsed timer (updates overlay text every second) ─────────

    _startElapsedTimer() {
      this._stopElapsedTimer();
      this._elapsedTimer = setInterval(() => {
        if (this._state !== State.INACTIVE) return;
        if (!this._statusData?.lastActivity) return;

        const elapsed = Date.now() - this._statusData.lastActivity;
        const elapsedSeconds = Math.round(elapsed / 1000);

        const statusText = document.querySelector('.claude-status-text');
        if (statusText) {
          if (this._statusData.daemonOnline === false) {
            statusText.textContent = 'Daemon offline - blocking by default';
          } else {
            statusText.textContent = `Claude inactive (${elapsedSeconds}s since last activity)`;
          }
        }

        // NOTE: We do NOT call transition() or removeOverlay() here.
        // State changes are driven by external status updates only.
      }, 1000);
    }

    _stopElapsedTimer() {
      if (this._elapsedTimer) {
        clearInterval(this._elapsedTimer);
        this._elapsedTimer = null;
      }
    }

    // ─── Unified polling (single source, replaces 4+ overlapping) ──

    _startPolling() {
      this._stopPolling();
      this._pollTimer = setInterval(() => {
        this._pollDaemon();
      }, POLL_INTERVAL_MS);
    }

    _stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    }

    /**
     * Direct daemon poll — used as a fallback when the MV3 service worker
     * dies and stops forwarding WebSocket updates.
     */
    _pollDaemon() {
      fetch(`${DAEMON_URL}/status`)
        .then(r => r.json())
        .then(data => {
          const elapsed = data.lastActivity ? Date.now() - data.lastActivity : Infinity;
          const timeoutMs = this._timeout * 60 * 1000;
          const active = elapsed < timeoutMs;

          const newState = active ? State.ACTIVE : State.INACTIVE;
          this.transition(newState, {
            active,
            daemonOnline: true,
            lastActivity: data.lastActivity,
            elapsed,
            timeout: this._timeout,
          });
        })
        .catch(() => {
          // Daemon unreachable — stay in current state
        });
    }

    /**
     * Handle a raw status payload from any source (background message, init, poll).
     * Converts it to the appropriate state and calls transition().
     */
    handleStatusUpdate(status) {
      if (status.timeout) this._timeout = status.timeout;

      // Extension or site disabled
      if (status.disabled) {
        this.transition(State.DISABLED, status);
        return;
      }

      // Active vs inactive
      if (status.active) {
        this.transition(State.ACTIVE, status);
      } else {
        this.transition(State.INACTIVE, status);
      }
    }

    /**
     * Clean up all timers (used when extension context is invalidated).
     */
    destroy() {
      this._stopElapsedTimer();
      this._stopPolling();
      media.stopMediaWatcher();
    }
  }

  // ─── Instantiate and wire up ─────────────────────────────────────

  const fsm = new FocusStateMachine();

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STATUS_UPDATE' || message.type === 'INIT') {
      if (message.timeout) fsm.timeout = message.timeout;
      fsm.handleStatusUpdate(message.status);
      sendResponse({ received: true });
      return true;
    }
    return false;
  });

  // Request initial status from background
  let initialStatusReceived = false;

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      initialStatusReceived = true;
      fsm.handleStatusUpdate({ active: false, daemonOnline: false });
      return;
    }
    initialStatusReceived = true;
    if (response) {
      fsm.handleStatusUpdate(response);
    } else {
      fsm.handleStatusUpdate({ active: false, daemonOnline: false });
    }
  });

  // Fail-safe: if no response within 500ms, assume inactive
  setTimeout(() => {
    if (!initialStatusReceived) {
      fsm.handleStatusUpdate({ active: false, daemonOnline: false });
    }
  }, 500);

  // Periodic background ping — keeps the service worker alive and gets fresh status.
  // This is the ONLY recurring message to the background; all other polling is
  // direct-to-daemon and gated behind the INACTIVE state.
  const bgPing = setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
            clearInterval(bgPing);
            fsm.destroy();
            return;
          }
          return;
        }
        if (response) {
          fsm.handleStatusUpdate(response);
        }
      });
    } catch (e) {
      clearInterval(bgPing);
      fsm.destroy();
    }
  }, 5000);
})();
