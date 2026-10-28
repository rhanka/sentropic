import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlinePortable, assertPortable } from './portable.mjs';

test('should inline styles and entry scripts when producing an offline page', () => {
  const html = inlinePortable('<head><link rel="stylesheet" href="/assets/a.css"></head><script type="module" src="/assets/a.js"></script>',
    name => name.endsWith('.css') ? 'body{color:red}' : 'document.title="Ready"');
  assert.match(html, /<style/);
  assert.match(html, /document.title/);
  assert.match(html, /connect-src 'none'/);
  assertPortable(html + '<script>const fontStyle = `url(\'${fontData}\')`;</script>');
});
test('should reject a missing or permissive connect policy and non-inline resources', () => {
  for (const html of ['<head></head>', '<meta http-equiv="Content-Security-Policy" content="connect-src https:">']) {
    assert.throws(() => assertPortable(html), /CSP connect-src/);
  }
  for (const resource of ['<script src="https://example.com/a.js"></script>', '<img src="./image.png">']) {
    assert.throws(() => assertPortable(resource), /single-file/);
  }
});
test('should reject imports of assets when an entry is inlined', () => {
  for (const code of ['import("./assets/scene.js")', "import ( '/assets/scene.js')", 'import(`./assets/scene.js`)',
    'import x from "./assets/shared.js"', 'import "./assets/shared.js"',
    'import("./sibling-chunk.js")', 'import(chunkPath)']) {
    assert.throws(() => inlinePortable('<script type="module" src="/assets/a.js"></script>', () => code), /external dist asset/);
  }
  assert.throws(() => assertPortable('<style>body{background:url(./assets/a.png)}</style>'), /external dist asset/);
});
