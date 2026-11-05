/**
 * J1.1a — generic extension to MIME map (binding J1.0 relay).
 *
 * `.geojson` serves as `application/json`, `.mjs` as `text/javascript` and
 * `.woff2` as `font/woff2`; `.wasm` and `.pbf` stay mapped as the owner
 * asked, with no `wasm-unsafe-eval` anywhere in the served policies.
 */
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_TO_MIME,
  isWithinMimeCeiling,
  mimeTypeForPath,
  validateFileBytes,
} from '../src/server/mime.js';
import { BROWSER_EXTENSION_FALLBACK_MIME, renderUploadPage } from '../src/server/upload-page.js';

describe('extension to MIME map', () => {
  it.each([
    ['.geojson', 'application/json'],
    ['.mjs', 'text/javascript'],
    ['.woff2', 'font/woff2'],
    ['.wasm', 'application/wasm'],
    ['.pbf', 'application/x-protobuf'],
  ])('maps %s to %s', (ext, mime) => {
    expect(EXTENSION_TO_MIME[ext]).toBe(mime);
    expect(mimeTypeForPath(`file${ext}`)).toBe(mime);
  });

  it('keeps the map frozen and inside the server ceiling', () => {
    expect(Object.isFrozen(EXTENSION_TO_MIME)).toBe(true);
    for (const mime of Object.values(EXTENSION_TO_MIME)) {
      expect(isWithinMimeCeiling(mime)).toBe(true);
    }
  });

  it('resolves case-insensitively and stays undefined off-map', () => {
    expect(mimeTypeForPath('tiles/QUARTER.GEOJSON')).toBe('application/json');
    expect(mimeTypeForPath('no-extension')).toBeUndefined();
    expect(mimeTypeForPath('archive.zip')).toBeUndefined();
  });
});

describe('browser fallback map on the upload page', () => {
  it('covers the binding extensions with the binding types', () => {
    expect(BROWSER_EXTENSION_FALLBACK_MIME).toMatchObject({
      geojson: 'application/json',
      mjs: 'text/javascript',
      woff2: 'font/woff2',
      wasm: 'application/wasm',
      pbf: 'application/x-protobuf',
    });
  });

  it('renders the map into the page instead of a stale literal', () => {
    const page = renderUploadPage({ s3Origins: ['https://s3.example.test'] });
    expect(page).toContain(`const EXT_TYPES = ${JSON.stringify(BROWSER_EXTENSION_FALLBACK_MIME)};`);
    expect(page).not.toContain("woff2: 'font/woff'");
  });
});

describe('mapped byte validation', () => {
  it('accepts a JSON document served as .geojson', () => {
    expect(() => validateFileBytes('application/json',
      new TextEncoder().encode('{"type":"FeatureCollection","features":[]}'))).not.toThrow();
  });

  it('checks the wasm magic before any pin', () => {
    expect(() => validateFileBytes('application/wasm',
      new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))).not.toThrow();
    expect(() => validateFileBytes('application/wasm',
      new TextEncoder().encode('not a module'))).toThrow();
  });

  it('accepts opaque protobuf bytes for .pbf without sniffing', () => {
    expect(() => validateFileBytes('application/x-protobuf',
      new Uint8Array([0x0a, 0x03, 0x08, 0x96, 0x01]))).not.toThrow();
  });
});
