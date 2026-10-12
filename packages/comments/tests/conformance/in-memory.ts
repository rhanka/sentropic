/**
 * In-memory CanonicalCommandStore for conformance runs.
 *
 * Test-only driver behind the canonical port: chains keyed by full scope,
 * compare-and-swap appends with exactly one winner per concurrent head, and an
 * idempotency index whose writes are atomic with the appends they record. No
 * production code imports this module.
 */

import type { IdempotencyKey } from '@sentropic/contracts';
import { CanonicalCommandError } from '../../src/commands.js';
import type {
  CanonicalCommandStore,
  CanonicalStoreScope,
  CanonicalTransactionHandle,
} from '../../src/command-store.js';
import type {
  AnnotationRevisionRecord,
  CommentRevisionRecord,
  ThreadStructureRevisionRecord,
} from '../../src/revisions.js';
import type { ReviewEventRecord } from '../../src/reviews.js';
import type {
  LifecycleEventRecord,
  LifecycleObjectKind,
  OperationAuditEventRecord,
  OperationAuditSubject,
} from '../../src/lifecycle.js';

type Expected = { kind: 'revision'; revisionHash: string } | { kind: 'creation'; aggregateVersion: number };

const sameScope = (a: CanonicalStoreScope, b: CanonicalStoreScope): boolean =>
  a.tenantId === b.tenantId && a.workspaceId === b.workspaceId;

/** In-memory canonical store implementing the M1 port contract. */
export class InMemoryCanonicalStore implements CanonicalCommandStore {
  private readonly annotations = new Map<string, AnnotationRevisionRecord[]>();
  private readonly threads = new Map<string, ThreadStructureRevisionRecord[]>();
  private readonly comments = new Map<string, CommentRevisionRecord[]>();
  private readonly reviews = new Map<string, ReviewEventRecord[]>();
  private readonly lifecycle = new Map<string, LifecycleEventRecord[]>();
  private readonly audits = new Map<string, OperationAuditEventRecord[]>();
  private readonly idempotency = new Map<string, { digest: string; resultIds: string[]; resultHash: string | null }>();
  private readonly allocations = new Map<string, number>();

  transaction(): CanonicalTransactionHandle {
    const store = this;
    return {
      handleKind: 'canonical-transaction',
      async run<T>(operation: () => Promise<T>): Promise<T> {
        return operation();
      },
    };
  }

  private head<R extends { hash: string }>(chains: Map<string, R[]>, key: string): R | null {
    const chain = chains.get(key);
    return chain === undefined || chain.length === 0 ? null : chain[chain.length - 1];
  }

  private checkCas(chains: Map<string, { hash: string }[]>, key: string, expected: Expected): void {
    const head = this.head(chains, key);
    if (expected.kind === 'creation') {
      const allocated = this.allocations.get(key) ?? 0;
      if (head !== null || expected.aggregateVersion !== allocated) {
        throw new CanonicalCommandError('cas-conflict', 'Creation raced with an existing object');
      }
      return;
    }
    if (head === null || head.hash !== expected.revisionHash) {
      throw new CanonicalCommandError('cas-conflict', 'Head moved since the expected revision');
    }
  }

  private allocate(key: string): void {
    this.allocations.set(key, (this.allocations.get(key) ?? 0) + 1);
  }

  private append<R extends { link: { previousHash: string | null }; hash: string }>(
    chains: Map<string, R[]>,
    key: string,
    record: R,
    expected: Expected,
  ): R {
    this.checkCas(chains, key, expected);
    const head = this.head(chains, key);
    if (record.link.previousHash !== (head === null ? null : head.hash)) {
      throw new CanonicalCommandError('cas-conflict', 'Record does not extend the current head');
    }
    const chain = chains.get(key) ?? [];
    chain.push(record);
    chains.set(key, chain);
    if (expected.kind === 'creation') {
      this.allocate(key);
    }
    return record;
  }

  appendAnnotationRevision(scope: CanonicalStoreScope, annotationId: string, record: AnnotationRevisionRecord, expected: Expected): Promise<AnnotationRevisionRecord> {
    if (!sameScope(record.scope, scope)) throw new CanonicalCommandError('invalid-command', 'Record scope mismatch');
    return Promise.resolve(this.append(this.annotations, `${scope.tenantId}/${scope.workspaceId}/a/${annotationId}`, record, expected));
  }

  appendThreadStructureRevision(scope: CanonicalStoreScope, threadId: string, record: ThreadStructureRevisionRecord, expected: Expected): Promise<ThreadStructureRevisionRecord> {
    if (!sameScope(record.scope, scope)) throw new CanonicalCommandError('invalid-command', 'Record scope mismatch');
    return Promise.resolve(this.append(this.threads, `${scope.tenantId}/${scope.workspaceId}/t/${threadId}`, record, expected));
  }

  appendCommentRevision(scope: CanonicalStoreScope, commentId: string, record: CommentRevisionRecord, expected: Expected): Promise<CommentRevisionRecord> {
    if (!sameScope(record.scope, scope)) throw new CanonicalCommandError('invalid-command', 'Record scope mismatch');
    return Promise.resolve(this.append(this.comments, `${scope.tenantId}/${scope.workspaceId}/c/${commentId}`, record, expected));
  }

  appendReviewEvent(scope: CanonicalStoreScope, annotationId: string, record: ReviewEventRecord, expected: Expected): Promise<ReviewEventRecord> {
    if (!sameScope(record.scope, scope)) throw new CanonicalCommandError('invalid-command', 'Record scope mismatch');
    return Promise.resolve(this.append(this.reviews, `${scope.tenantId}/${scope.workspaceId}/r/${annotationId}`, record, expected));
  }

  appendLifecycleEvent(scope: CanonicalStoreScope, objectKind: LifecycleObjectKind, objectId: string, record: LifecycleEventRecord, expected: Expected): Promise<LifecycleEventRecord> {
    if (!sameScope(record.scope, scope)) throw new CanonicalCommandError('invalid-command', 'Record scope mismatch');
    return Promise.resolve(this.append(this.lifecycle, `${scope.tenantId}/${scope.workspaceId}/l/${objectKind}/${objectId}`, record, expected));
  }

  appendOperationAuditEvent(scope: CanonicalStoreScope, subject: OperationAuditSubject, subjectId: string, record: OperationAuditEventRecord, expected: Expected): Promise<OperationAuditEventRecord> {
    if (!sameScope(record.scope, scope)) throw new CanonicalCommandError('invalid-command', 'Record scope mismatch');
    return Promise.resolve(this.append(this.audits, `${scope.tenantId}/${scope.workspaceId}/o/${subject}/${subjectId}`, record, expected));
  }

  getAnnotationHead(scope: CanonicalStoreScope, annotationId: string): Promise<AnnotationRevisionRecord | null> {
    return Promise.resolve(this.head(this.annotations, `${scope.tenantId}/${scope.workspaceId}/a/${annotationId}`));
  }

  getAnnotationChain(scope: CanonicalStoreScope, annotationId: string): Promise<readonly AnnotationRevisionRecord[]> {
    return Promise.resolve(this.annotations.get(`${scope.tenantId}/${scope.workspaceId}/a/${annotationId}`) ?? []);
  }

  getThreadStructureHead(scope: CanonicalStoreScope, threadId: string): Promise<ThreadStructureRevisionRecord | null> {
    return Promise.resolve(this.head(this.threads, `${scope.tenantId}/${scope.workspaceId}/t/${threadId}`));
  }

  getThreadStructureChain(scope: CanonicalStoreScope, threadId: string): Promise<readonly ThreadStructureRevisionRecord[]> {
    return Promise.resolve(this.threads.get(`${scope.tenantId}/${scope.workspaceId}/t/${threadId}`) ?? []);
  }

  getReviewChain(scope: CanonicalStoreScope, annotationId: string): Promise<readonly ReviewEventRecord[]> {
    return Promise.resolve(this.reviews.get(`${scope.tenantId}/${scope.workspaceId}/r/${annotationId}`) ?? []);
  }

  getLifecycleChain(scope: CanonicalStoreScope, objectKind: LifecycleObjectKind, objectId: string): Promise<readonly LifecycleEventRecord[]> {
    return Promise.resolve(this.lifecycle.get(`${scope.tenantId}/${scope.workspaceId}/l/${objectKind}/${objectId}`) ?? []);
  }

  getOperationAuditChain(scope: CanonicalStoreScope, subject: OperationAuditSubject, subjectId: string): Promise<readonly OperationAuditEventRecord[]> {
    return Promise.resolve(this.audits.get(`${scope.tenantId}/${scope.workspaceId}/o/${subject}/${subjectId}`) ?? []);
  }

  getCommentHead(scope: CanonicalStoreScope, commentId: string): Promise<CommentRevisionRecord | null> {
    return Promise.resolve(this.head(this.comments, `${scope.tenantId}/${scope.workspaceId}/c/${commentId}`));
  }

  getCommentChain(scope: CanonicalStoreScope, commentId: string): Promise<readonly CommentRevisionRecord[]> {
    return Promise.resolve(this.comments.get(`${scope.tenantId}/${scope.workspaceId}/c/${commentId}`) ?? []);
  }

  findCommittedCommand(scope: CanonicalStoreScope, idempotencyKey: IdempotencyKey): Promise<{ digest: string; resultIds: string[]; resultHash: string | null } | null> {
    return Promise.resolve(this.idempotency.get(`${scope.tenantId}/${scope.workspaceId}/k/${idempotencyKey}`) ?? null);
  }

  recordCommittedCommand(scope: CanonicalStoreScope, idempotencyKey: IdempotencyKey, committed: { digest: string; resultIds: string[]; resultHash: string | null }): Promise<void> {
    const key = `${scope.tenantId}/${scope.workspaceId}/k/${idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing !== undefined && existing.digest !== committed.digest) {
      throw new CanonicalCommandError('idempotency-conflict', 'Idempotency key reused with different content');
    }
    this.idempotency.set(key, committed);
    return Promise.resolve();
  }
}
