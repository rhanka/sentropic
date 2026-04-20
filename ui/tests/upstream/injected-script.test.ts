import { describe, expect, it } from 'vitest';
import { generateInjectedScript } from '../../src/lib/upstream/injected-script';

describe('generateInjectedScript', () => {
  const ORIGIN = 'https://app.topai.com';
  const script = generateInjectedScript(ORIGIN);

  it('returns a string', () => {
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(100);
  });

  it('is wrapped in an IIFE', () => {
    expect(script.substring(0, 30)).toContain('(function()');
    expect(script.endsWith('})();')).toBe(true);
  });

  it('contains the bridge origin', () => {
    expect(script).toContain(JSON.stringify(ORIGIN));
  });

  it('contains the re-entrant guard', () => {
    expect(script).toContain('__TOPAI_ACTIVE');
  });

  it('contains the visual badge setup', () => {
    expect(script).toContain('__topai_badge');
    expect(script).toContain('Connecting...');
    expect(script).toContain('Top AI');
    expect(script).toContain('Disconnected');
  });

  it('contains a postMessage listener', () => {
    expect(script).toContain('addEventListener("message"');
  });

  it('verifies origin in the listener', () => {
    expect(script).toContain('event.origin !== BRIDGE_ORIGIN');
  });

  it('contains tab_read handler with querySelector', () => {
    expect(script).toContain('handleTabRead');
    expect(script).toContain('document.querySelector');
    expect(script).toContain('outerHTML');
    expect(script).toContain('textContent');
  });

  it('contains tab_read screenshot handler via getDisplayMedia', () => {
    expect(script).toContain('handleScreenshot');
    expect(script).toContain('getDisplayMedia');
    expect(script).toContain('image/jpeg');
    expect(script).toContain('0.95');
  });

  it('caps screenshot width to 1280px', () => {
    expect(script).toContain('1280');
  });

  it('contains tab_action handler for click/input/scroll', () => {
    expect(script).toContain('handleTabAction');
    expect(script).toContain('"click"');
    expect(script).toContain('"input"');
    expect(script).toContain('"scroll"');
  });

  it('truncates content to 60K chars', () => {
    expect(script).toContain('60000');
    expect(script).toContain('truncated');
  });

  it('sends register message on init', () => {
    expect(script).toContain('"register"');
    expect(script).toContain('location.href');
    expect(script).toContain('document.title');
  });

  it('handles connected message for badge state', () => {
    expect(script).toContain('"connected"');
    expect(script).toContain('setBadgeState');
  });

  it('uses ES5-compatible syntax (no const/let/arrow)', () => {
    // The script should not contain ES6+ syntax markers
    // We check for common ES6 patterns that would break ES5 compatibility
    // Note: "const" may appear inside string literals from JSON.stringify,
    // so we check for standalone const/let declarations
    const lines = script.split(';');
    for (const line of lines) {
      // Skip lines that are inside JSON strings
      if (line.includes('"const"') || line.includes('"let"')) continue;
      // Check there's no standalone const/let keyword used as declaration
      expect(line).not.toMatch(/(?:^|[{;])\s*const\s+/);
      expect(line).not.toMatch(/(?:^|[{;])\s*let\s+/);
    }
    // No arrow functions (=> not inside strings)
    expect(script).not.toMatch(/[^"'=!<>]=>\s*[^"']/);
    // No template literals
    expect(script).not.toContain('`');
  });

  it('references bridge iframe by #__topai_bridge', () => {
    expect(script).toContain('__topai_bridge');
  });
});
