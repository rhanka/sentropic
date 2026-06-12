#!/usr/bin/env node
/**
 * gen-theme-css.mjs — generates src/theme/chat-ui.css (the opt-in theming
 * stylesheet for consumers that do not run Tailwind, e.g. the design-system
 * docs site).
 *
 * Pipeline:
 *   1. Compile Tailwind v3.4 with content = this package's src (same class
 *      extraction the sentropic host uses), with the color palette remapped
 *      to the --st-* token seam (scripts/theme-token-map.mjs). Fallback values
 *      equal the exact colors sentropic compiles today, so an unthemed
 *      consumer renders pixel-identical to sentropic.
 *   2. Scope every rule (preflight + utilities) under SCOPE_SELECTOR
 *      ([data-st-chat-theme]) so nothing leaks into the consumer app.
 *      html/body/:root preflight rules are remapped to the scope root.
 *
 * Run via the dev stack (repo mounted at /workspace, deps in the workspace
 * node_modules):
 *   make exec-ui CMD="node ../packages/chat-ui/scripts/gen-theme-css.mjs" <ports> ENV=<env>
 *
 * The output is COMMITTED (src/theme/chat-ui.css); a drift-guard test
 * (tests/theme-css.spec.ts) fails if component classes change without
 * regenerating.
 */

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  themeColors,
  pluginColorOverrides,
  themeBoxShadow,
  themeFontFamily,
  SCOPE_SELECTOR
} from './theme-token-map.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dir, '..');

// Resolve tailwind/postcss from the workspace install (ui devDependencies).
const require = createRequire(resolve(pkgRoot, '..', '..', 'ui', 'package.json'));
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');

const tailwindConfig = {
  content: [
    `${pkgRoot}/src/**/*.{html,js,svelte,ts}`
  ],
  corePlugins: {
    // Preflight is generated, then scoped below (fidelity with a host that
    // runs full preflight, without leaking resets into the consumer page).
    preflight: true
  },
  theme: {
    extend: {
      colors: themeColors,
      borderColor: pluginColorOverrides.borderColor,
      textColor: pluginColorOverrides.textColor,
      backgroundColor: pluginColorOverrides.backgroundColor,
      boxShadow: themeBoxShadow,
      fontFamily: themeFontFamily
    }
  },
  plugins: []
};

/**
 * Prefix a single selector with the scope. Returns one or more selectors.
 * - html/:host/body/:root preflight roots -> the scope element itself.
 * - `*` and bare pseudo-elements -> scope element AND all descendants
 *   (the wrapper must receive box-sizing/border resets too).
 * - everything else -> descendant of the scope.
 */
function scopeSelector(sel) {
  const t = sel.trim();
  if (t === 'html' || t === 'body' || t === ':root' || t === ':host') {
    return [SCOPE_SELECTOR];
  }
  if (t === '*') {
    return [SCOPE_SELECTOR, `${SCOPE_SELECTOR} *`];
  }
  if (t.startsWith('::')) {
    return [`${SCOPE_SELECTOR}${t}`, `${SCOPE_SELECTOR} ${t}`];
  }
  if (/^(html|body)\s+/.test(t)) {
    return [`${SCOPE_SELECTOR} ${t.replace(/^(html|body)\s+/, '')}`];
  }
  return [`${SCOPE_SELECTOR} ${t}`];
}

const scopePlugin = {
  postcssPlugin: 'st-chat-scope',
  Once(root) {
    root.walkRules((rule) => {
      // Skip keyframe step selectors (from/to/percentages).
      if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
      rule.selectors = rule.selectors.flatMap(scopeSelector);
    });
  }
};

const input = '@tailwind base;\n@tailwind utilities;\n';

const result = await postcss([tailwindcss(tailwindConfig), scopePlugin]).process(input, {
  from: undefined
});

const header = `/**
 * @sentropic/chat-ui — opt-in theming stylesheet (GENERATED, do not edit).
 *
 * Regenerate: make exec-ui CMD="node ../packages/chat-ui/scripts/gen-theme-css.mjs"
 * Source of truth: scripts/theme-token-map.mjs + component class usage.
 *
 * Usage (consumers WITHOUT Tailwind, e.g. design-system docs):
 *   import '@sentropic/chat-ui/theme.css';
 *   <div data-st-chat-theme> ...chat-ui components... </div>
 * Theme by setting --st-* design-system tokens on the scope element (or
 * import a @sentropic/design-system-themes stylesheet). Unthemed defaults
 * render the exact sentropic look. Consumers that already run Tailwind over
 * this package (like the sentropic app) must NOT import this file.
 */
`;

const outDir = resolve(pkgRoot, 'src', 'theme');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, 'chat-ui.css');
writeFileSync(outFile, header + result.css, 'utf8');
console.log(`[gen-theme-css] wrote ${outFile} (${result.css.length} bytes)`);
