/**
 * Drift guard for the committed theming stylesheet (src/theme/chat-ui.css).
 *
 * The stylesheet is GENERATED from component class usage by
 * scripts/gen-theme-css.mjs and committed. If component classes change
 * without regenerating, a non-Tailwind consumer (design-system docs site)
 * would silently lose styling for the new classes while the sentropic host
 * (which compiles Tailwind itself) stays correct. This spec fails in that
 * case.
 *
 * Extraction here mirrors the class surfaces Svelte components expose:
 *   - class="..." attributes
 *   - class:NAME={...} directives
 *   - string literals inside class={...} expressions
 * Custom (non-Tailwind) classes must be listed in CUSTOM_CLASS_ALLOWLIST —
 * adding a new custom class is an explicit, reviewable act.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG_ROOT = resolve(__dirname, '..');
const SRC_ROOT = join(PKG_ROOT, 'src');
const THEME_CSS_PATH = join(SRC_ROOT, 'theme', 'chat-ui.css');

/** Known non-Tailwind classes used by components (styled via scoped <style>, host CSS, or used as hooks). */
const CUSTOM_CLASS_ALLOWLIST = new Set([
  'chatMarkdown',
  'stream-aux-markdown',
  'userMarkdown',
  'composer-rich',
  'composer-single-line',
  'shiki',
  'lucide-icon'
]);

/** Package hook-class prefixes (semantic hooks for host/theme CSS, never Tailwind). */
const CUSTOM_CLASS_PREFIXES = ['chat-', 'topai-'];

const isCustomClass = (cls: string): boolean =>
  CUSTOM_CLASS_ALLOWLIST.has(cls) || CUSTOM_CLASS_PREFIXES.some((p) => cls.startsWith(p));

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

/** Extract class candidates from a .svelte source. */
function extractClasses(source: string): Set<string> {
  const found = new Set<string>();
  const add = (chunk: string) => {
    for (const token of chunk.split(/\s+/)) {
      // Require at least one letter (drops interpolation/punctuation artifacts).
      if (token && /[a-zA-Z]/.test(token)) found.add(token);
    }
  };
  // class="..." attributes — may contain {expressions}; harvest string
  // literals inside the braces, then the static remainder.
  for (const m of source.matchAll(/class="([^"]*)"/g)) {
    const raw = m[1];
    for (const expr of raw.matchAll(/\{([^}]*)\}/g)) {
      for (const lit of expr[1].matchAll(/'([^']*)'/g)) {
        // Keep only tokens shaped like utility classes (dash/variant/arbitrary);
        // plain words in these expressions are usually data values ('chat').
        for (const token of lit[1].split(/\s+/)) {
          if (/[-:[]/.test(token)) found.add(token);
        }
      }
    }
    add(raw.replace(/\{[^}]*\}/g, ' '));
  }
  // class:NAME={...} directives (token before `=`)
  for (const m of source.matchAll(/class:([^\s={]+)[=\s{]/g)) found.add(m[1]);
  // class={...} expressions: collect string/template literal contents
  for (const m of source.matchAll(/class=\{([\s\S]*?)\}\s*(?:\n|\/>|>|$)/g)) {
    const expr = m[1];
    for (const lit of expr.matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)) {
      // strip ${...} interpolations from template literals
      add((lit[1] ?? lit[2] ?? lit[3]).replace(/\$\{[^}]*\}/g, ' '));
    }
  }
  return found;
}

/** Escape a class name the way it appears as a CSS selector in the generated sheet. */
function cssEscapeClass(cls: string): string {
  return cls.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

describe('theme stylesheet drift guard', () => {
  const css = readFileSync(THEME_CSS_PATH, 'utf8');
  const svelteFiles = listFiles(SRC_ROOT, ['.svelte']);

  it('covers every Tailwind class used by components', () => {
    const missing: string[] = [];
    for (const file of svelteFiles) {
      const source = readFileSync(file, 'utf8');
      for (const cls of extractClasses(source)) {
        if (isCustomClass(cls)) continue;
        const selector = `.${cssEscapeClass(cls)}`;
        if (!css.includes(selector)) {
          missing.push(`${file.replace(PKG_ROOT + '/', '')}: ${cls}`);
        }
      }
    }
    expect(
      missing,
      `Classes missing from src/theme/chat-ui.css — regenerate it ` +
        `(scripts/gen-theme-css.mjs) or add genuine custom classes to ` +
        `CUSTOM_CLASS_ALLOWLIST:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('scopes every rule under [data-st-chat-theme]', () => {
    // No top-level selector may escape the scope (leak into consumer apps).
    const unscoped: string[] = [];
    // Cheap structural check: every rule-opening line must contain the scope
    // attribute or live inside @keyframes/@media (whose inner rules are
    // checked by the same line scan).
    let inKeyframes = false;
    for (const line of css.split('\n')) {
      const t = line.trim();
      if (t.startsWith('@keyframes')) inKeyframes = true;
      if (inKeyframes && t === '}') inKeyframes = false;
      if (inKeyframes) continue;
      if (/^[^@/*{}\s][^{}]*\{/.test(t) && !t.includes('[data-st-chat-theme]')) {
        unscoped.push(t);
      }
    }
    expect(unscoped, `Unscoped selectors leak into consumers:\n${unscoped.join('\n')}`).toEqual([]);
  });

  it('emits the load-bearing token declarations (exact, case-sensitive)', () => {
    const block = (selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start, `selector not found: ${selector}`).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('}', start));
    };
    const SCOPE = '[data-st-chat-theme]';
    // Surfaces / text / borders
    expect(block(`${SCOPE} .bg-white`)).toContain('var(--st-semantic-surface-default, #ffffff)');
    expect(block(`${SCOPE} .bg-slate-50`)).toContain('var(--st-semantic-surface-subtle, #f8fafc)');
    expect(block(`${SCOPE} .bg-slate-100`)).toContain('var(--st-semantic-surface-sunken, #f1f5f9)');
    expect(block(`${SCOPE} .text-slate-500`)).toContain('var(--st-semantic-text-muted, #64748b)');
    expect(block(`${SCOPE} .text-slate-900`)).toContain('var(--st-semantic-text-primary, #0f172a)');
    expect(block(`${SCOPE} .text-white`)).toContain('var(--st-semantic-action-primaryText, #ffffff)');
    expect(block(`${SCOPE} .border-slate-200`)).toContain('var(--st-semantic-border-subtle, #e2e8f0)');
    expect(block(`${SCOPE} .border-gray-200`)).toContain('var(--st-semantic-border-subtle, #e5e7eb)');
    // Send button states (class: directives in ChatConversation)
    expect(block(`${SCOPE} .bg-slate-800`)).toContain('var(--st-semantic-action-primary, #1e293b)');
    // BLOCKED token (owner ratification 2026-06-13): disabled send button stays a LITERAL
    // slate-300 (#cbd5e1 = rgb 203 213 225) until the DS lane ratifies a control token —
    // it must NOT carry any --st-* theming var. The --tw-bg-opacity wrapper is Tailwind's
    // standard literal-color emission (same form as the scrim/black/white literals below).
    expect(block(`${SCOPE} .bg-slate-300`)).toContain('rgb(203 213 225 / var(--tw-bg-opacity, 1))');
    expect(block(`${SCOPE} .bg-slate-300`)).not.toContain('--st-');
    // Primary + alpha modifiers (color-mix path; functions must receive the
    // explicit /NN value, never the legacy var(--tw-bg-opacity) expression)
    expect(block(`${SCOPE} .bg-primary`)).toContain(
      'var(--st-semantic-action-primary, oklch(50% 0.134 242.749))'
    );
    expect(block(`${SCOPE} .hover\\:bg-primary\\/90:hover`)).toContain(
      'color-mix(in srgb, var(--st-semantic-action-primary, oklch(50% 0.134 242.749)) 90%, transparent)'
    );
    expect(block(`${SCOPE} .focus-visible\\:ring-primary\\/30:focus-visible`)).toContain(
      '--tw-ring-color: color-mix(in srgb, var(--st-semantic-action-primary'
    );
    // Scrim plumbing must stay literal (legacy bg-opacity-* compatibility)
    expect(block(`${SCOPE} .bg-black`)).toContain('rgb(0 0 0 / var(--tw-bg-opacity');
    expect(block(`${SCOPE} .bg-opacity-40`)).toContain('--tw-bg-opacity: 0.4');
    expect(block(`${SCOPE} .focus-visible\\:ring-white\\/50:focus-visible`)).toContain(
      'rgb(255 255 255 / 0.5)'
    );
    // Errors -> DS status/feedback tokens
    expect(block(`${SCOPE} .text-red-500`)).toContain('var(--st-semantic-status-failed, #ef4444)');
    expect(block(`${SCOPE} .text-red-700`)).toContain('var(--st-semantic-feedback-danger, #b91c1c)');
    // Elevation + typography seams
    expect(block(`${SCOPE} .shadow-lg`)).toContain('var(--st-elevation-2');
    expect(block(`${SCOPE} .shadow-2xl`)).toContain('var(--st-elevation-3');
    expect(css).toContain('var(--st-font-sans');
  });

  it('is never wired into the sentropic host build (parity guard)', () => {
    // The sentropic app compiles Tailwind itself and must NOT import this
    // stylesheet (its look is the var() fallbacks already).
    const uiRoot = resolve(PKG_ROOT, '..', '..', 'ui');
    const offenders: string[] = [];
    for (const file of listFiles(join(uiRoot, 'src'), ['.svelte', '.ts', '.css'])) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('chat-ui/theme') || content.includes('theme/chat-ui.css')) {
        offenders.push(file);
      }
    }
    const tailwindConfig = readFileSync(join(uiRoot, 'tailwind.config.cjs'), 'utf8');
    expect(tailwindConfig).not.toContain('.css');
    expect(offenders).toEqual([]);
  });
});
