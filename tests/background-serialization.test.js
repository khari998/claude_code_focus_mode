/**
 * Tests for background.js serialization mechanisms
 *
 * Tests the broadcast serialization (serializedBroadcast) and
 * updateAllSites generation counter to verify they prevent the
 * race conditions identified in the audit (RC5, RC6).
 *
 * Run: node --test tests/background-serialization.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Extracted serializedBroadcast logic ───────────────────────────

function createBroadcastSerializer() {
  let broadcastInProgress = false;
  let broadcastQueued = false;
  let broadcastCount = 0;
  let concurrentCount = 0;
  let maxConcurrent = 0;
  const broadcastLog = [];

  async function broadcastStatus(label) {
    concurrentCount++;
    maxConcurrent = Math.max(maxConcurrent, concurrentCount);
    broadcastCount++;
    broadcastLog.push({ type: 'start', label, count: broadcastCount });

    // Simulate async work
    await new Promise(r => setTimeout(r, 10));

    broadcastLog.push({ type: 'end', label, count: broadcastCount });
    concurrentCount--;
  }

  async function serializedBroadcast(label) {
    if (broadcastInProgress) {
      broadcastQueued = label || true;
      return;
    }
    broadcastInProgress = true;
    try {
      await broadcastStatus(label || broadcastCount);
    } finally {
      broadcastInProgress = false;
      if (broadcastQueued) {
        const queuedLabel = broadcastQueued;
        broadcastQueued = false;
        await serializedBroadcast(queuedLabel);
      }
    }
  }

  return {
    serializedBroadcast,
    getBroadcastCount: () => broadcastCount,
    getMaxConcurrent: () => maxConcurrent,
    getLog: () => broadcastLog,
    reset() {
      broadcastCount = 0;
      concurrentCount = 0;
      maxConcurrent = 0;
      broadcastLog.length = 0;
    },
  };
}

// ─── Extracted updateAllSites generation counter logic ─────────────

function createUpdateSerializer() {
  let updateGeneration = 0;
  const processedTabs = [];
  let abortedRuns = 0;

  async function updateAllSites(gen, tabs) {
    for (const tab of tabs) {
      // Check if a newer generation superseded us
      if (gen !== updateGeneration) {
        abortedRuns++;
        return;
      }
      // Simulate per-tab async work
      await new Promise(r => setTimeout(r, 5));
      processedTabs.push({ gen, tab });
    }
  }

  function serializedUpdateAllSites(tabs) {
    const gen = ++updateGeneration;
    return updateAllSites(gen, tabs);
  }

  return {
    serializedUpdateAllSites,
    getGeneration: () => updateGeneration,
    getProcessedTabs: () => processedTabs,
    getAbortedRuns: () => abortedRuns,
    reset() {
      updateGeneration = 0;
      processedTabs.length = 0;
      abortedRuns = 0;
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('serializedBroadcast', () => {
  let serializer;

  beforeEach(() => {
    serializer = createBroadcastSerializer();
  });

  it('executes a single broadcast', async () => {
    await serializer.serializedBroadcast('single');

    assert.equal(serializer.getBroadcastCount(), 1);
  });

  it('never runs concurrent broadcasts', async () => {
    // Fire multiple broadcasts simultaneously
    const p1 = serializer.serializedBroadcast('first');
    const p2 = serializer.serializedBroadcast('second');
    const p3 = serializer.serializedBroadcast('third');

    await Promise.all([p1, p2, p3]);
    // Wait for any queued broadcasts to finish
    await new Promise(r => setTimeout(r, 50));

    assert.equal(serializer.getMaxConcurrent(), 1,
      'Should never have more than 1 concurrent broadcast');
  });

  it('queues and executes at least one follow-up broadcast', async () => {
    const p1 = serializer.serializedBroadcast('first');
    serializer.serializedBroadcast('second');
    serializer.serializedBroadcast('third');

    await p1;
    // Wait for queued broadcasts
    await new Promise(r => setTimeout(r, 50));

    assert.ok(serializer.getBroadcastCount() >= 2,
      'Should execute at least 2 broadcasts (initial + queued)');
  });

  it('collapses multiple queued requests into one execution', async () => {
    const p1 = serializer.serializedBroadcast('first');

    // Queue 5 more while first is running
    for (let i = 0; i < 5; i++) {
      serializer.serializedBroadcast(`queued-${i}`);
    }

    await p1;
    await new Promise(r => setTimeout(r, 50));

    // Should be exactly 2: the initial + one coalesced queued
    assert.equal(serializer.getBroadcastCount(), 2,
      'Multiple queued requests should coalesce into one execution');
  });
});

describe('updateAllSites generation counter', () => {
  let serializer;

  beforeEach(() => {
    serializer = createUpdateSerializer();
  });

  it('processes all tabs for a single call', async () => {
    await serializer.serializedUpdateAllSites(['tab1', 'tab2', 'tab3']);

    assert.equal(serializer.getProcessedTabs().length, 3);
  });

  it('aborts stale runs when a newer call starts', async () => {
    const tabs = ['tab1', 'tab2', 'tab3', 'tab4', 'tab5'];

    // Start first update (will be slow, 5ms per tab)
    const p1 = serializer.serializedUpdateAllSites(tabs);

    // Immediately start second update — this increments the generation
    const p2 = serializer.serializedUpdateAllSites(tabs);

    await Promise.all([p1, p2]);

    assert.ok(serializer.getAbortedRuns() >= 1,
      'First run should have been aborted');

    // The second run should have processed all tabs
    const gen2Tabs = serializer.getProcessedTabs().filter(t => t.gen === 2);
    assert.equal(gen2Tabs.length, 5, 'Second run should process all tabs');
  });

  it('increments generation on each call', () => {
    serializer.serializedUpdateAllSites(['a']);
    serializer.serializedUpdateAllSites(['b']);
    serializer.serializedUpdateAllSites(['c']);

    assert.equal(serializer.getGeneration(), 3);
  });

  it('rapid toggles: only final update completes fully', async () => {
    const tabs = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

    // Simulate rapid toggles (5 calls in quick succession)
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(serializer.serializedUpdateAllSites(tabs));
    }

    await Promise.all(promises);

    // Final generation (5) should have processed all tabs
    const gen5Tabs = serializer.getProcessedTabs().filter(t => t.gen === 5);
    assert.equal(gen5Tabs.length, tabs.length,
      'Final generation should process all tabs');

    // Earlier generations should have been aborted (at least partially)
    assert.ok(serializer.getAbortedRuns() >= 1,
      'At least one earlier generation should have been aborted');
  });
});
