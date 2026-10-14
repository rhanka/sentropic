import { describe, expect, it } from 'vitest';

import { conformanceCapacity, conformanceScope } from './conformance/comments-conformance.js';
import {
  LIFECYCLE_ACTIONS,
  LIFECYCLE_OBJECT_KINDS,
  OPERATION_AUDIT_SUBJECTS,
  OperationAuditValidationError,
  createLifecycleEvent,
  createOperationAuditEvent,
  projectLifecycleState,
  type LifecycleEventRecord,
} from '../src/lifecycle.js';

const scope = conformanceScope();
const capacity = conformanceCapacity();

const lifecycleInput = (
  action: 'archive' | 'restore' | 'tombstone' | 'purge-intent' | 'purge-outcome',
  extra: Partial<{ archiveKind: 'shared' | 'personal'; objectKind: 'annotation' | 'thread' | 'comment'; objectId: string }> = {},
) => ({
  scope,
  objectKind: 'annotation' as const,
  objectId: 'ann_1',
  action,
  archiveKind: null,
  actor: { principal: 'admin_1' },
  reason: null,
  ...extra,
});

describe('annotation retention lifecycle', () => {
  it('closes the action and object-kind sets', () => {
    expect(LIFECYCLE_ACTIONS).toEqual(['archive', 'restore', 'tombstone', 'purge-intent', 'purge-outcome']);
    expect(LIFECYCLE_OBJECT_KINDS).toEqual(['annotation', 'thread', 'comment']);
  });

  it('projects reversible archives with their audience', () => {
    const chain: LifecycleEventRecord[] = [];
    chain.push(createLifecycleEvent(chain, lifecycleInput('archive', { archiveKind: 'personal' }), capacity));
    expect(projectLifecycleState(chain)).toMatchObject({ archived: true, archiveKind: 'personal', available: true, tombstoned: false, purge: 'none' });
    chain.push(createLifecycleEvent(chain, lifecycleInput('restore'), capacity));
    expect(projectLifecycleState(chain)).toMatchObject({ archived: false, archiveKind: null, available: true });
  });

  it('makes tombstones irreversible and keeps purge explicit', () => {
    const chain: LifecycleEventRecord[] = [];
    chain.push(createLifecycleEvent(chain, lifecycleInput('tombstone'), capacity));
    expect(projectLifecycleState(chain)).toMatchObject({ tombstoned: true, available: false, purge: 'none' });
    expect(() => createLifecycleEvent(chain, lifecycleInput('archive', { archiveKind: 'shared' }), capacity)).toThrowError(
      expect.objectContaining({ code: 'tombstoned' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('restore'), capacity)).toThrowError(
      expect.objectContaining({ code: 'tombstoned' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('tombstone'), capacity)).toThrowError(
      expect.objectContaining({ code: 'tombstoned' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('purge-outcome'), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
    chain.push(createLifecycleEvent(chain, lifecycleInput('purge-intent'), capacity));
    expect(projectLifecycleState(chain).purge).toBe('intended');
    chain.push(createLifecycleEvent(chain, lifecycleInput('purge-outcome'), capacity));
    expect(projectLifecycleState(chain)).toMatchObject({ purge: 'purged', available: false });
  });

  it('requires an archive audience only for archive actions', () => {
    const chain: LifecycleEventRecord[] = [];
    expect(() => createLifecycleEvent(chain, lifecycleInput('archive'), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-archive-kind' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('tombstone', { archiveKind: 'shared' } as never), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-archive-kind' }),
    );
  });

  it('scopes each lifecycle chain to one object', () => {
    const chain: LifecycleEventRecord[] = [];
    chain.push(createLifecycleEvent(chain, lifecycleInput('archive', { archiveKind: 'shared' }), capacity));
    expect(() => createLifecycleEvent(chain, lifecycleInput('restore', { objectId: 'ann_2' }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('restore', { objectKind: 'thread' } as never), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
    expect(() =>
      createLifecycleEvent([], { ...lifecycleInput('tombstone'), scope: { tenantId: 'tenant-other', workspaceId: 'ws-a' } }, capacity),
    ).not.toThrow();
  });
});

describe('operation audit events', () => {
  const auditInput = (
    subject: 'assignment' | 'discussion-state' | 'archive' | 'account-association',
    extra: Partial<{ operation: string; audience: string[] }> = {},
  ) => ({
    scope,
    subject,
    subjectId: 'subject_1',
    operation: 'assign',
    principal: 'admin_1',
    audience: ['principal_1'],
    detail: null,
    ...extra,
  });

  it('closes the audit subject set and chains per subject', () => {
    expect(OPERATION_AUDIT_SUBJECTS).toEqual(['assignment', 'discussion-state', 'archive', 'account-association']);
    const first = createOperationAuditEvent([], auditInput('assignment'), capacity);
    expect(first.link).toEqual({ sequence: 1, previousHash: null });
    const second = createOperationAuditEvent([first], auditInput('assignment', { operation: 'reassign' }), capacity);
    expect(second.link).toEqual({ sequence: 2, previousHash: first.hash });
    expect(() => createOperationAuditEvent([first], auditInput('archive'), capacity)).toThrowError(OperationAuditValidationError);
    expect(() => createOperationAuditEvent([first], auditInput('assignment', { subjectId: 'subject_2' } as never), capacity)).toThrowError(
      OperationAuditValidationError,
    );
  });

  it('requires non-empty principals and audience members', () => {
    expect(() => createOperationAuditEvent([], auditInput('assignment', { operation: '' }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-audit' }),
    );
    expect(() => createOperationAuditEvent([], auditInput('assignment', { audience: [''] }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-audit' }),
    );
    expect(() => createOperationAuditEvent([], { ...auditInput('assignment'), principal: '' }, capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-audit' }),
    );
  });
});

import {
  SubmissionValidationError,
  createPreparedSubmissionManifest,
  recoverPreparedSubmissionReceipt,
  verifyPreparedSubmission,
} from '../src/submissions.js';

describe('prepared submissions', () => {
  const manifestInput = (extra: Record<string, unknown> = {}) => ({
    scope,
    submissionId: 'sub_1',
    annotation: { annotationId: 'ann_1', revisionHash: 'a'.repeat(64) },
    selectedComments: [{ commentId: 'cmt_1', revisionHash: 'b'.repeat(64) }],
    selectedStructures: [{ threadId: 'thr_1', revisionHash: 'c'.repeat(64) }],
    captureDigests: ['capture-digest-1'],
    contractVersion: 'contract-v1',
    profileVersion: 'profile-v1',
    preparedBy: { principal: 'author_1' },
    ...extra,
  });

  it('creates standalone genesis manifests with a recoverable receipt', () => {
    const manifest = createPreparedSubmissionManifest(manifestInput(), capacity);
    expect(manifest.kind).toBe('prepared-submission-manifest');
    expect(manifest.hash).toMatch(/^[0-9a-f]{64}$/);
    const receipt = recoverPreparedSubmissionReceipt(manifest);
    expect(receipt.manifestHash).toBe(manifest.hash);
    expect(receipt.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPreparedSubmission(manifest)).toBe(true);
    expect(recoverPreparedSubmissionReceipt(manifest).manifestDigest).toBe(receipt.manifestDigest);
  });

  it('fails verification when a manifest field is forged', () => {
    const manifest = createPreparedSubmissionManifest(manifestInput(), capacity);
    const forged = { ...manifest, contractVersion: 'contract-v2' };
    expect(verifyPreparedSubmission(forged)).toBe(false);
    expect(() => verifyPreparedSubmission(forged)).not.toThrow();
  });

  it('rejects duplicate selections and incomplete manifests', () => {
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ selectedComments: [
        { commentId: 'cmt_1', revisionHash: 'b'.repeat(64) },
        { commentId: 'cmt_1', revisionHash: 'c'.repeat(64) },
      ] }), capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection' }));
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ selectedStructures: [
        { threadId: 'thr_1', revisionHash: 'b'.repeat(64) },
        { threadId: 'thr_1', revisionHash: 'c'.repeat(64) },
      ] }), capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection' }));
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ annotation: { annotationId: 'ann_1', revisionHash: '' } }), capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-manifest' }));
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ captureDigests: ['', 'd'] }), capacity),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection' }));
    expect(() => createPreparedSubmissionManifest(manifestInput({ submissionId: '' }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-manifest' }),
    );
  });

  it('keeps the selection order in the hashed manifest', () => {
    const first = createPreparedSubmissionManifest(manifestInput(), capacity);
    const reordered = createPreparedSubmissionManifest(manifestInput({
      selectedComments: [{ commentId: 'cmt_2', revisionHash: 'd'.repeat(64) }, { commentId: 'cmt_1', revisionHash: 'b'.repeat(64) }],
    }), capacity);
    expect(reordered.selectedComments.map((item) => item.commentId)).toEqual(['cmt_2', 'cmt_1']);
    expect(first.hash).not.toBe(reordered.hash);
    expect(() => createPreparedSubmissionManifest(manifestInput({ preparedBy: { principal: '' } }), capacity)).toThrowError(
      SubmissionValidationError,
    );
  });
});

describe('capacity enforcement in lifecycle, audit and submission constructors (SPEC 4.6)', () => {
  const auditInput = () => ({
    scope,
    subject: 'assignment' as const,
    subjectId: 'subject_1',
    operation: 'assign',
    principal: 'admin_1',
    audience: ['principal_1'],
    detail: null,
  });

  const manifestInput = () => ({
    scope,
    submissionId: 'sub_1',
    annotation: { annotationId: 'ann_1', revisionHash: 'a'.repeat(64) },
    selectedComments: [{ commentId: 'cmt_1', revisionHash: 'b'.repeat(64) }],
    selectedStructures: [{ threadId: 'thr_1', revisionHash: 'c'.repeat(64) }],
    captureDigests: ['capture-digest-1'],
    contractVersion: 'contract-v1',
    profileVersion: 'profile-v1',
    preparedBy: { principal: 'author_1' },
  });

  it('fails closed when the descriptor is missing or invalid', () => {
    expect(() => createLifecycleEvent([], lifecycleInput('archive', { archiveKind: 'shared' }), undefined as never)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() => createOperationAuditEvent([], auditInput('assignment'), undefined as never)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    expect(() => createPreparedSubmissionManifest(manifestInput(), undefined as never)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    const broken = { ...capacity, unitManifest: undefined } as never;
    expect(() => createLifecycleEvent([], lifecycleInput('tombstone'), broken)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
  });

  it('enforces the unitManifest bound over the manifest canonical bytes', () => {
    const tight = { ...capacity, unitManifest: { limit: 64, unit: 'canonical-bytes' as const } };
    expect(() => createPreparedSubmissionManifest(manifestInput(), tight)).toThrowError(
      expect.objectContaining({ code: 'capacity-exceeded' }),
    );
    const manifest = createPreparedSubmissionManifest(manifestInput(), capacity);
    expect(manifest.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never lets capacity values enter the event or manifest hash', () => {
    const tight = { ...capacity, unitManifest: { limit: 4096, unit: 'canonical-bytes' as const } };
    const withDefault = createLifecycleEvent([], lifecycleInput('archive', { archiveKind: 'shared' }), capacity);
    const withTight = createLifecycleEvent([], lifecycleInput('archive', { archiveKind: 'shared' }), tight);
    expect(withTight.hash).toBe(withDefault.hash);
  });
});
