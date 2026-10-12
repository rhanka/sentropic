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
