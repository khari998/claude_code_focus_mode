/**
 * Tests for media-controller.js
 *
 * Tests pause/resume tracking, watcher idempotency, and MutationObserver
 * integration using DOM mocks.
 *
 * Run: node --test tests/media-controller.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── DOM / MutationObserver mocks ──────────────────────────────────

function createMockMediaElement(paused = false) {
  const el = {
    tagName: 'VIDEO',
    paused,
    _playCalled: false,
    _pauseCalled: false,
    nodeType: 1,
    pause() { this.paused = true; this._pauseCalled = true; },
    play() { this.paused = false; this._playCalled = true; return Promise.resolve(); },
    querySelectorAll() { return []; },
  };
  return el;
}

class MockMutationObserver {
  constructor(callback) {
    this._callback = callback;
    this._observing = false;
    MockMutationObserver._instances.push(this);
  }
  observe() { this._observing = true; }
  disconnect() { this._observing = false; }

  // Test helper: simulate mutations
  triggerMutation(addedNodes) {
    if (this._observing) {
      this._callback([{ addedNodes }]);
    }
  }
}
MockMutationObserver._instances = [];

// ─── Extracted media controller logic ──────────────────────────────
// Mirrors media-controller.js logic, injectable with mocks.

function createMediaController(mockElements, MockObserver) {
  const pausedByUs = new WeakSet();
  let mediaWatcherActive = false;
  let fallbackInterval = null;
  let observer = null;

  function getAllMedia() {
    return mockElements.filter(el => el.tagName === 'VIDEO' || el.tagName === 'AUDIO');
  }

  function pauseAllMedia() {
    let pausedCount = 0;
    for (const el of getAllMedia()) {
      if (!el.paused) {
        el.pause();
        pausedByUs.add(el);
        pausedCount++;
      }
    }
    return pausedCount;
  }

  function resumeOurPausedMedia() {
    let resumedCount = 0;
    for (const el of getAllMedia()) {
      if (pausedByUs.has(el) && el.paused) {
        el.play();
        resumedCount++;
        pausedByUs.delete(el);
      }
    }
    return resumedCount;
  }

  function onMediaElementFound(el) {
    if (!mediaWatcherActive) return;
    if (!el.paused) {
      el.pause();
      pausedByUs.add(el);
    }
  }

  function startMediaWatcher() {
    if (mediaWatcherActive) return;
    mediaWatcherActive = true;
    pauseAllMedia();

    if (!observer) {
      observer = new MockObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
              onMediaElementFound(node);
            }
            if (node.querySelectorAll) {
              const nested = node.querySelectorAll('video, audio');
              for (const el of nested) {
                onMediaElementFound(el);
              }
            }
          }
        }
      });
    }
    observer.observe();
  }

  function stopMediaWatcher() {
    if (!mediaWatcherActive) return;
    mediaWatcherActive = false;
    if (observer) observer.disconnect();
  }

  return {
    pauseAllMedia,
    resumeOurPausedMedia,
    startMediaWatcher,
    stopMediaWatcher,
    isActive: () => mediaWatcherActive,
    getObserver: () => observer,
    isPausedByUs: (el) => pausedByUs.has(el),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('MediaController', () => {
  let elements, controller;

  beforeEach(() => {
    elements = [];
    MockMutationObserver._instances = [];
    controller = createMediaController(elements, MockMutationObserver);
  });

  describe('pauseAllMedia', () => {
    it('pauses all playing media elements', () => {
      const v1 = createMockMediaElement(false); // playing
      const v2 = createMockMediaElement(false); // playing
      const v3 = createMockMediaElement(true);  // already paused
      elements.push(v1, v2, v3);

      const count = controller.pauseAllMedia();

      assert.equal(count, 2);
      assert.equal(v1.paused, true);
      assert.equal(v2.paused, true);
      assert.equal(v3._pauseCalled, false); // wasn't playing, not touched
    });

    it('returns 0 when no media is playing', () => {
      elements.push(createMockMediaElement(true));

      assert.equal(controller.pauseAllMedia(), 0);
    });

    it('tracks paused elements for later resume', () => {
      const v1 = createMockMediaElement(false);
      elements.push(v1);

      controller.pauseAllMedia();

      assert.ok(controller.isPausedByUs(v1));
    });
  });

  describe('resumeOurPausedMedia', () => {
    it('only resumes media that we paused', () => {
      const v1 = createMockMediaElement(false); // playing → we'll pause it
      const v2 = createMockMediaElement(true);  // already paused by user
      elements.push(v1, v2);

      controller.pauseAllMedia(); // pauses v1, tracks it
      const count = controller.resumeOurPausedMedia();

      assert.equal(count, 1);
      assert.equal(v1.paused, false); // resumed
      assert.equal(v2._playCalled, false); // never touched
    });

    it('does not resume elements we did not pause', () => {
      const v1 = createMockMediaElement(true); // paused by something else
      elements.push(v1);

      const count = controller.resumeOurPausedMedia();

      assert.equal(count, 0);
      assert.equal(v1._playCalled, false);
    });

    it('clears tracking after resume', () => {
      const v1 = createMockMediaElement(false);
      elements.push(v1);

      controller.pauseAllMedia();
      controller.resumeOurPausedMedia();

      assert.ok(!controller.isPausedByUs(v1));
    });
  });

  describe('startMediaWatcher', () => {
    it('sets watcher to active', () => {
      controller.startMediaWatcher();

      assert.equal(controller.isActive(), true);
    });

    it('pauses all media on start', () => {
      const v1 = createMockMediaElement(false);
      elements.push(v1);

      controller.startMediaWatcher();

      assert.equal(v1.paused, true);
    });

    it('is idempotent — calling twice does not double-start', () => {
      controller.startMediaWatcher();
      controller.startMediaWatcher();

      assert.equal(controller.isActive(), true);
      assert.equal(MockMutationObserver._instances.length, 1);
    });

    it('creates a MutationObserver', () => {
      controller.startMediaWatcher();

      assert.notEqual(controller.getObserver(), null);
    });
  });

  describe('stopMediaWatcher', () => {
    it('sets watcher to inactive', () => {
      controller.startMediaWatcher();
      controller.stopMediaWatcher();

      assert.equal(controller.isActive(), false);
    });

    it('is idempotent — calling twice does not throw', () => {
      controller.stopMediaWatcher();
      controller.stopMediaWatcher();

      assert.equal(controller.isActive(), false);
    });

    it('does NOT resume media (separate responsibility)', () => {
      const v1 = createMockMediaElement(false);
      elements.push(v1);

      controller.startMediaWatcher(); // pauses v1
      controller.stopMediaWatcher();

      assert.equal(v1.paused, true); // still paused
      assert.equal(v1._playCalled, false); // play never called
    });

    it('disconnects MutationObserver', () => {
      controller.startMediaWatcher();
      const obs = controller.getObserver();
      controller.stopMediaWatcher();

      assert.equal(obs._observing, false);
    });
  });

  describe('MutationObserver integration', () => {
    it('pauses new video elements added to DOM while watching', () => {
      controller.startMediaWatcher();
      const obs = controller.getObserver();

      // Simulate a new video being added to the DOM
      const newVideo = createMockMediaElement(false); // playing
      elements.push(newVideo);
      obs.triggerMutation([newVideo]);

      assert.equal(newVideo.paused, true);
    });

    it('does not pause new elements when watcher is stopped', () => {
      controller.startMediaWatcher();
      const obs = controller.getObserver();
      controller.stopMediaWatcher();

      const newVideo = createMockMediaElement(false);
      elements.push(newVideo);
      // Observer is disconnected, but just in case:
      obs._observing = true; // force a trigger
      obs.triggerMutation([newVideo]);

      // The callback checks mediaWatcherActive, which is false
      assert.equal(newVideo._pauseCalled, false);
    });

    it('handles nested video elements inside added containers', () => {
      controller.startMediaWatcher();
      const obs = controller.getObserver();

      const nestedVideo = createMockMediaElement(false);
      const container = {
        tagName: 'DIV',
        nodeType: 1,
        querySelectorAll(selector) {
          if (selector.includes('video')) return [nestedVideo];
          return [];
        },
      };

      obs.triggerMutation([container]);

      assert.equal(nestedVideo.paused, true);
    });
  });
});
