// Lot 1 MAJEUR-N1: shared canonical staged codec (L3a v4.1 frozen §§5.1,
// 7.2-7.3; integrity note N1-N3, C01). Vectors are literal canonical
// encodings hashed here independently of the codec implementation.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import {
  deriveStagedDependencies,
  encodeStagedEffects,
  stagedCommitRoots,
  stagedEffectDigest,
  stagedFragmentDigest,
} from '../../src/storage/staged-codec.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const empty = (): AtomicUnit => ({
  guards: [],
  records: [],
  appends: [],
  updates: [],
  relationships: [],
  barriers: [],
  purgeIntents: [],
  indexWrites: [],
});

const append = (head: string | null): AtomicUnit => ({
  ...empty(),
  appends: [
    {
      chainId: 'c',
      record: { id: 'r', bytes: '{}', hash: 'h1' },
      expectation: head === null ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: head },
    },
  ],
});

const binding = {
  moduleId: 'comments' as const,
  scope: { tenantId: 't', workspaceId: 'w' },
  operationId: 'op',
  contractDigest: 'cd',
  sourceBoundary: 'sb',
};

describe('Lot 1 staged codec: independent vectors', () => {
  it('should encode an empty unit as the literal framed v1 vector', () => {
    const literal = '["staged-effects","v1",[],[],[],[],[],[],[],[],["absent"],[]]';
    expect(encodeStagedEffects(empty())).toBe(literal);
    expect(stagedEffectDigest(empty())).toBe(sha(literal));
  });

  it('should encode an append with its derived expectation dependency as the literal vector', () => {
    const literal =
      '["staged-effects","v1",[],[],[["append","c","r","{}","h1",["absent","0"]]],[],[],[],[],[],["absent"],' +
      '[["append-expectation","c","r",["absent","0"]]]]';
    expect(encodeStagedEffects(append(null))).toBe(literal);
  });

  it('should bind module, scope, operation, contract, boundary, ordinal and predecessor in the fragment digest', () => {
    const effect = sha('["staged-effects","v1",[],[],[],[],[],[],[],[],["absent"],[]]');
    const literal = `["staged-fragment","v1","comments","t","w","op","cd","sb","0",["null"],"${effect}"]`;
    expect(stagedFragmentDigest({ ...binding, ordinal: '0', predecessorHash: null }, empty())).toBe(sha(literal));
  });

  it('should commit roots over ordered fragments as literal vectors', () => {
    const effect = sha('["staged-effects","v1",[],[],[],[],[],[],[],[],["absent"],[]]');
    const roots = stagedCommitRoots([{ ordinal: '0', effects: empty() }]);
    expect(roots.effectRoot).toBe(sha(`["staged-effect-root","v1",[["0","${effect}"]]]`));
    expect(roots.dependencyRoot).toBe(sha('["staged-dependency-root","v1",[["0",[]]]]'));
  });
});

describe('Lot 1 staged codec: discrimination', () => {
  it('should change the effect digest when only a dependency changes', () => {
    expect(stagedEffectDigest(append(null))).not.toBe(stagedEffectDigest(append('h0')));
    expect(stagedCommitRoots([{ ordinal: '0', effects: append(null) }]).dependencyRoot).not.toBe(
      stagedCommitRoots([{ ordinal: '0', effects: append('h0') }]).dependencyRoot,
    );
  });

  it('should distinguish an absent module result from an empty present one', () => {
    const present: AtomicUnit = { ...empty(), moduleResult: { format: 'utf8', data: '' } };
    expect(stagedEffectDigest(present)).not.toBe(stagedEffectDigest(empty()));
  });

  it('should distinguish a null index result hash from the string "null"', () => {
    const write = (resultHash: string | null): AtomicUnit => ({
      ...empty(),
      indexWrites: [{ key: 'k', digest: 'd', resultIds: [], resultHash }],
    });
    expect(stagedEffectDigest(write(null))).not.toBe(stagedEffectDigest(write('null')));
  });

  it('should keep collection boundaries: one barrier with a comma differs from two barriers', () => {
    const one: AtomicUnit = { ...empty(), barriers: [{ boundary: 'a,b', reason: 'r' }] };
    const two: AtomicUnit = {
      ...empty(),
      barriers: [
        { boundary: 'a', reason: 'r' },
        { boundary: 'b', reason: 'r' },
      ],
    };
    expect(stagedEffectDigest(one)).not.toBe(stagedEffectDigest(two));
  });

  it('should change the fragment digest with each binding field and the predecessor', () => {
    const base = stagedFragmentDigest({ ...binding, ordinal: '1', predecessorHash: 'p' }, empty());
    const variants = [
      { ...binding, moduleId: 'engram-live' as const, ordinal: '1', predecessorHash: 'p' },
      { ...binding, scope: { tenantId: 't2', workspaceId: 'w' }, ordinal: '1', predecessorHash: 'p' },
      { ...binding, scope: { tenantId: 't', workspaceId: 'w2' }, ordinal: '1', predecessorHash: 'p' },
      { ...binding, operationId: 'op2', ordinal: '1', predecessorHash: 'p' },
      { ...binding, contractDigest: 'cd2', ordinal: '1', predecessorHash: 'p' },
      { ...binding, sourceBoundary: 'sb2', ordinal: '1', predecessorHash: 'p' },
      { ...binding, ordinal: '2', predecessorHash: 'p' },
      { ...binding, ordinal: '1', predecessorHash: 'q' },
    ];
    for (const variant of variants) expect(stagedFragmentDigest(variant, empty())).not.toBe(base);
  });

  it('should derive guard and append-expectation dependencies in effect order', () => {
    const unit: AtomicUnit = {
      ...append('h0'),
      guards: [
        { kind: 'head', chainId: 'g', hash: 'gh' },
        { kind: 'predicate', predicateId: 'p', dependency: 'd' },
      ],
    };
    expect(deriveStagedDependencies(unit)).toEqual([
      ['guard', ['head', 'g', 'gh']],
      ['guard', ['predicate', 'p', 'd']],
      ['append-expectation', 'c', 'r', ['head', 'h0']],
    ]);
  });
});
