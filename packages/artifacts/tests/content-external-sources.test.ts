/**
 * Host-configured external sources (radar-immobilier AQX): a host may allow
 * exact HTTPS origins as frame sources (e.g. a privacy-enhanced video embed)
 * and as media/image sources (e.g. an object bucket) on HTML documents only.
 * Without the option every policy is bit-for-bit unchanged.
 */
import { describe, expect, it } from 'vitest';
import { APPLICATION_HTML_CSP, contentHeaders, withExternalSources } from '../src/content/headers.js';

const FRAME = 'https://www.youtube-nocookie.com';
const MEDIA = 'https://media.bucket.example';

function directivesOf(csp: string): Record<string, string> {
  return Object.fromEntries(csp.split('; ').map((part) => {
    const space = part.indexOf(' ');
    return [part.slice(0, space), part.slice(space + 1)];
  }));
}

describe('content external sources', () => {
  it('leaves both modes unchanged without the option or with empty lists', () => {
    const plain = contentHeaders({ mimeType: 'text/html', size: 1, mode: 'application' });
    expect(plain['content-security-policy']).toBe(APPLICATION_HTML_CSP);
    const empty = contentHeaders({ mimeType: 'text/html', size: 1, mode: 'application',
      externalSources: { frame: [], media: [] } });
    expect(empty['content-security-policy']).toBe(APPLICATION_HTML_CSP);
    const safe = contentHeaders({ mimeType: 'text/html', size: 1 })['content-security-policy'];
    expect(contentHeaders({ mimeType: 'text/html', size: 1, externalSources: {} })['content-security-policy']).toBe(safe);
  });

  it('adds the origins to frame-src, media-src and img-src only (application mode)', () => {
    const csp = contentHeaders({ mimeType: 'text/html', size: 1, mode: 'application',
      externalSources: { frame: [FRAME], media: [MEDIA] } })['content-security-policy']!;
    const expected = { ...directivesOf(APPLICATION_HTML_CSP),
      'frame-src': FRAME, 'media-src': `'self' blob: ${MEDIA}`, 'img-src': `'self' data: blob: ${MEDIA}` };
    expect(directivesOf(csp)).toEqual(expected);
  });

  it('adds missing directives in safe mode and keeps script hashes', () => {
    const safe = directivesOf(contentHeaders({ mimeType: 'text/html', size: 1,
      externalSources: { frame: [FRAME], media: [MEDIA] } })['content-security-policy']!);
    expect(safe['frame-src']).toBe(FRAME);
    expect(safe['media-src']).toBe(`'self' ${MEDIA}`);
    const hash = "'sha256-AAAA'";
    const hashed = contentHeaders({ mimeType: 'text/html', size: 1, mode: 'application', scriptHashes: [hash],
      externalSources: { frame: [FRAME] } })['content-security-policy']!;
    expect(directivesOf(hashed)['script-src']).toBe(`'self' ${hash}`);
  });

  it('never applies to non-HTML assets', () => {
    const js = contentHeaders({ mimeType: 'text/javascript', size: 1, mode: 'application',
      externalSources: { frame: [FRAME], media: [MEDIA] } });
    expect(js['content-security-policy']).toBe(APPLICATION_HTML_CSP);
    const svg = contentHeaders({ mimeType: 'image/svg+xml', size: 1, externalSources: { media: [MEDIA] } });
    expect(svg['content-security-policy']).toBe('sandbox');
  });

  it.each(['http://media.bucket.example', 'https://*.bucket.example', 'https://media.bucket.example/',
    'https://media.bucket.example/path', 'https://u:p@media.bucket.example', "'unsafe-inline'", '*'])(
    'refuses the non-origin value %s', (value) => {
      expect(() => withExternalSources(APPLICATION_HTML_CSP, { media: [value] })).toThrow(/invalid external source origin/);
    });
});
