/**
 * Claude Code Focus Mode - Media Controller
 * Handles pausing/resuming all media on the page
 */

(function() {
  // Prevent multiple injections
  if (window.__claudeFocusMediaController) return;
  window.__claudeFocusMediaController = true;

  // Track media elements we've paused (so we only resume those)
  const pausedByUs = new WeakSet();
  let mediaWatcherInterval = null;

  /**
   * Get all media elements on the page
   */
  function getAllMedia() {
    const videos = Array.from(document.querySelectorAll('video'));
    const audios = Array.from(document.querySelectorAll('audio'));
    return [...videos, ...audios];
  }

  /**
   * Get all currently playing media elements
   */
  function getPlayingMedia() {
    return getAllMedia().filter(media => !media.paused);
  }

  /**
   * Pause all playing media on the page
   */
  function pauseAllMedia() {
    const playing = getPlayingMedia();
    let pausedCount = 0;

    for (const media of playing) {
      try {
        media.pause();
        pausedByUs.add(media);
        pausedCount++;
      } catch (e) {
        console.warn('[Claude Focus] Failed to pause media:', e);
      }
    }

    if (pausedCount > 0) {
      console.log(`[Claude Focus] Paused ${pausedCount} media element(s)`);
    }

    return pausedCount;
  }

  /**
   * Resume only the media we paused
   */
  function resumeOurPausedMedia() {
    const allMedia = getAllMedia();
    let resumedCount = 0;

    for (const media of allMedia) {
      if (pausedByUs.has(media) && media.paused) {
        try {
          media.play().catch(() => {
            // Autoplay might be blocked, ignore
          });
          resumedCount++;
        } catch (e) {
          console.warn('[Claude Focus] Failed to resume media:', e);
        }
        pausedByUs.delete(media);
      }
    }

    if (resumedCount > 0) {
      console.log(`[Claude Focus] Resumed ${resumedCount} media element(s)`);
    }

    return resumedCount;
  }

  /**
   * Clear tracking for all media (without resuming)
   */
  function clearPausedTracking() {
    // WeakSet doesn't have a clear method, but elements will be
    // garbage collected when removed from DOM
  }

  /**
   * Start watching for new media to pause
   * Needed because sites like TikTok/Instagram load videos dynamically
   */
  function startMediaWatcher() {
    if (mediaWatcherInterval) return;

    // Pause immediately
    pauseAllMedia();

    // Keep checking for new videos every 500ms
    mediaWatcherInterval = setInterval(() => {
      const playing = getPlayingMedia();
      for (const media of playing) {
        if (!pausedByUs.has(media)) {
          pauseAllMedia();
          break;
        }
      }
    }, 500);

    console.log('[Claude Focus] Media watcher started');
  }

  /**
   * Stop watching for media
   */
  function stopMediaWatcher() {
    if (mediaWatcherInterval) {
      clearInterval(mediaWatcherInterval);
      mediaWatcherInterval = null;
      console.log('[Claude Focus] Media watcher stopped');
    }
  }

  /**
   * Check if media watcher is active
   */
  function isMediaWatcherActive() {
    return mediaWatcherInterval !== null;
  }

  // Expose API globally for content.js to use
  window.__claudeFocusMedia = {
    pauseAllMedia,
    resumeOurPausedMedia,
    startMediaWatcher,
    stopMediaWatcher,
    isMediaWatcherActive,
    getPlayingMedia,
  };

  console.log('[Claude Focus] Media controller loaded');
})();
