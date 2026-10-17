/**
 * L-5d — content routing (spec-v8 §9 5d): stable artifact origin and
 * pinned release origin, each with a single UUID label (two concatenated
 * UUIDs refused); path normalization without traversal or hidden fallback.
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
  it('parses stable and pinned single-UUID origins', () => {
    expect(parseContentHost(`${ARTIFACT}.${BASE}`, BASE)).toEqual({
      kind: 'stable', artifactId: ARTIFACT,
    });
    expect(parseContentHost(`${RELEASE}.pinned.${BASE}`, BASE)).toEqual({
      kind: 'pinned', releaseId: RELEASE,
    });
    expect(parseContentHost(`${ARTIFACT}.${BASE}:8443`, BASE)).toEqual({
      kind: 'stable', artifactId: ARTIFACT,
    });
    expect(parseContentHost(`${ARTIFACT.toUpperCase()}.${BASE}`, BASE)).toEqual({
      kind: 'stable', artifactId: ARTIFACT,
    });
  });

  it('refuses concatenated UUIDs, foreign bases and non-UUID labels', () => {
    expect(parseContentHost(`${ARTIFACT}-${RELEASE}.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}.${RELEASE}.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}.evil.test`, BASE)).toBeUndefined();
    expect(parseContentHost(BASE, BASE)).toBeUndefined();
    expect(parseContentHost(`www.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`not-a-uuid.${BASE}`, BASE)).toBeUndefined();
    expect(parseContentHost(`${ARTIFACT}.pinned.extra.${BASE}`, BASE)).toBeUndefined();
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
