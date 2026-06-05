#!/usr/bin/env node
/**
 * make-publish-pkgjson.mjs — publish-time package.json rewriter (BR-PKG-EX1)
 *
 * The repo/workspace package.json stays src-form (exports -> ./src/...) so the
 * workspace typecheck/build/cowork jobs resolve chat-ui from source as before.
 * At pack/publish time, this script produces a dist-form package.json (in-place,
 * as stdout or in-place with --write) so the tarball consumers get compiled .js
 * and preprocessed .svelte files instead of raw TypeScript source.
 *
 * Transformation rules:
 *   main:    ./src/index.ts            -> ./dist/index.js
 *   types:   ./src/index.ts            -> ./dist/index.d.ts
 *   exports[*].types:  ./src/X.ts     -> ./dist/X.d.ts
 *                      ./src/X.svelte.d.ts -> ./dist/X.svelte.d.ts  (unchanged)
 *   exports[*].svelte: ./src/X.ts     -> ./dist/X.js
 *                      ./src/X.svelte -> ./dist/X.svelte             (unchanged)
 *   exports[*].import: (same as svelte)
 *   files:   ["dist","src","README.md","LICENSE"] -> ["dist","README.md","LICENSE"]
 *
 * Usage (run from packages/chat-ui/):
 *   node scripts/make-publish-pkgjson.mjs --write   # rewrites package.json in-place
 *   node scripts/make-publish-pkgjson.mjs            # prints dist-form JSON to stdout
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dir, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

/** Convert a src/ path to its dist/ equivalent. */
function srcToDist(field, srcPath) {
  if (!srcPath || !srcPath.startsWith('./src/')) return srcPath;
  const rest = srcPath.slice('./src/'.length);

  if (field === 'types') {
    // ./src/foo/Bar.svelte.d.ts -> ./dist/foo/Bar.svelte.d.ts  (already a .d.ts, copy as-is)
    if (rest.endsWith('.svelte.d.ts')) return `./dist/${rest}`;
    // ./src/index.ts -> ./dist/index.d.ts
    if (rest.endsWith('.ts')) return `./dist/${rest.slice(0, -3)}.d.ts`;
    return `./dist/${rest}`;
  }

  if (field === 'svelte' || field === 'import') {
    // .svelte files stay .svelte (preprocessed copy)
    if (rest.endsWith('.svelte')) return `./dist/${rest}`;
    // .ts -> .js
    if (rest.endsWith('.ts')) return `./dist/${rest.slice(0, -3)}.js`;
    return `./dist/${rest}`;
  }

  // fallback (main, module)
  if (rest.endsWith('.ts')) return `./dist/${rest.slice(0, -3)}.js`;
  return `./dist/${rest}`;
}

// Rewrite top-level main/types/module
if (pkg.main) pkg.main = srcToDist('import', pkg.main);
if (pkg.types) pkg.types = srcToDist('types', pkg.types);
if (pkg.module) pkg.module = srcToDist('import', pkg.module);

// Rewrite exports
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  if (typeof entry === 'string') {
    pkg.exports[subpath] = srcToDist('import', entry);
  } else {
    for (const field of ['types', 'svelte', 'import', 'require', 'default']) {
      if (entry[field]) entry[field] = srcToDist(field, entry[field]);
    }
  }
}

// Rewrite files: remove "src" from the files array (only dist goes into the tarball)
if (Array.isArray(pkg.files)) {
  pkg.files = pkg.files.filter(f => f !== 'src');
}

const out = JSON.stringify(pkg, null, 2) + '\n';

const writeFlag = process.argv.includes('--write');
if (writeFlag) {
  writeFileSync(pkgPath, out, 'utf8');
  process.stderr.write(`[make-publish-pkgjson] Rewrote ${pkgPath} to dist-form\n`);
} else {
  process.stdout.write(out);
}
