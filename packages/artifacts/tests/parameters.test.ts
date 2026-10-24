/**
 * L-5a — provider parameters: schema-validated non-secret values.
 *
 * A parameter schema declares the generic settings a provider accepts
 * (string/number/boolean/enum, required or defaulted). Validation applies
 * defaults, rejects unknown keys, wrong types and missing required values,
 * and refuses secret-looking keys: provider parameters are never a secret
 * store. Schemas are independent; values validated under one schema never
 * leak into another.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  defineParameters,
  validateParameters,
} from '../src/parameters.js';
let compileArtifactsProfile: typeof import('../src/profile/index.js').compileArtifactsProfile;
let RADAR_ARTIFACTS_PROFILE: typeof import('../src/profile/index.js').RADAR_ARTIFACTS_PROFILE;

const SCHEMA = defineParameters([
  { key: 'title', type: 'string', required: true },
  { key: 'theme', type: 'enum', values: ['light', 'dark'], default: 'light' },
  { key: 'pageSize', type: 'number', default: 20 },
  { key: 'showSource', type: 'boolean', default: false },
]);

describe('provider parameters', () => {
  it('applies defaults and accepts valid values', () => {
    expect(validateParameters(SCHEMA, { title: 'Hello' })).toEqual({
      title: 'Hello',
      theme: 'light',
      pageSize: 20,
      showSource: false,
    });
    expect(
      validateParameters(SCHEMA, { title: 'Hi', theme: 'dark', pageSize: 5, showSource: true }),
    ).toEqual({ title: 'Hi', theme: 'dark', pageSize: 5, showSource: true });
  });

  it('rejects unknown keys, wrong types and missing required values', () => {
    expect(() => validateParameters(SCHEMA, { title: 'Hi', unknown: 1 })).toThrow(/unknown parameter/);
    expect(() => validateParameters(SCHEMA, { title: 'Hi', pageSize: 'many' })).toThrow(
      /pageSize/,
    );
    expect(() => validateParameters(SCHEMA, { title: 'Hi', theme: 'blue' })).toThrow(/theme/);
    expect(() => validateParameters(SCHEMA, {})).toThrow(/title/);
  });

  it('refuses secret-looking keys fail-closed', () => {
    expect(() => validateParameters(SCHEMA, { title: 'Hi', apiSecret: 'x' })).toThrow(/secret/);
    expect(() => validateParameters(SCHEMA, { title: 'Hi', clientToken: 'x' })).toThrow(/secret/);
    expect(() => validateParameters(SCHEMA, { title: 'Hi', dbPassword: 'x' })).toThrow(/secret/);
  });

  it('rejects duplicate and empty declarations at definition time', () => {
    expect(() =>
      defineParameters([
        { key: 'a', type: 'string' },
        { key: 'a', type: 'number' },
      ]),
    ).toThrow(/duplicate/);
    expect(() => defineParameters([{ key: '', type: 'string' }])).toThrow(/key/);
    expect(() => defineParameters([{ key: 'e', type: 'enum', values: [] }])).toThrow(/values/);
  });
});

describe('effective Radar arguments', () => {
  beforeEach(async () => {
    ({ compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } = await import('../src/profile/index.js'));
  });
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const ensure = (key: unknown = 'key', extra = {}) => ({ bindingName: 'view', idempotencyKey: key, ...extra });
  const publish = (extra = {}) => ({ artifactId: id, idempotencyKey: 'key',
    files: [{ path: 'index.html', mimeType: 'text/html', text: '' }], ...extra });
  const validate = (name: string, args: unknown, envelope?: string) =>
    compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE).validate(name, args, envelope);

  it('should apply effective defaults for minimal ensure, publish and list', () => {
    expect(validate('artifacts_ensure', ensure())).toEqual({ ...ensure(), parameters: {} });
    expect(validate('artifacts_publish', publish())).toEqual({ ...publish(), profile: {},
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: [] }] });
    expect(validate('artifacts_list', {})).toEqual({ limit: 20, offset: 0 });
    expect(validate('artifacts_get', { artifactId: id })).toEqual({ artifactId: id });
  });

  it('should refuse missing, blank, malformed UTF-16 and overlong keys on both writes', () => {
    for (const key of [undefined, null, 2, '', ' \t\n', 'k'.repeat(257), '🏠'.repeat(129), '\ud800', '\udfff']) {
      for (const [name, args] of [['artifacts_ensure', ensure('key', { idempotencyKey: key })], ['artifacts_publish', publish({ idempotencyKey: key })]]) {
        expect(() => validate(name as string, args)).toThrowError(
          expect.objectContaining({ status: 400, publicCode: 'invalid_request', retriable: false }),
        );
      }
    }
  });

  it('should preserve valid UTF-16 boundaries, whitespace and literal replacement characters', () => {
    for (const key of ['k'.repeat(256), '🏠'.repeat(128), ' \tcaller\n ', '\ufffd']) {
      expect(validate('artifacts_ensure', ensure(key)).idempotencyKey).toBe(key);
      expect(validate('artifacts_publish', publish({ idempotencyKey: key })).idempotencyKey).toBe(key);
    }
  });

  it('should bind the optional platform envelope to the argument without accepting envelope-only writes', () => {
    expect(validate('artifacts_ensure', ensure(' key '), ' key ').idempotencyKey).toBe(' key ');
    expect(() => validate('artifacts_ensure', ensure('key'), ' key ')).toThrow();
    expect(() => validate('artifacts_ensure', { bindingName: 'view' }, 'key')).toThrow();
    expect(() => validate('artifacts_publish', publish(), 'other')).toThrow();
  });

  it('should reject forged authority, hashes, provenance, nonempty parameters and nested profiles', () => {
    for (const field of ['actorId', 'ownerId', 'tenantId', 'storageScopeId', 'paramsHash', 'source', 'authorizeCommit']) {
      expect(() => validate('artifacts_ensure', ensure('key', { [field]: 'forged' }))).toThrow();
      expect(() => validate('artifacts_publish', publish({ [field]: 'forged' }))).toThrow();
    }
    expect(() => validate('artifacts_ensure', ensure('key', { parameters: { title: 'x' } }))).toThrow();
    expect(() => validate('artifacts_publish', publish({ profile: { nested: {} } }))).toThrow();
  });

  it('should retain prototype-named primitive profile entries as inert own data', () => {
    const profile = JSON.parse('{"__proto__":"x","constructor":3,"prototype":true,"nullable":null}');
    const normalized = validate('artifacts_publish', publish({ profile })).profile;
    expect(normalized).toEqual(profile);
    expect(Object.keys(normalized!)).toEqual(Object.keys(profile));
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
    expect(Object.hasOwn(normalized!, '__proto__')).toBe(true);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, 'nullable')).toBe(false);
  });

  it('should enforce binding, UUID and pagination bounds without normalization', () => {
    for (const bindingName of ['', 'x'.repeat(129), 4]) {
      expect(() => validate('artifacts_ensure', ensure('key', { bindingName }))).toThrow();
    }
    expect(validate('artifacts_ensure', ensure('key', { bindingName: ' ' })).bindingName).toBe(' ');
    expect(validate('artifacts_ensure', ensure('key', { bindingName: '🏠'.repeat(64) })).bindingName).toHaveLength(128);
    for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }]) {
      expect(() => validate('artifacts_list', args)).toThrow();
    }
    expect(() => validate('artifacts_get', { artifactId: id.toUpperCase() })).toThrow();
  });

  it('should reconcile path policies including UTF-8 ceiling, colon, DEL and reserved segments', () => {
    for (const path of ['', '.', '..', 'a//b', '/a', 'a/', 'a/../b', 'a\\b', 'a%b', 'a?b', 'a#b',
      'a:b', 'a\u007fb', 'a\u0000b', 'api/x', '__artifacts/x', 'livez/x', 'health/x', 'é'.repeat(513)]) {
      expect(() => validate('artifacts_publish', publish({ files: [{ path, mimeType: 'text/html', text: '' }] }))).toThrow();
    }
    expect(validate('artifacts_publish', publish({ files: [{ path: 'é'.repeat(512), mimeType: 'text/html', text: '' }] })).files).toHaveLength(1);
  });

  it('should enforce file count, uniqueness, closed entries, MIME and exclusive encoding', () => {
    const file = publish().files[0];
    expect(validate('artifacts_publish', publish({ files: Array.from({ length: 32 }, (_, n) => ({ ...file, path: String(n) })) })).files).toHaveLength(32);
    for (const files of [[], Array.from({ length: 33 }, (_, n) => ({ ...file, path: String(n) })),
      [file, file], [{ ...file, mimeType: 'image/png' }], [{ ...file, bytes: [] }],
      [{ path: 'a', mimeType: 'text/html' }], [{ ...file, source: 'forged' }],
      [{ ...file, text: '\ud800' }], [{ ...file, text: undefined, bytes: [256] }]]) {
      expect(() => validate('artifacts_publish', publish({ files }))).toThrow();
    }
  });

  it('should count decoded UTF-8 bytes per file and across the entire publication', () => {
    const file = { path: 'a', mimeType: 'text/html', text: 'é'.repeat(131072) };
    expect(validate('artifacts_publish', publish({ files: [file] })).files).toHaveLength(1);
    const bytes = { path: 'bytes', mimeType: 'application/json', bytes: Array(262144).fill(255) };
    expect(validate('artifacts_publish', publish({ files: [bytes] })).files).toHaveLength(1);
    expect(() => validate('artifacts_publish', publish({ files: [{ ...bytes, bytes: [...bytes.bytes, 0] }] }))).toThrow();
    expect(() => validate('artifacts_publish', publish({ files: [{ ...file, text: file.text + 'a' }] }))).toThrow();
    expect(() => validate('artifacts_publish', publish({ files: [file, { ...file, path: 'b', text: 'b' }] }))).toThrow();
    expect(() => validate('artifacts_publish', publish({ files: [{ path: 'a', mimeType: 'text/html', bytes: [1.5] }] }))).toThrow();
  });
});
