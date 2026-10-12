import { describe, expect, it } from 'vitest';

import {
  conformanceBody,
  conformanceProvenance,
  conformanceResource,
  conformanceScope,
  conformanceTarget,
  observedSource,
} from './conformance/comments-conformance.js';
import {
  STRUCTURAL_TRIGGERS,
  createAnnotationRevision,
  createCommentRevision,
  createThreadStructureRevision,
  type AnnotationRevisionRecord,
} from '../src/revisions.js';

const scope = conformanceScope();
const resource = conformanceResource(scope);

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
    const genesis = createAnnotationRevision(null, annotationInput('first body'));
    expect(genesis.kind).toBe('annotation-revision');
    expect(genesis.link).toEqual({ sequence: 1, previousHash: null });
    expect(genesis.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains revisions through the exact predecessor hash', () => {
    const genesis = createAnnotationRevision(null, annotationInput('first body'));
    const second = createAnnotationRevision(genesis, annotationInput('second body'));
    expect(second.link).toEqual({ sequence: 2, previousHash: genesis.hash });
    expect(second.hash).not.toBe(genesis.hash);
  });

  it('keeps the primary resource identity immutable across revisions', () => {
    const genesis = createAnnotationRevision(null, annotationInput('first body'));
    const moved = { ...annotationInput('second body'), primary: conformanceTarget(conformanceResource(scope, 'res_other')) };
    expect(() => createAnnotationRevision(genesis, moved)).toThrowError(
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
    const genesis = createThreadStructureRevision(null, threadInput('initial-registration', 'ann_1'));
    expect(genesis.link).toEqual({ sequence: 1, previousHash: null });
    expect(() => createThreadStructureRevision(null, threadInput('reply-added', null))).toThrowError(
      expect.objectContaining({ code: 'invalid-trigger' }),
    );
    expect(() =>
      createThreadStructureRevision(genesis, threadInput('reanchoring', 'ann_other')),
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
    });
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
    const genesis = createCommentRevision(null, commentInput('cmt_1', null, null));
    expect(genesis.link).toEqual({ sequence: 1, previousHash: null });
    expect(() =>
      createCommentRevision(genesis, commentInput('cmt_1', 'cmt_0', null)),
    ).toThrowError(expect.objectContaining({ code: 'invalid-pin' }));
    expect(() =>
      createCommentRevision(null, commentInput('cmt_bad', null, { annotationId: 'ann_1', revisionHash: '' })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-pin' }));
    const ann = createAnnotationRevision(null, annotationInput('pinned body'));
    const oldPin = createCommentRevision(null, commentInput('cmt_old', null, { annotationId: 'ann_1', revisionHash: ann.hash }));
    const revised = createAnnotationRevision(ann, annotationInput('revised body'));
    const newPin = createCommentRevision(null, commentInput('cmt_new', null, { annotationId: 'ann_1', revisionHash: revised.hash }));
    expect(oldPin.annotationPin?.revisionHash).not.toBe(newPin.annotationPin?.revisionHash);
  });

  it('hashes revisions differently when only content changes', () => {
    const a: AnnotationRevisionRecord = createAnnotationRevision(null, annotationInput('same'));
    const b = createAnnotationRevision(null, { ...annotationInput('same'), annotationId: 'ann_2' });
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
    });
    expect(valid.body.segments).toEqual([{ start: 1, end: 3, digest: 'seg-1' }]);
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('astral'),
        body: { ...conformanceBody(astral), segments: [{ start: 1, end: 4, digest: 'seg-1' }] },
      }),
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
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('mentions'),
        body: {
          ...conformanceBody(text),
          mentions: [{ principal: 'ada', displayText: '@bob', start: 6, end: 10 }],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-mentions' }));
    const withMention = createAnnotationRevision(null, {
      ...annotationInput('mentions'),
      body: {
        ...conformanceBody(text),
        mentions: [{ principal: 'ada', displayText: '@ada', start: 6, end: 10 }],
      },
    });
    expect(withMention.body.mentions).toEqual([{ principal: 'ada', displayText: '@ada', start: 6, end: 10 }]);
  });

  it('rejects float and non-integer codec/profile values', () => {
    expect(() => createAnnotationRevision(null, { ...annotationInput('codec'), body: body({ codec: { format: 'html', codecId: 'x', specDigest: 'd', extensions: [] } }) }))
      .toThrowError(expect.objectContaining({ code: 'invalid-body' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('profile'),
        body: body({ profile: { schemaId: 's', version: '1', digest: 'd', fields: { score: 0.5 } } }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-body' }));
  });

  it('rejects out-of-scope and duplicate targets', () => {
    const otherScopeResource = conformanceResource(conformanceScope('b'));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('targets'),
        secondary: [conformanceTarget(otherScopeResource)],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-targets' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('targets'),
        secondary: [conformanceTarget(resource)],
      }),
    ).toThrowError(expect.objectContaining({ code: 'duplicate-target' }));
  });

  it('validates provenance registration and attribution', () => {
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('prov'),
        provenance: { ...conformanceProvenance(), registration: { principal: 'author_1', registeredAt: 1717000000000.5 } },
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-provenance' }));
    expect(() =>
      createAnnotationRevision(null, {
        ...annotationInput('prov'),
        provenance: {
          registration: { principal: 'author_1', registeredAt: 1717000000000 },
          attribution: { variant: 'unknown' },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-provenance' }));
    const aiAttributed = createAnnotationRevision(null, {
      ...annotationInput('prov'),
      provenance: {
        registration: { principal: 'author_1', registeredAt: 1717000000000 },
        attribution: { variant: 'ai', assertionClass: 'model-declared', evidence: 'model-run-1' },
        sourceTime: { lexical: '2024-05-30T12:00:00', dateKind: 'absolute', precision: 'second' },
      },
    });
    expect(aiAttributed.provenance.attribution.variant).toBe('ai');
  });
});
