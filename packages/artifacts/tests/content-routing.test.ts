/**
 * L-5d — content routing (owner decision relayed by immo): one wildcard
 * per base with a single UUID label `<id>.<base>`, resolved server-side as
 * an artifact or a release. The old `<id>.pinned.<base>` form, two labels,
 * foreign bases and non-UUID labels never route; path normalization has no
 * traversal or hidden fallback.
 */
import { describe, expect, it } from 'vitest';
import {
  isServiceWorkerPath,
  parseContentHost,
  resolveContentPath,
} from '../src/content/routing.js';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const RELEASE = '22222222-2222-4222-8222-222222222222';
const BASE = 'pages.example.test';

describe('content routing', () => {
  it('parses exactly one UUID label as a converged id origin', () => {
    expect(parseContentHost(`${ARTIFACT}.${BASE}`, BASE)).toEqual({ kind: 'id', id: ARTIFACT });
    expect(parseContentHost(`${RELEASE}.${BASE}`, BASE)).toEqual({ kind: 'id', id: RELEASE });
    expect(parseContentHost(`${ARTIFACT}.${BASE}:8443`, BASE)).toEqual({ kind: 'id', id: ARTIFACT });
    expect(parseContentHost(`${ARTIFACT.toUpperCase()}.${BASE}`, BASE)).toEqual({ kind: 'id', id: ARTIFACT });
  });

  it('refuses the removed pinned form, two labels, foreign bases and non-UUID labels', () => {
    expect(parseContentHost(`${RELEASE}.pinned.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}.pinned.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}-${RELEASE}.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}.${RELEASE}.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}.pinned.extra.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}.evil.test`, BASE)).toBeUndefined();
    expect(parseContentHost(BASE, BASE)).toBeUndefined();
    expect(parseContentHost(`www.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`not-a-uuid.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost('', BASE)).toBeUndefined();
  });

  it('resolves content paths with an index default and no traversal', () => {
    expect(resolveContentPath('/')).toBe('index.html');
    expect(resolveContentPath('/index.html')).toBe('index.html');
    expect(resolveContentPath('/assets/app.js')).toBe('assets/app.js');
    expect(resolveContentPath('/docs/')).toBe('docs/index.html');
    expect(resolveContentPath('/../secret')).toBeUndefined();
    expect(resolveContentPath('/assets/../../secret')).toBeUndefined();
    expect(resolveContentPath('/assets//app.js')).toBeUndefined();
    expect(resolveContentPath('/assets\\app.js')).toBeUndefined();
    expect(resolveContentPath('assets/app.js')).toBeUndefined();
    expect(resolveContentPath('/%2e%2e/secret')).toBeUndefined();
  });

  it('detects service-worker paths so the handler can deny them', () => {
    expect(isServiceWorkerPath('service-worker.js')).toBe(true);
    expect(isServiceWorkerPath('sw.js')).toBe(true);
    expect(isServiceWorkerPath('assets/service-worker.js')).toBe(true);
    expect(isServiceWorkerPath('index.html')).toBe(false);
    expect(isServiceWorkerPath('assets/app.js')).toBe(false);
  });
});
