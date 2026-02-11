/**
 * Claude Code Focus Mode - Media Controller
 * Handles pausing/resuming all media on the page.
 *
 * Uses a MutationObserver to catch dynamically-added <video>/<audio> elements
 * (YouTube, TikTok, Instagram lazy-load videos). A 1-second setInterval fallback
 * catches anything the observer misses (e.g. elements injected via shadow DOM).
 */

(function() {
  // Prevent multiple injections
  if (window.__claudeFocusMediaController) return;
  window.__claudeFocusMediaController = true;

  // Track media elements we've paused (so we only resume those)
  const pausedByUs = new WeakSet();
  let mediaWatcherActive = false;
  let fallbackInterval = null;
  let observer = null;

  /**
   * Get all media elements on the page
   */
  function getAllMedia() {
    const videos = Array.from(document.querySelectorAll('video'));
    const audios = Array.from(document.querySelectorAll('audio'));
    return [...videos, ...audios];
  }

  /**
   * Pause all currently playing media on the page.
   * Can be called at any time — does not depend on overlay state.
   * Returns the number of elements paused.
   */
  function pauseAllMedia() {
    let pausedCount = 0;

    for (const el of getAllMedia()) {
      if (!el.paused) {
        try {
          el.pause();
          pausedByUs.add(el);
          pausedCount++;
        } catch (e) {
          // cross-origin iframe media, etc.
        }
      }
    }

    return pausedCount;
  }

  /**
   * Resume only the media elements we paused.
   */
  function resumeOurPausedMedia() {
    let resumedCount = 0;

    for (const el of getAllMedia()) {
      if (pausedByUs.has(el) && el.paused) {
        try {
          el.play().catch(() => {
            // Autoplay policy may block — ignore
          });
          resumedCount++;
        } catch (e) {
          // Ignore
        }
        pausedByUs.delete(el);
      }
    }

    return resumedCount;
  }

  /**
   * Handle a newly-observed media element: pause it if the watcher is active.
   */
  function onMediaElementFound(el) {
    if (!mediaWatcherActive) return;
    if (!el.paused) {
      try {
        el.pause();
        pausedByUs.add(el);
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * MutationObserver callback — scans added nodes for media elements.
   */
  function onMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // The added node itself could be a media element
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          onMediaElementFound(node);
        }

        // Or it could contain media elements
        if (node.querySelectorAll) {
          const nested = node.querySelectorAll('video, audio');
          for (const el of nested) {
            onMediaElementFound(el);
          }
        }
      }
    }
  }

  /**
   * Fallback interval — catches media that started playing outside of DOM
   * mutation scope (e.g. autoplay attribute, JavaScript .play() calls on
   * existing elements, or media inside shadow DOM).
   */
  function fallbackPause() {
    if (!mediaWatcherActive) return;
    for (const el of getAllMedia()) {
      if (!el.paused && !pausedByUs.has(el)) {
        try {
          el.pause();
          pausedByUs.add(el);
        } catch (e) {
          // Ignore
        }
      }
    }
  }

  /**
   * Start watching for media and pausing it.
   * Idempotent — safe to call multiple times.
   */
  function startMediaWatcher() {
    if (mediaWatcherActive) return;
    mediaWatcherActive = true;

    // Pause everything currently playing
    pauseAllMedia();

    // Start MutationObserver for new elements
    if (!observer) {
      observer = new MutationObserver(onMutations);
    }
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Fallback interval at 1s for autoplay/.play() calls
    if (!fallbackInterval) {
      fallbackInterval = setInterval(fallbackPause, 1000);
    }
  }

  /**
   * Stop watching for media. Does NOT resume media — call resumeOurPausedMedia() separately.
   * Idempotent — safe to call multiple times.
   */
  function stopMediaWatcher() {
    if (!mediaWatcherActive) return;
    mediaWatcherActive = false;

    if (observer) {
      observer.disconnect();
    }

    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
  }

  // Expose API globally for content.js to use
  window.__claudeFocusMedia = {
    pauseAllMedia,
    resumeOurPausedMedia,
    startMediaWatcher,
    stopMediaWatcher,
  };
})();
