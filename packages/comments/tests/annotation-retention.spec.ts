import { describe, expect, it } from 'vitest';

import { conformanceScope } from './conformance/comments-conformance.js';
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
    chain.push(createLifecycleEvent(chain, lifecycleInput('archive', { archiveKind: 'personal' })));
    expect(projectLifecycleState(chain)).toMatchObject({ archived: true, archiveKind: 'personal', available: true, tombstoned: false, purge: 'none' });
    chain.push(createLifecycleEvent(chain, lifecycleInput('restore')));
    expect(projectLifecycleState(chain)).toMatchObject({ archived: false, archiveKind: null, available: true });
  });

  it('makes tombstones irreversible and keeps purge explicit', () => {
    const chain: LifecycleEventRecord[] = [];
    chain.push(createLifecycleEvent(chain, lifecycleInput('tombstone')));
    expect(projectLifecycleState(chain)).toMatchObject({ tombstoned: true, available: false, purge: 'none' });
    expect(() => createLifecycleEvent(chain, lifecycleInput('archive', { archiveKind: 'shared' }))).toThrowError(
      expect.objectContaining({ code: 'tombstoned' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('restore'))).toThrowError(
      expect.objectContaining({ code: 'tombstoned' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('tombstone'))).toThrowError(
      expect.objectContaining({ code: 'tombstoned' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('purge-outcome'))).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
    chain.push(createLifecycleEvent(chain, lifecycleInput('purge-intent')));
    expect(projectLifecycleState(chain).purge).toBe('intended');
    chain.push(createLifecycleEvent(chain, lifecycleInput('purge-outcome')));
    expect(projectLifecycleState(chain)).toMatchObject({ purge: 'purged', available: false });
  });

  it('requires an archive audience only for archive actions', () => {
    const chain: LifecycleEventRecord[] = [];
    expect(() => createLifecycleEvent(chain, lifecycleInput('archive'))).toThrowError(
      expect.objectContaining({ code: 'invalid-archive-kind' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('tombstone', { archiveKind: 'shared' } as never))).toThrowError(
      expect.objectContaining({ code: 'invalid-archive-kind' }),
    );
  });

  it('scopes each lifecycle chain to one object', () => {
    const chain: LifecycleEventRecord[] = [];
    chain.push(createLifecycleEvent(chain, lifecycleInput('archive', { archiveKind: 'shared' })));
    expect(() => createLifecycleEvent(chain, lifecycleInput('restore', { objectId: 'ann_2' }))).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
    expect(() => createLifecycleEvent(chain, lifecycleInput('restore', { objectKind: 'thread' } as never))).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
    expect(() =>
      createLifecycleEvent([], { ...lifecycleInput('tombstone'), scope: { tenantId: 'tenant-other', workspaceId: 'ws-a' } }),
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
    const first = createOperationAuditEvent([], auditInput('assignment'));
    expect(first.link).toEqual({ sequence: 1, previousHash: null });
    const second = createOperationAuditEvent([first], auditInput('assignment', { operation: 'reassign' }));
    expect(second.link).toEqual({ sequence: 2, previousHash: first.hash });
    expect(() => createOperationAuditEvent([first], auditInput('archive'))).toThrowError(OperationAuditValidationError);
    expect(() => createOperationAuditEvent([first], auditInput('assignment', { subjectId: 'subject_2' } as never))).toThrowError(
      OperationAuditValidationError,
    );
  });

  it('requires non-empty principals and audience members', () => {
    expect(() => createOperationAuditEvent([], auditInput('assignment', { operation: '' }))).toThrowError(
      expect.objectContaining({ code: 'invalid-audit' }),
    );
    expect(() => createOperationAuditEvent([], auditInput('assignment', { audience: [''] }))).toThrowError(
      expect.objectContaining({ code: 'invalid-audit' }),
    );
    expect(() => createOperationAuditEvent([], { ...auditInput('assignment'), principal: '' })).toThrowError(
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
    const manifest = createPreparedSubmissionManifest(manifestInput());
    expect(manifest.kind).toBe('prepared-submission-manifest');
    expect(manifest.hash).toMatch(/^[0-9a-f]{64}$/);
    const receipt = recoverPreparedSubmissionReceipt(manifest);
    expect(receipt.manifestHash).toBe(manifest.hash);
    expect(receipt.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPreparedSubmission(manifest)).toBe(true);
    expect(recoverPreparedSubmissionReceipt(manifest).manifestDigest).toBe(receipt.manifestDigest);
  });

  it('fails verification when a manifest field is forged', () => {
    const manifest = createPreparedSubmissionManifest(manifestInput());
    const forged = { ...manifest, contractVersion: 'contract-v2' };
    expect(verifyPreparedSubmission(forged)).toBe(false);
    expect(() => verifyPreparedSubmission(forged)).not.toThrow();
  });

  it('rejects duplicate selections and incomplete manifests', () => {
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ selectedComments: [
        { commentId: 'cmt_1', revisionHash: 'b'.repeat(64) },
        { commentId: 'cmt_1', revisionHash: 'c'.repeat(64) },
      ] })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection' }));
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ selectedStructures: [
        { threadId: 'thr_1', revisionHash: 'b'.repeat(64) },
        { threadId: 'thr_1', revisionHash: 'c'.repeat(64) },
      ] })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection' }));
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ annotation: { annotationId: 'ann_1', revisionHash: '' } })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-manifest' }));
    expect(() =>
      createPreparedSubmissionManifest(manifestInput({ captureDigests: ['', 'd'] })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection' }));
    expect(() => createPreparedSubmissionManifest(manifestInput({ submissionId: '' }))).toThrowError(
      expect.objectContaining({ code: 'invalid-manifest' }),
    );
  });

  it('keeps the selection order in the hashed manifest', () => {
    const first = createPreparedSubmissionManifest(manifestInput());
    const reordered = createPreparedSubmissionManifest(manifestInput({
      selectedComments: [{ commentId: 'cmt_2', revisionHash: 'd'.repeat(64) }, { commentId: 'cmt_1', revisionHash: 'b'.repeat(64) }],
    }));
    expect(reordered.selectedComments.map((item) => item.commentId)).toEqual(['cmt_2', 'cmt_1']);
    expect(first.hash).not.toBe(reordered.hash);
    expect(() => createPreparedSubmissionManifest(manifestInput({ preparedBy: { principal: '' } }))).toThrowError(
      SubmissionValidationError,
    );
  });
});
