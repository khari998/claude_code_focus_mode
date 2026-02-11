/**
 * Tests for URL matching logic (background.js)
 *
 * Tests urlMatchesEnabledSite and urlMatchesAnySite with various URL patterns.
 *
 * Run: node --test tests/url-matching.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Extracted URL matching logic from background.js ───────────────

const DEFAULT_SITES = [
  { id: 'youtube', name: 'YouTube', patterns: ['*://*.youtube.com/*'], enabled: true, builtin: true },
  { id: 'twitter', name: 'Twitter/X', patterns: ['*://*.twitter.com/*', '*://*.x.com/*'], enabled: false, builtin: true },
  { id: 'reddit', name: 'Reddit', patterns: ['*://*.reddit.com/*'], enabled: false, builtin: true },
];

function createMatcher(sites, enabled = true) {
  const settings = { enabled, sites };

  function urlMatchesEnabledSite(url) {
    if (!settings.enabled) return false;

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      for (const site of settings.sites) {
        if (!site.enabled) continue;

        for (const pattern of site.patterns) {
          const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\//g, '\\/');

          if (new RegExp(regexPattern).test(url)) {
            return true;
          }

          const patternHost = pattern.match(/\*:\/\/\*?\.?([^\/]+)/)?.[1];
          if (patternHost && (hostname === patternHost || hostname.endsWith('.' + patternHost))) {
            return true;
          }
        }
      }
    } catch (e) {
      // Invalid URL
    }

    return false;
  }

  function urlMatchesAnySite(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      for (const site of settings.sites) {
        for (const pattern of site.patterns) {
          const patternHost = pattern.match(/\*:\/\/\*?\.?([^\/]+)/)?.[1];
          if (patternHost && (hostname === patternHost || hostname.endsWith('.' + patternHost))) {
            return true;
          }
        }
      }
    } catch (e) {
      // Invalid URL
    }
    return false;
  }

  return { urlMatchesEnabledSite, urlMatchesAnySite };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('urlMatchesEnabledSite', () => {
  it('matches YouTube when enabled', () => {
    const { urlMatchesEnabledSite } = createMatcher(DEFAULT_SITES);

    assert.ok(urlMatchesEnabledSite('https://www.youtube.com/watch?v=abc'));
    assert.ok(urlMatchesEnabledSite('https://youtube.com/'));
    assert.ok(urlMatchesEnabledSite('https://m.youtube.com/'));
  });

  it('does not match Twitter when disabled', () => {
    const { urlMatchesEnabledSite } = createMatcher(DEFAULT_SITES);

    assert.ok(!urlMatchesEnabledSite('https://twitter.com/'));
    assert.ok(!urlMatchesEnabledSite('https://x.com/'));
  });

  it('returns false for non-matching URLs', () => {
    const { urlMatchesEnabledSite } = createMatcher(DEFAULT_SITES);

    assert.ok(!urlMatchesEnabledSite('https://google.com/'));
    assert.ok(!urlMatchesEnabledSite('https://github.com/'));
  });

  it('returns false when global toggle is disabled', () => {
    const { urlMatchesEnabledSite } = createMatcher(DEFAULT_SITES, false);

    assert.ok(!urlMatchesEnabledSite('https://www.youtube.com/'));
  });

  it('handles invalid URLs without throwing', () => {
    const { urlMatchesEnabledSite } = createMatcher(DEFAULT_SITES);

    assert.ok(!urlMatchesEnabledSite('not-a-url'));
    assert.ok(!urlMatchesEnabledSite(''));
  });

  it('matches custom sites', () => {
    const sites = [
      ...DEFAULT_SITES,
      { id: 'custom-1', name: 'example.com', patterns: ['*://*.example.com/*', '*://example.com/*'], enabled: true },
    ];
    const { urlMatchesEnabledSite } = createMatcher(sites);

    assert.ok(urlMatchesEnabledSite('https://example.com/page'));
    assert.ok(urlMatchesEnabledSite('https://sub.example.com/'));
  });
});

describe('urlMatchesAnySite', () => {
  it('matches both enabled and disabled sites', () => {
    const { urlMatchesAnySite } = createMatcher(DEFAULT_SITES);

    // YouTube is enabled
    assert.ok(urlMatchesAnySite('https://www.youtube.com/'));
    // Twitter is disabled but should still match "any"
    assert.ok(urlMatchesAnySite('https://twitter.com/'));
    assert.ok(urlMatchesAnySite('https://x.com/'));
  });

  it('does not match non-configured sites', () => {
    const { urlMatchesAnySite } = createMatcher(DEFAULT_SITES);

    assert.ok(!urlMatchesAnySite('https://google.com/'));
  });

  it('works even when global toggle is off', () => {
    const { urlMatchesAnySite } = createMatcher(DEFAULT_SITES, false);

    // urlMatchesAnySite doesn't check settings.enabled
    assert.ok(urlMatchesAnySite('https://www.youtube.com/'));
  });
});
