#!/usr/bin/env node
/**
 * verify-publish-artifacts.mjs — npm prepack gate.
 *
 * Runs automatically on `npm pack` / `npm publish` (pack-chat-ui and
 * publish-chat-ui Make targets). Fails the pack when a tarball would ship
 * with a broken `./theme.css` export — i.e. the dist artifact is missing
 * because build-chat-ui (svelte-package) did not run or stopped copying
 * static assets. Guards the "publish silently broken" trap: the exports map
 * is rewritten to ./dist/theme/chat-ui.css at publish time and `src` is
 * stripped from the tarball, so only dist counts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));

// Only enforce dist artifacts for dist-form packs (publish pipeline). A
// src-form `npm pack` (exports -> ./src/...) ships src and needs no dist.
const distForm = String(pkg.main ?? '').startsWith('./dist/');
if (!distForm) {
  console.log('[verify-publish-artifacts] src-form package.json, skipping dist checks');
  process.exit(0);
}

const required = ['dist/index.js', 'dist/theme/chat-ui.css'];
const missing = required.filter((rel) => !existsSync(resolve(pkgRoot, rel)));
if (missing.length > 0) {
  console.error(
    `[verify-publish-artifacts] FAIL — missing publish artifacts: ${missing.join(', ')}. ` +
      'Run build-chat-ui (svelte-package) before packing/publishing.'
  );
  process.exit(1);
}
console.log('[verify-publish-artifacts] OK — dist artifacts present');
