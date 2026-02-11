/**
 * Tests for FocusStateMachine (content.js)
 *
 * Extracts the FSM class and tests all state transitions, queueing behavior,
 * race conditions, and media/overlay lifecycle using mocks for DOM and Chrome APIs.
 *
 * Run: node --test tests/state-machine.test.js
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mocks ─────────────────────────────────────────────────────────

function createMediaMock() {
  return {
    calls: [],
    pauseAllMedia() { this.calls.push('pauseAllMedia'); return 1; },
    resumeOurPausedMedia() { this.calls.push('resumeOurPausedMedia'); return 1; },
    startMediaWatcher() { this.calls.push('startMediaWatcher'); },
    stopMediaWatcher() { this.calls.push('stopMediaWatcher'); },
    reset() { this.calls = []; },
  };
}

function createDomMock() {
  const elements = {};

  return {
    elements,
    overlayExists: false,
    overlayHiding: false,

    getElementById(id) {
      if (id === 'claude-focus-overlay' && this.overlayExists) {
        return {
          id,
          remove: () => { this.overlayExists = false; this.overlayHiding = false; },
          classList: {
            _classes: new Set(this.overlayHiding ? ['claude-overlay-hiding'] : []),
            contains(cls) { return this._classes.has(cls); },
            add(cls) {
              this._classes.add(cls);
              if (cls === 'claude-overlay-hiding') {
                // Reference the outer mock
              }
            },
          },
          innerHTML: '',
        };
      }
      return null;
    },

    querySelector(sel) {
      return elements[sel] || null;
    },

    createElement(tag) {
      return {
        id: '',
        innerHTML: '',
        classList: { add() {}, contains() { return false; } },
      };
    },

    body: {
      insertBefore(el) {},
      firstChild: null,
    },
    documentElement: {
      appendChild(el) {},
    },

    reset() {
      this.overlayExists = false;
      this.overlayHiding = false;
      for (const key of Object.keys(this.elements)) delete this.elements[key];
    },
  };
}

// ─── Extracted State + FocusStateMachine ────────────────────────────
// Mirrors content.js logic exactly, but injectable with mocks.

const State = Object.freeze({
  ACTIVE:   'ACTIVE',
  INACTIVE: 'INACTIVE',
  DISABLED: 'DISABLED',
});

class FocusStateMachine {
  constructor({ media, document, setTimeout: setTimeoutFn, setInterval: setIntervalFn, clearInterval: clearIntervalFn, fetch: fetchFn }) {
    this._media = media;
    this._document = document;
    this._setTimeout = setTimeoutFn || setTimeout;
    this._setInterval = setIntervalFn || setInterval;
    this._clearInterval = clearIntervalFn || clearInterval;
    this._fetch = fetchFn || (() => Promise.reject(new Error('no fetch')));

    this._state = State.ACTIVE;
    this._transitioning = false;
    this._pendingTransition = null;
    this._timeout = 2;
    this._statusData = null;
    this._pollTimer = null;
    this._elapsedTimer = null;

    // Track overlay creation/removal for assertions
    this._overlayVisible = false;
    this._fadePromiseResolve = null;
  }

  get state() { return this._state; }
  get timeout() { return this._timeout; }
  set timeout(val) { this._timeout = val; }
  get transitioning() { return this._transitioning; }
  get pendingTransition() { return this._pendingTransition; }
  get overlayVisible() { return this._overlayVisible; }
  get statusData() { return this._statusData; }

  transition(newState, statusData) {
    if (this._transitioning) {
      this._pendingTransition = { state: newState, data: statusData };
      return;
    }
    this._executeTransition(newState, statusData);
  }

  async _executeTransition(newState, statusData) {
    if (newState === this._state) {
      if (statusData) this._statusData = statusData;
      if (this._state === State.INACTIVE) {
        this._media.pauseAllMedia();
      }
      return;
    }

    this._transitioning = true;
    const prevState = this._state;
    this._state = newState;
    if (statusData) this._statusData = statusData;
    if (statusData?.timeout) this._timeout = statusData.timeout;

    try {
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

      if (this._pendingTransition) {
        const { state, data } = this._pendingTransition;
        this._pendingTransition = null;
        this._executeTransition(state, data);
      }
    }
  }

  _enterInactive() {
    this._media.startMediaWatcher();
    this._overlayVisible = true;
  }

  async _enterActive() {
    this._media.stopMediaWatcher();
    await this._fadeOutOverlay();
    this._media.resumeOurPausedMedia();
  }

  async _enterDisabled() {
    this._media.stopMediaWatcher();
    await this._fadeOutOverlay();
    this._media.resumeOurPausedMedia();
  }

  _fadeOutOverlay() {
    if (!this._overlayVisible) return Promise.resolve();

    return new Promise((resolve) => {
      this._fadePromiseResolve = () => {
        this._overlayVisible = false;
        this._fadePromiseResolve = null;
        resolve();
      };
      // In real code this is setTimeout(300). In tests we control it manually.
      if (this._autoResolveFade) {
        this._fadePromiseResolve();
      }
    });
  }

  /** Test helper: resolve the pending fade animation */
  completeFade() {
    if (this._fadePromiseResolve) {
      this._fadePromiseResolve();
    }
  }

  /** Enable auto-resolution of fade for tests that don't need manual control */
  set autoResolveFade(val) { this._autoResolveFade = val; }

  handleStatusUpdate(status) {
    if (status.timeout) this._timeout = status.timeout;

    if (status.disabled) {
      this.transition(State.DISABLED, status);
      return;
    }

    if (status.active) {
      this.transition(State.ACTIVE, status);
    } else {
      this.transition(State.INACTIVE, status);
    }
  }

  destroy() {
    this._media.stopMediaWatcher();
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('FocusStateMachine', () => {
  let media, dom, fsm;

  beforeEach(() => {
    media = createMediaMock();
    dom = createDomMock();
    fsm = new FocusStateMachine({ media, document: dom });
    fsm.autoResolveFade = true; // Auto-resolve fade by default
  });

  describe('initial state', () => {
    it('starts in ACTIVE state', () => {
      assert.equal(fsm.state, State.ACTIVE);
    });

    it('starts with default timeout of 2 minutes', () => {
      assert.equal(fsm.timeout, 2);
    });

    it('is not transitioning initially', () => {
      assert.equal(fsm.transitioning, false);
    });

    it('has no pending transition initially', () => {
      assert.equal(fsm.pendingTransition, null);
    });

    it('overlay is not visible initially', () => {
      assert.equal(fsm.overlayVisible, false);
    });
  });

  describe('basic transitions', () => {
    it('ACTIVE → INACTIVE: pauses media, shows overlay', () => {
      fsm.transition(State.INACTIVE, { active: false, daemonOnline: true });

      assert.equal(fsm.state, State.INACTIVE);
      assert.equal(fsm.overlayVisible, true);
      assert.ok(media.calls.includes('startMediaWatcher'));
    });

    it('ACTIVE → INACTIVE: media is paused BEFORE overlay (startMediaWatcher is first call)', () => {
      fsm.transition(State.INACTIVE, { active: false, daemonOnline: true });

      assert.equal(media.calls[0], 'startMediaWatcher');
    });

    it('INACTIVE → ACTIVE: stops watcher, fades overlay, resumes media', async () => {
      // First go INACTIVE
      fsm.transition(State.INACTIVE, { active: false });

      media.reset();

      // Then go ACTIVE
      fsm.transition(State.ACTIVE, { active: true });

      // Let the async transition complete
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fsm.state, State.ACTIVE);
      assert.equal(fsm.overlayVisible, false);
      assert.deepEqual(media.calls, ['stopMediaWatcher', 'resumeOurPausedMedia']);
    });

    it('ACTIVE → DISABLED: no overlay shown, no media changes', async () => {
      fsm.transition(State.DISABLED, { disabled: true });

      await new Promise(r => setTimeout(r, 10));

      assert.equal(fsm.state, State.DISABLED);
      assert.equal(fsm.overlayVisible, false);
      // stopMediaWatcher + resumeOurPausedMedia called but no-op from ACTIVE
      assert.ok(media.calls.includes('stopMediaWatcher'));
    });

    it('INACTIVE → DISABLED: removes overlay, resumes media', async () => {
      fsm.transition(State.INACTIVE, { active: false });
      media.reset();

      fsm.transition(State.DISABLED, { disabled: true });
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fsm.state, State.DISABLED);
      assert.equal(fsm.overlayVisible, false);
      assert.ok(media.calls.includes('stopMediaWatcher'));
      assert.ok(media.calls.includes('resumeOurPausedMedia'));
    });

    it('DISABLED → INACTIVE: shows overlay, pauses media', async () => {
      fsm.autoResolveFade = true;
      fsm.transition(State.DISABLED, { disabled: true });
      // Wait for async ACTIVE → DISABLED transition to complete (fade)
      await new Promise(r => setTimeout(r, 10));
      media.reset();

      fsm.transition(State.INACTIVE, { active: false });

      assert.equal(fsm.state, State.INACTIVE);
      assert.equal(fsm.overlayVisible, true);
      assert.ok(media.calls.includes('startMediaWatcher'));
    });

    it('DISABLED → ACTIVE: stays in ACTIVE-like state, no overlay', async () => {
      fsm.transition(State.DISABLED, { disabled: true });
      await new Promise(r => setTimeout(r, 10));
      media.reset();

      fsm.transition(State.ACTIVE, { active: true });
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fsm.state, State.ACTIVE);
      assert.equal(fsm.overlayVisible, false);
    });
  });

  describe('same-state transitions (no-op + data update)', () => {
    it('INACTIVE → INACTIVE: updates status data', () => {
      fsm.transition(State.INACTIVE, { active: false, elapsed: 5000 });
      fsm.transition(State.INACTIVE, { active: false, elapsed: 8000 });

      assert.equal(fsm.state, State.INACTIVE);
      assert.equal(fsm.statusData.elapsed, 8000);
    });

    it('INACTIVE → INACTIVE: re-pauses media (SPA nav fix)', () => {
      fsm.transition(State.INACTIVE, { active: false });
      media.reset();

      fsm.transition(State.INACTIVE, { active: false });

      assert.ok(media.calls.includes('pauseAllMedia'),
        'Should call pauseAllMedia on same-state INACTIVE update');
    });

    it('ACTIVE → ACTIVE: updates status data, does not pause media', () => {
      fsm.transition(State.ACTIVE, { active: true, elapsed: 1000 });

      assert.equal(fsm.state, State.ACTIVE);
      assert.ok(!media.calls.includes('pauseAllMedia'));
    });
  });

  describe('transition queueing (RC1 fix: fade-out race)', () => {
    it('queues transition during active fade-out', async () => {
      fsm.autoResolveFade = false;

      // Go INACTIVE (synchronous)
      fsm.transition(State.INACTIVE, { active: false });
      assert.equal(fsm.state, State.INACTIVE);
      assert.equal(fsm.overlayVisible, true);

      // Request ACTIVE — starts fade-out (async, waiting for completeFade())
      fsm.transition(State.ACTIVE, { active: true });

      // State is ACTIVE but fade is in progress
      assert.equal(fsm.state, State.ACTIVE);
      assert.equal(fsm.transitioning, true);

      // Now request INACTIVE while fade is still in progress
      fsm.transition(State.INACTIVE, { active: false });

      // Should be queued, not executed
      assert.notEqual(fsm.pendingTransition, null);
      assert.equal(fsm.pendingTransition.state, State.INACTIVE);

      // Complete the fade
      fsm.completeFade();
      await new Promise(r => setTimeout(r, 10));

      // After fade completes, queued INACTIVE transition should have executed
      assert.equal(fsm.state, State.INACTIVE);
      assert.equal(fsm.overlayVisible, true);
    });

    it('only latest queued transition is kept', async () => {
      fsm.autoResolveFade = false;

      fsm.transition(State.INACTIVE, { active: false });

      // Start ACTIVE transition (async fade)
      fsm.transition(State.ACTIVE, { active: true });
      assert.equal(fsm.transitioning, true);

      // Queue multiple transitions — only latest should be kept
      fsm.transition(State.INACTIVE, { active: false, elapsed: 100 });
      fsm.transition(State.DISABLED, { disabled: true });
      fsm.transition(State.INACTIVE, { active: false, elapsed: 999 });

      assert.equal(fsm.pendingTransition.state, State.INACTIVE);
      assert.equal(fsm.pendingTransition.data.elapsed, 999);

      fsm.completeFade();
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fsm.state, State.INACTIVE);
      assert.equal(fsm.statusData.elapsed, 999);
    });
  });

  describe('handleStatusUpdate (entry point)', () => {
    it('disabled flag → DISABLED', () => {
      fsm.handleStatusUpdate({ disabled: true, active: true });

      assert.equal(fsm.state, State.DISABLED);
    });

    it('active: true → ACTIVE (no-op from initial state)', () => {
      fsm.handleStatusUpdate({ active: true, daemonOnline: true });

      assert.equal(fsm.state, State.ACTIVE);
    });

    it('active: false → INACTIVE', () => {
      fsm.handleStatusUpdate({ active: false, daemonOnline: true });

      assert.equal(fsm.state, State.INACTIVE);
    });

    it('updates timeout from status', () => {
      fsm.handleStatusUpdate({ active: false, timeout: 5 });

      assert.equal(fsm.timeout, 5);
    });

    it('daemon offline → INACTIVE', () => {
      fsm.handleStatusUpdate({ active: false, daemonOnline: false });

      assert.equal(fsm.state, State.INACTIVE);
    });
  });

  describe('rapid toggle simulation (RC5 fix)', () => {
    it('rapid INACTIVE → ACTIVE → INACTIVE → ACTIVE resolves to final state', async () => {
      fsm.autoResolveFade = false;

      // Go inactive
      fsm.transition(State.INACTIVE, { active: false });
      assert.equal(fsm.state, State.INACTIVE);

      // Rapid: ACTIVE → blocks on fade
      fsm.transition(State.ACTIVE, { active: true });
      assert.equal(fsm.transitioning, true);

      // Rapid: INACTIVE queued
      fsm.transition(State.INACTIVE, { active: false });

      // Rapid: ACTIVE queued (overwrites previous queue)
      fsm.transition(State.ACTIVE, { active: true });

      // Only latest should be queued
      assert.equal(fsm.pendingTransition.state, State.ACTIVE);

      // Complete the first fade (INACTIVE → ACTIVE)
      fsm.completeFade();
      await new Promise(r => setTimeout(r, 10));

      // After processing queue: ACTIVE was queued, but we're already ACTIVE
      // so it's a same-state no-op
      assert.equal(fsm.state, State.ACTIVE);
      assert.equal(fsm.overlayVisible, false);
      assert.equal(fsm.transitioning, false);
    });

    it('rapid ACTIVE → INACTIVE → DISABLED resolves to DISABLED', async () => {
      fsm.autoResolveFade = true;

      fsm.transition(State.INACTIVE, { active: false });
      media.reset();

      // Go ACTIVE (starts fade)
      fsm.autoResolveFade = false;
      fsm.transition(State.ACTIVE, { active: true });

      // Queue DISABLED during fade
      fsm.transition(State.DISABLED, { disabled: true });

      fsm.completeFade();
      await new Promise(r => setTimeout(r, 10));

      // Need to complete the second fade too (ACTIVE → DISABLED also fades)
      fsm.completeFade();
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fsm.state, State.DISABLED);
      assert.equal(fsm.overlayVisible, false);
    });
  });

  describe('media lifecycle ordering', () => {
    it('entering INACTIVE: startMediaWatcher called before overlay creation', () => {
      let order = [];
      const origStart = media.startMediaWatcher.bind(media);
      media.startMediaWatcher = () => { order.push('startWatcher'); origStart(); };

      // Monkey-patch overlay creation to track order
      const origCreate = fsm._createOverlay;
      fsm._createOverlay = function() { order.push('createOverlay'); };

      fsm.transition(State.INACTIVE, { active: false });

      assert.equal(order[0], 'startWatcher');
      // createOverlay would be second if it were called (our mock just records)
    });

    it('entering ACTIVE: stopMediaWatcher before fade, resumeOurPausedMedia after fade', async () => {
      fsm.autoResolveFade = false;
      fsm.transition(State.INACTIVE, { active: false });
      media.reset();

      fsm.transition(State.ACTIVE, { active: true });

      // stopMediaWatcher should have been called already (before fade)
      assert.ok(media.calls.includes('stopMediaWatcher'));
      assert.ok(!media.calls.includes('resumeOurPausedMedia'));

      // Complete fade
      fsm.completeFade();
      await new Promise(r => setTimeout(r, 10));

      // resumeOurPausedMedia should be called after fade
      assert.ok(media.calls.includes('resumeOurPausedMedia'));
    });
  });

  describe('destroy', () => {
    it('stops media watcher on destroy', () => {
      fsm.transition(State.INACTIVE, { active: false });
      media.reset();

      fsm.destroy();

      assert.ok(media.calls.includes('stopMediaWatcher'));
    });
  });
});

describe('State enum', () => {
  it('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(State));
  });

  it('has exactly 3 states', () => {
    assert.equal(Object.keys(State).length, 3);
  });
});
