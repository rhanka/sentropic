/**
 * J1.1a — application CSP constant (owner decision 05/11, binding J1.0 CSP).
 *
 * The generic host offers two modes chosen by host configuration, never per
 * release: `safe` (the historic strict regime, default, bit-for-bit
 * unchanged) and `application` (the binding J1.0 policy below, kept in
 * `APPLICATION_HTML_CSP` so the conductor can relay adjustments).
 */
import { describe, expect, it } from 'vitest';
import {
  APPLICATION_HTML_CSP,
  contentHeaders,
} from '../src/content/headers.js';

const EXPECTED_APPLICATION_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data: blob:",
  'font-src': "'self'",
  'media-src': "'self' blob:",
  'connect-src': "'self'",
  'worker-src': "'self'",
  'child-src': "'self'",
  'frame-src': "'none'",
  'frame-ancestors': "'none'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
};

function directivesOf(csp: string): Record<string, string> {
  return Object.fromEntries(csp.split('; ').map((part) => {
    const space = part.indexOf(' ');
    return [part.slice(0, space), part.slice(space + 1)];
  }));
}

describe('application CSP constant', () => {
  it.each(Object.entries(EXPECTED_APPLICATION_DIRECTIVES))('locks directive %s', (directive, value) => {
    expect(directivesOf(APPLICATION_HTML_CSP)[directive]).toBe(value);
  });

  it('carries exactly the fourteen binding directives, nothing more', () => {
    expect(directivesOf(APPLICATION_HTML_CSP)).toEqual(EXPECTED_APPLICATION_DIRECTIVES);
  });

  it('never allows script eval or wasm compilation', () => {
    expect(APPLICATION_HTML_CSP).not.toContain('unsafe-eval');
    expect(APPLICATION_HTML_CSP).not.toContain('wasm-unsafe-eval');
  });

  it('never allows blob workers', () => {
    expect(directivesOf(APPLICATION_HTML_CSP)['worker-src']).toBe("'self'");
  });

  it('serves the constant on HTML in application mode', () => {
    const headers = contentHeaders({ mimeType: 'text/html', size: 12, mode: 'application' });
    expect(headers['content-security-policy']).toBe(APPLICATION_HTML_CSP);
  });

  it.each(['text/javascript', 'application/javascript', 'application/ecmascript', 'text/x-javascript'])(
    'should constrain workers served as %s without inheriting HTML inline hashes', (mimeType) => {
      const headers = contentHeaders({ mimeType, size: 12, mode: 'application', scriptHashes: ["'sha256-abc'"] });
      expect(headers['content-security-policy']).toBe(APPLICATION_HTML_CSP);
      expect(contentHeaders({ mimeType, size: 12, mode: 'safe' })['content-security-policy']).toBeUndefined();
    },
  );

  it('appends per-release inline hashes to script-src only', () => {
    const headers = contentHeaders({ mimeType: 'text/html', size: 12,
      mode: 'application', scriptHashes: ["'sha256-abc'", "'sha256-def'"] });
    expect(directivesOf(headers['content-security-policy']!)['script-src'])
      .toBe("'self' 'sha256-abc' 'sha256-def'");
    expect(directivesOf(headers['content-security-policy']!)['style-src'])
      .toBe("'self' 'unsafe-inline'");
  });

  it('refuses a malformed inline hash fail-closed', () => {
    expect(() => contentHeaders({ mimeType: 'text/html', size: 12,
      mode: 'application', scriptHashes: ['evil'] })).toThrow();
  });
});

describe('safe mode stays bit-for-bit', () => {
  it('keeps the historic strict policy as the default', () => {
    const headers = contentHeaders({ mimeType: 'text/html', size: 12 });
    expect(headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
      "font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; " +
      "frame-ancestors 'none'",
    );
    expect(headers['content-security-policy']).toMatchSnapshot();
  });

  it('treats the explicit safe mode exactly like the default', () => {
    expect(contentHeaders({ mimeType: 'text/html', size: 12, mode: 'safe' }))
      .toEqual(contentHeaders({ mimeType: 'text/html', size: 12 }));
  });
});
