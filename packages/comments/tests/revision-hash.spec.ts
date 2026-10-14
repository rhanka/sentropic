import { describe, expect, it } from 'vitest';

import fixture from './fixtures/revision-hash-v1.json';
import { canonicalJson } from '../src/canonical-json.js';
import { sha256Hex } from '../src/sha256.js';
import {
  RECORD_KINDS,
  REVISION_HASH_VERSION,
  canonicalRecordBytes,
  hashRecord,
  isChainLink,
  validateChain,
} from '../src/revision-hash.js';
import { quantizeMillionths, validateBox, validateCircle } from '../src/geometry.js';

type Frame = { width: number; height: number; digest: string };
type BoxInput = { kind: 'box'; x: string; y: string; width: string; height: string };
type CircleInput = { kind: 'circle'; cx: string; cy: string; r: string };
type GeometryVector = {
  id: string;
  input?: string | BoxInput | CircleInput;
  millionths?: number;
  frame?: Frame;
  quantized?: Record<string, unknown>;
};

const corpus = fixture as {
  hashVersion: string;
  records: Array<{ id: string; kind: string; envelope: Record<string, unknown>; canonical: string; digest: string }>;
  canonicalVectors: Array<{ id: string; value: unknown; canonical: string; digest: string }>;
  geometry: GeometryVector[];
};

describe('revision-hash-v1 corpus', () => {
  it('pins the corpus hash version', () => {
    expect(corpus.hashVersion).toBe(REVISION_HASH_VERSION);
  });

  it('covers every declared record kind exactly once', () => {
    const kinds = corpus.records.map((record) => record.kind);
    expect(new Set(kinds)).toEqual(new Set(RECORD_KINDS));
    expect(kinds.length).toBe(RECORD_KINDS.length);
  });

  it('reproduces every record canonical bytes and digest', () => {
    for (const record of corpus.records) {
      expect(canonicalRecordBytes(record.kind as never, record.envelope)).toBe(record.canonical);
      expect(hashRecord(record.kind as never, record.envelope)).toBe(record.digest);
    }
  });

  it('reproduces every standalone canonical vector', () => {
    for (const vector of corpus.canonicalVectors) {
      expect(canonicalJson(vector.value)).toBe(vector.canonical);
      expect(sha256Hex(vector.canonical)).toBe(vector.digest);
    }
  });

  it('serializes negative zero as zero and rejects unserializable values', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(() => canonicalJson(0.5)).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson(String.fromCharCode(0xd800))).toThrow();
  });

  it('hashes empty and short strings against known digests', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('geometry corpus', () => {
  it('quantizes decimal strings to exact millionths with ties upward', () => {
    for (const vector of corpus.geometry) {
      if (vector.millionths !== undefined) {
        expect(quantizeMillionths(vector.input as string)).toBe(vector.millionths);
      }
    }
  });

  it('validates boxes with exact endpoint arithmetic', () => {
    for (const vector of corpus.geometry) {
      const quantized = vector.quantized as { kind?: string } | undefined;
      if (quantized?.kind === 'box') {
        const entry = vector as unknown as { frame: Frame; input: BoxInput };
        expect(validateBox(entry.frame, entry.input)).toEqual(vector.quantized);
      }
    }
  });

  it('validates circles including the complete shorter dimension', () => {
    for (const vector of corpus.geometry) {
      const quantized = vector.quantized as { kind?: string } | undefined;
      if (quantized?.kind === 'circle') {
        const entry = vector as unknown as { frame: Frame; input: CircleInput };
        expect(validateCircle(entry.frame, entry.input)).toEqual(vector.quantized);
      }
    }
  });
});

type Rejection = {
  id: string;
  code: string;
  input?: string;
  frame?: Frame;
  value?: unknown;
  charCodes?: number[];
  kind?: string;
};

describe('corpus rejections', () => {
  const rejections = (fixture as { rejections: Rejection[] }).rejections;

  it('rejects invalid decimal grammar without normalization', () => {
    for (const rejection of rejections) {
      if (rejection.id.startsWith('decimal-')) {
      expect(() => quantizeMillionths(rejection.input as string)).toThrowError(expect.objectContaining({ code: rejection.code }));
      }
    }
  });

  it('rejects out-of-frame circles and collapsed boxes', () => {
    for (const rejection of rejections) {
      if (rejection.id === 'circle-overflow-200x100') {
        const input = rejection as unknown as { frame: Frame; input: CircleInput };
        expect(() => validateCircle(input.frame, input.input)).toThrowError(expect.objectContaining({ code: rejection.code }));
      }
      if (rejection.id === 'box-collapse') {
        const input = rejection as unknown as { frame: Frame; input: BoxInput };
        expect(() => validateBox(input.frame, input.input)).toThrowError(expect.objectContaining({ code: rejection.code }));
      }
    }
  });

  it('rejects unserializable envelope values and closed-kind violations', () => {
    for (const rejection of rejections) {
      if (rejection.charCodes !== undefined) {
        const text = String.fromCharCode(...rejection.charCodes);
        expect(() => hashRecord('review-event', { actor: { principal: text } })).toThrowError(
          expect.objectContaining({ code: rejection.code }),
        );
      } else if (rejection.value !== undefined) {
        expect(() => hashRecord('review-event', { actor: { principal: 'p' }, score: rejection.value })).toThrowError(
          expect.objectContaining({ code: rejection.code }),
        );
      } else if (rejection.id === 'envelope-kind-override') {
        expect(() => hashRecord('review-event', { kind: 'other' })).toThrowError(
          expect.objectContaining({ code: rejection.code }),
        );
      } else if (rejection.id === 'unknown-record-kind') {
        expect(() => hashRecord(rejection.kind as never, {})).toThrowError(
          expect.objectContaining({ code: rejection.code }),
        );
      }
    }
  });
});

describe('chain validation', () => {
  const link = (sequence: number, previousHash: string | null) => ({ sequence, previousHash });
  const digestOf = (seed: string) => sha256Hex(seed);

  it('accepts a well-formed chain and rejects gaps and broken links', () => {
    const h1 = digestOf('chain-1');
    const h2 = digestOf('chain-2');
    const h3 = digestOf('chain-3');
    expect(() =>
      validateChain([
        { kind: 'annotation-revision', link: link(1, null), hash: h1 },
        { kind: 'annotation-revision', link: link(2, h1), hash: h2 },
        { kind: 'annotation-revision', link: link(3, h2), hash: h3 },
      ]),
    ).not.toThrow();
    expect(() =>
      validateChain([
        { kind: 'annotation-revision', link: link(1, null), hash: h1 },
        { kind: 'annotation-revision', link: link(3, h1), hash: h2 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'chain-broken' }));
    expect(() =>
      validateChain([
        { kind: 'annotation-revision', link: link(1, null), hash: h1 },
        { kind: 'annotation-revision', link: link(2, h3), hash: h2 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'chain-broken' }));
  });

  it('rejects repeated digests and kind substitution inside a chain', () => {
    const h1 = digestOf('cycle-1');
    expect(() =>
      validateChain([
        { kind: 'comment-revision', link: link(1, null), hash: h1 },
        { kind: 'comment-revision', link: link(2, h1), hash: h1 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'chain-cycle' }));
    expect(() =>
      validateChain(
        [
          { kind: 'annotation-revision', link: link(1, null), hash: h1 },
          { kind: 'review-event', link: link(2, h1), hash: digestOf('mixed-2') },
        ],
        { expectedKind: 'annotation-revision' },
      ),
    ).toThrowError(expect.objectContaining({ code: 'chain-broken' }));
  });

  it('rejects invalid links', () => {
    expect(isChainLink({ sequence: 0, previousHash: null })).toBe(false);
    expect(isChainLink({ sequence: 1, previousHash: '' })).toBe(false);
    expect(isChainLink({ sequence: 1.5, previousHash: null })).toBe(false);
    expect(isChainLink({ sequence: 2, previousHash: 'abc' })).toBe(true);
  });
});
