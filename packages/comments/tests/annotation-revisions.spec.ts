import { describe, expect, it } from 'vitest';

import {
  conformanceBody,
  conformanceCapacity,
  conformanceProvenance,
  conformanceResource,
  conformanceScope,
  conformanceTarget,
  observedSource,
} from './conformance/comments-conformance.js';
import {
  STRUCTURAL_TRIGGERS,
  checkRevisionBodyCapacity,
  createAnnotationRevision,
  createCommentRevision,
  createThreadStructureRevision,
  validateCapacityDescriptor,
  validateRevisionBody,
  type AnnotationRevisionRecord,
  type CapacityDescriptor,
} from '../src/revisions.js';

const scope = conformanceScope();
const resource = conformanceResource(scope);
const capacity = conformanceCapacity();

const capacityWith = (overrides: Record<string, unknown> = {}): CapacityDescriptor => ({
  body: { limit: 16, unit: 'utf8-bytes' },
  segment: { limit: 8, unit: 'utf8-bytes' },
  profile: { limit: 96, unit: 'canonical-bytes' },
  unitManifest: { limit: 2048, unit: 'canonical-bytes' },
  unitPayload: { limit: 4096, unit: 'utf8-bytes' },
  batchUnits: { limit: 50, unit: 'units' },
  batchManifest: { limit: 8192, unit: 'canonical-bytes' },
  batchRequest: { limit: 65536, unit: 'canonical-bytes' },
  pageRecords: { limit: 100, unit: 'records' },
  pageEncodedBytes: { limit: 262144, unit: 'canonical-bytes' },
  ...overrides,
});

const annotationInput = (text: string) => ({
  scope,
  annotationId: 'ann_1',
  primary: conformanceTarget(resource),
  secondary: [],
  visualAnchors: [],
  body: conformanceBody(text),
  provenance: conformanceProvenance(),
});

describe('annotation revisions', () => {
  it('creates a genesis revision with sequence 1 and no predecessor', () => {
    const genesis = createAnnotationRevision(null, annotationInput('first body'), capacity);
    expect(genesis.kind).toBe('annotation-revision');
    expect(genesis.link).toEqual({ sequence: 1, previousHash: null });
    expect(genesis.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains revisions through the exact predecessor hash', () => {
    const genesis = createAnnotationRevision(null, annotationInput('first body'), capacity);
    const second = createAnnotationRevision(genesis, annotationInput('second body'), capacity);
    expect(second.link).toEqual({ sequence: 2, previousHash: genesis.hash });
    expect(second.hash).not.toBe(genesis.hash);
  });

  it('keeps the primary resource identity immutable across revisions', () => {
    const genesis = createAnnotationRevision(null, annotationInput('first body'), capacity);
    const moved = { ...annotationInput('second body'), primary: conformanceTarget(conformanceResource(scope, 'res_other')) };
    expect(() => createAnnotationRevision(genesis, moved, capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-targets' }),
    );
  });

  it('closes the structural trigger list and pins the thread annotation', () => {
    const threadInput = (trigger: string, annotationId: string | null) => ({
      scope,
      threadId: 'thr_1',
      trigger: trigger as never,
      primary: conformanceTarget(resource),
      annotationId,
      provenance: conformanceProvenance(),
    });
    const genesis = createThreadStructureRevision(null, threadInput('initial-registration', 'ann_1'), capacity);
    expect(genesis.link).toEqual({ sequence: 1, previousHash: null });
    expect(() => createThreadStructureRevision(null, threadInput('reply-added', null), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-trigger' }),
    );
    expect(() =>
      createThreadStructureRevision(genesis, threadInput('reanchoring', 'ann_other'), capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-pin' }));
    expect(STRUCTURAL_TRIGGERS).toContain('structural-association-change');
  });

  it('keeps the comment parent immutable and allows different annotation pins', () => {
    const thread = createThreadStructureRevision(null, {
      scope,
      threadId: 'thr_1',
      trigger: 'initial-registration',
      primary: conformanceTarget(resource),
      annotationId: null,
      provenance: conformanceProvenance(),
    }, capacity);
    const commentInput = (commentId: string, parent: string | null, pin: { annotationId: string; revisionHash: string } | null) => ({
      scope,
      threadId: 'thr_1',
      commentId,
      parentCommentId: parent,
      structureRevision: { id: 'thr_1', hash: thread.hash },
      annotationPin: pin,
      body: conformanceBody(`body of ${commentId}`),
      provenance: conformanceProvenance(),
    });
    const genesis = createCommentRevision(null, commentInput('cmt_1', null, null), capacity);
    expect(genesis.link).toEqual({ sequence: 1, previousHash: null });
    expect(() =>
      createCommentRevision(genesis, commentInput('cmt_1', 'cmt_0', null), capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-pin' }));
    expect(() =>
      createCommentRevision(null, commentInput('cmt_bad', null, { annotationId: 'ann_1', revisionHash: '' }), capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-pin' }));
    const ann = createAnnotationRevision(null, annotationInput('pinned body'), capacity);
    const oldPin = createCommentRevision(null, commentInput('cmt_old', null, { annotationId: 'ann_1', revisionHash: ann.hash }), capacity);
    const revised = createAnnotationRevision(ann, annotationInput('revised body'), capacity);
    const newPin = createCommentRevision(null, commentInput('cmt_new', null, { annotationId: 'ann_1', revisionHash: revised.hash }), capacity);
    expect(oldPin.annotationPin?.revisionHash).not.toBe(newPin.annotationPin?.revisionHash);
  });

  it('hashes revisions differently when only content changes', () => {
    const a: AnnotationRevisionRecord = createAnnotationRevision(null, annotationInput('same'), capacity);
    const b = createAnnotationRevision(null, { ...annotationInput('same'), annotationId: 'ann_2' }, capacity);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('revision content validation', () => {
  const body = (overrides: Record<string, unknown>) => ({
    text: 'hello world',
    codec: { format: 'plain', codecId: 'plain-v1', specDigest: 'spec-1', extensions: [] },
    ...overrides,
  });

  it('counts offsets in code points, not UTF-16 units', () => {
    const astral = 'a😀b';
    const valid = createAnnotationRevision(null, {
      ...annotationInput('astral'),
      body: { ...conformanceBody(astral), segments: [{ start: 1, end: 3, digest: 'seg-1' }] },
    }, capacity);
    expect(valid.body.segments).toEqual([{ start: 1, end: 3, digest: 'seg-1' }]);
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('astral'),
        body: { ...conformanceBody(astral), segments: [{ start: 1, end: 4, digest: 'seg-1' }] },
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
  });

  it('rejects overlapping segments and unmatched mention text', () => {
    const text = 'hello @ada and @bob today';
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('mentions'),
        body: {
          ...conformanceBody(text),
          segments: [
            { start: 0, end: 5, digest: 'seg-1' },
            { start: 3, end: 9, digest: 'seg-2' },
          ],
        },
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('mentions'),
        body: {
          ...conformanceBody(text),
          mentions: [{ principal: 'ada', displayText: '@bob', start: 6, end: 10 }],
        },
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-mentions' }));
    const withMention = createAnnotationRevision(null, {
      ...annotationInput('mentions'),
      body: {
        ...conformanceBody(text),
        mentions: [{ principal: 'ada', displayText: '@ada', start: 6, end: 10 }],
      },
    }, capacity);
    expect(withMention.body.mentions).toEqual([{ principal: 'ada', displayText: '@ada', start: 6, end: 10 }]);
  });

  it('rejects float and non-integer codec/profile values', () => {
    expect(() => createAnnotationRevision(null, { ...annotationInput('codec'), body: body({ codec: { format: 'html', codecId: 'x', specDigest: 'd', extensions: [] } }) }, capacity))
      .toThrowError(expect.objectContaining({ code: 'invalid-body' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('profile'),
        body: body({ profile: { schemaId: 's', version: '1', digest: 'd', fields: { score: 0.5 } } }),
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
  });

  it('validates semantic profile fields recursively and rejects arrays', () => {
    const profile = (fields: Record<string, unknown>) =>
      body({ profile: { schemaId: 's', version: '1', digest: 'd', fields } });
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('profile'),
        body: profile({ group: { score: 1, ratio: 0.25 } }),
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('profile'),
        body: profile({ outer: { inner: { depth: Number.MAX_SAFE_INTEGER + 1 } } }),
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
    expect(() =>
      createAnnotationRevision(null, { ...annotationInput('profile'), body: profile({ list: [1, 2] }) }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
    const nested = createAnnotationRevision(null, {
      ...annotationInput('profile'),
      body: profile({ group: { score: 1, flag: true, note: 'ok' }, top: null, label: 'x' }),
    }, capacity);
    expect(nested.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects out-of-scope and duplicate targets', () => {
    const otherScopeResource = conformanceResource(conformanceScope('b'));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('targets'),
        secondary: [conformanceTarget(otherScopeResource)],
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-targets' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('targets'),
        secondary: [conformanceTarget(resource)],
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'duplicate-target' }));
  });

  it('validates provenance registration and attribution', () => {
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('prov'),
        provenance: { ...conformanceProvenance(), registration: { principal: 'author_1', registeredAt: 1717000000000.5 } },
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-provenance' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('prov'),
        provenance: {
          registration: { principal: 'author_1', registeredAt: 1717000000000 },
          attribution: { variant: 'unknown' },
        },
      }, capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-provenance' }));
    const aiAttributed = createAnnotationRevision(null, {
      ...annotationInput('prov'),
      provenance: {
        registration: { principal: 'author_1', registeredAt: 1717000000000 },
        attribution: { variant: 'ai', assertionClass: 'model-declared', evidence: 'model-run-1' },
        sourceTime: { lexical: '2024-05-30T12:00:00', dateKind: 'absolute', precision: 'second' },
      },
    }, capacity);
    expect(aiAttributed.provenance.attribution.variant).toBe('ai');
  });
});

describe('capacity descriptor (SPEC 4.6)', () => {
  const bodyOf = (text: string) => conformanceBody(text);

  it('accepts a complete descriptor with every SPEC 4.6 row', () => {
    const descriptor = capacityWith();
    expect(validateCapacityDescriptor(descriptor)).toBe(descriptor);
  });

  it('rejects missing, non-positive, float and wrongly-declared bounds', () => {
    expect(() => validateCapacityDescriptor(capacityWith({ body: undefined }))).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() => validateCapacityDescriptor(capacityWith({ segment: { limit: 0, unit: 'utf8-bytes' } }))).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() => validateCapacityDescriptor(capacityWith({ profile: { limit: 0.5, unit: 'canonical-bytes' } }))).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() => validateCapacityDescriptor(capacityWith({ body: { limit: 16, unit: 'canonical-bytes' } }))).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() => validateCapacityDescriptor(capacityWith({ batchUnits: { limit: 50, unit: 'records' } }))).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
  });

  it('enforces the body UTF-8 byte bound, counting bytes not characters', () => {
    expect(() => validateRevisionBody(bodyOf('0123456789abcdef'), capacityWith())).not.toThrow();
    expect(() => validateRevisionBody(bodyOf('0123456789abcdefg'), capacityWith())).toThrowError(
      expect.objectContaining({ code: 'capacity-exceeded' }),
    );
    const eightTwoByteChars = 'éééééééé';
    expect(() => validateRevisionBody(bodyOf(eightTwoByteChars), capacityWith())).not.toThrow();
    expect(() => validateRevisionBody(bodyOf(`${eightTwoByteChars}é`), capacityWith())).toThrowError(
      expect.objectContaining({ code: 'capacity-exceeded' }),
    );
  });

  it('enforces the distinct segment byte bound', () => {
    const segmented = { ...bodyOf('hello world'), segments: [{ start: 0, end: 5, digest: 'seg-1' }] };
    expect(() => validateRevisionBody(segmented, capacityWith())).not.toThrow();
    expect(() =>
      validateRevisionBody(segmented, capacityWith({ segment: { limit: 4, unit: 'utf8-bytes' } })),
    ).toThrowError(expect.objectContaining({ code: 'capacity-exceeded' }));
  });

  it('enforces the profile canonical byte bound', () => {
    const withProfile = {
      ...bodyOf('hello world'),
      profile: { schemaId: 'schema-1', version: '1', digest: 'digest-1', fields: { score: 1 } },
    };
    expect(() => validateRevisionBody(withProfile, capacityWith())).not.toThrow();
    expect(() =>
      validateRevisionBody(withProfile, capacityWith({ profile: { limit: 8, unit: 'canonical-bytes' } })),
    ).toThrowError(expect.objectContaining({ code: 'capacity-exceeded' }));
  });

  it('fails closed on an invalid descriptor before checking the body', () => {
    expect(() => checkRevisionBodyCapacity(bodyOf('hello'), capacityWith({ pageRecords: undefined }))).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
  });

  it('keeps standalone body validation unbounded without a descriptor', () => {
    expect(() => validateRevisionBody(bodyOf('a text far beyond any test bound'))).not.toThrow();
  });
});

describe('capacity enforcement in create* constructors (SPEC 4.6)', () => {
  const commentInput = (commentId: string, text: string) => ({
    scope,
    threadId: 'thr_1',
    commentId,
    parentCommentId: null,
    structureRevision: { id: 'thr_1', hash: 'f'.repeat(64) },
    annotationPin: null,
    body: conformanceBody(text),
    provenance: conformanceProvenance(),
  });

  it('fails closed when a constructor receives no descriptor', () => {
    expect(() => createAnnotationRevision(null, annotationInput('short body'), undefined as never)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() => createCommentRevision(null, commentInput('cmt_x', 'short body'), undefined as never)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() =>
      createThreadStructureRevision(
        null,
        {
          scope,
          threadId: 'thr_x',
          trigger: 'initial-registration',
          primary: conformanceTarget(resource),
          annotationId: null,
          provenance: conformanceProvenance(),
        },
        undefined as never,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-capacity' }));
  });

  it('rejects a body beyond the constructor-enforced bound', () => {
    expect(() => createAnnotationRevision(null, annotationInput('0123456789abcdef'), capacityWith())).not.toThrow();
    expect(() => createAnnotationRevision(null, annotationInput('0123456789abcdefg'), capacityWith())).toThrowError(
      expect.objectContaining({ code: 'capacity-exceeded' }),
    );
    expect(() =>
      createCommentRevision(null, commentInput('cmt_x', '0123456789abcdefg'), capacityWith()),
    ).toThrowError(expect.objectContaining({ code: 'capacity-exceeded' }));
  });

  it('never lets capacity values enter the record hash', () => {
    const strict = createAnnotationRevision(null, annotationInput('hashed body'), capacityWith());
    const loose = createAnnotationRevision(null, annotationInput('hashed body'), capacity);
    expect(strict.hash).toBe(loose.hash);
    expect(strict.link).toEqual(loose.link);
  });
});
