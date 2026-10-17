import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The google glyph is a static inline SVG inside the Svelte component (no
// Svelte component tests in this repo: UI testing scope is TypeScript only).
// This test locks the Google Sign-In branding contract at the source level:
// the google branch must render the official 4-color "G" (fixed fills, never
// `currentColor`, no external fetch) while other providers stay monochrome.
const glyphPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'components',
  'AuthProviderGlyph.svelte',
);

const source = readFileSync(glyphPath, 'utf8');

const googleBlock = source.slice(
  source.indexOf("{#if glyph === 'google'}"),
  source.indexOf("{:else if glyph === 'github'}"),
);

const OFFICIAL_FILLS = ['#4285F4', '#34A853', '#FBBC05', '#EA4335'];

describe('google provider glyph (official multicolor G)', () => {
  it('renders the four official Google brand fills', () => {
    for (const fill of OFFICIAL_FILLS) {
      expect(googleBlock).toContain(`fill="${fill}"`);
    }
  });

  it('does not recolor the google mark with currentColor', () => {
    expect(googleBlock).not.toContain('currentColor');
  });

  it('paints the fills in official order blue, green, yellow, red (order is load-bearing)', () => {
    const positions = OFFICIAL_FILLS.map((fill) => googleBlock.indexOf(`fill="${fill}"`));
    for (const position of positions) {
      expect(position).toBeGreaterThan(-1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('is a static inline SVG with no external fetch', () => {
    expect(googleBlock).toContain('<svg viewBox="0 0 24 24"');
    expect(googleBlock).not.toMatch(/<image|href\s*=|http/);
  });

  it('keeps the other providers monochrome via currentColor', () => {
    const rest = source.slice(source.indexOf("{:else if glyph === 'github'}"));
    expect(rest).toContain('fill="currentColor"');
  });
});
