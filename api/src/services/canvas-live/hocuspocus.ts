import * as Y from 'yjs';
import type { AdmissionRecord } from './admission';
import { AdmissionError } from './contracts';
import type { FieldBindingIdentity } from './contracts';
import {
  IngressRefusal,
  createYjsIngressClassifier,
  validateClassified,
  validateResultingSchema,
  validateVectorFreshness,
  type ClassifiedUpdate,
  type ScratchCandidate,
  type YjsIngressClassifier,
} from './ingress';
import { reassemble } from './sync-framing';
import { UnresolvedQuarantine, type QuarantinedInput } from './quarantine';
import type { SessionRegistry } from './session-registry';

export interface HocuspocusPrincipal {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'nhi';
}

export interface HocuspocusAuthContext {
  principal: HocuspocusPrincipal;
  admission: AdmissionRecord;
}

export interface HocuspocusStore {
  loadDocument(identity: { tenantId: string; workspaceId: string; documentId: string }): Promise<{
    encodedState: string;
    stateVector: string;
  } | null>;
  storeCheckpoint(identity: { tenantId: string; workspaceId: string; documentId: string }, checkpoint: {
    encodedState: string;
    stateVector: string;
    journalWatermark: number;
  }): Promise<void>;
}

export interface ValidatedUpdate {
  identity: FieldBindingIdentity;
  bytes: Uint8Array;
  classified: ClassifiedUpdate;
}

export type RefusalSink = (entry: {
  actorId: string;
  documentId: string;
  refusal: string;
  at: string;
}) => void;

export interface QuarantineRevalidationItem {
  actorId: string;
  sessionEpoch: string;
  fieldKey: string;
  documentId: string;
}

export interface HocuspocusHostDeps {
  authenticate(token: string): Promise<HocuspocusAuthContext>;
  authorizeUpdate(context: HocuspocusAuthContext, identity: FieldBindingIdentity, operation: string): Promise<void>;
  registry: Pick<SessionRegistry, 'resolveBinding'>;
  classifier?: YjsIngressClassifier;
  applyValidated(context: HocuspocusAuthContext, update: ValidatedUpdate): Promise<{ journalWatermark: number }>;
  resolveAdmission?(item: QuarantineRevalidationItem): Promise<HocuspocusAuthContext | null>;
  store?: HocuspocusStore;
  refusals: RefusalSink;
  hostileThreshold?: number;
}

export class HocuspocusHost {
  private readonly hostileCounts = new Map<string, number>();
  private readonly closed = new Set<string>();
  private readonly classifier: YjsIngressClassifier;
  private readonly unresolvedQuarantine: UnresolvedQuarantine;
  private readonly quarantinedContexts = new Map<
    string,
    { context: HocuspocusAuthContext; identity: FieldBindingIdentity }
  >();
  private quarantineCounter = 0;

  constructor(private readonly deps: HocuspocusHostDeps) {
    this.classifier = deps.classifier ?? createYjsIngressClassifier();
    this.unresolvedQuarantine = new UnresolvedQuarantine({
      revalidate: (item) => this.revalidateQuarantined(item),
    });
  }

  get quarantine(): UnresolvedQuarantine {
    return this.unresolvedQuarantine;
  }

  async onAuthenticate(token: string): Promise<HocuspocusAuthContext> {
    return this.deps.authenticate(token);
  }

  async onLoadDocument(context: HocuspocusAuthContext, store: HocuspocusStore): Promise<string | null> {
    const loaded = await store.loadDocument({
      tenantId: context.admission.tenantId,
      workspaceId: context.admission.workspaceId,
      documentId: context.admission.documentId,
    });
    return loaded?.encodedState ?? null;
  }

  async handleUpdate(
    context: HocuspocusAuthContext,
    identity: FieldBindingIdentity,
    frames: Uint8Array[],
  ): Promise<{ applied: boolean; closed: boolean; quarantined?: boolean }> {
    const connectionKey = `${context.admission.tenantId}:${context.admission.actor.actorId}:${context.admission.sessionEpoch}`;
    if (this.closed.has(connectionKey)) return { applied: false, closed: true };
    let bytes: Uint8Array;
    try {
      bytes = reassemble(frames);
    } catch (error) {
      const code = error instanceof IngressRefusal ? error.refusal : 'frame-too-large';
      this.recordRefusal(context, code);
      return this.afterHostile(context, connectionKey);
    }
    if (identity.documentId !== context.admission.documentId || identity.sessionId !== context.admission.sessionId) {
      this.recordRefusal(context, 'scope-denied');
      this.closed.add(connectionKey);
      return { applied: false, closed: true };
    }
    try {
      await this.deps.authorizeUpdate(context, identity, 'edit');
    } catch (error) {
      const code = error instanceof AdmissionError ? error.code : 'scope-denied';
      this.recordRefusal(context, code);
      if (code === 'revoked' || code === 'actor-denied') this.closed.add(connectionKey);
      return { applied: false, closed: this.closed.has(connectionKey) };
    }
    let authoritative: Y.Doc;
    try {
      const binding = this.deps.registry.resolveBinding(context.admission, identity);
      authoritative = (binding.text as Y.Text).doc as Y.Doc;
    } catch (error) {
      const code = error instanceof AdmissionError ? error.code : 'invalid-binding';
      this.recordRefusal(context, code);
      return { applied: false, closed: false };
    }
    let classified: ClassifiedUpdate;
    let candidate: ScratchCandidate;
    try {
      ({ classified, candidate } = this.classifier.validateAgainstAuthoritative(
        bytes,
        authoritative,
        [...context.admission.fields],
      ));
    } catch (error) {
      return this.refuseCandidate(context, connectionKey, error);
    }
    // Pending Yjs data is quarantined with its actor and admission, never refused
    // or applied: it becomes integrable only through the dependency flush.
    if (classified.hasUnresolvedStructs) {
      const id = `q-${(this.quarantineCounter += 1)}`;
      this.unresolvedQuarantine.add({
        id,
        actorId: context.admission.actor.actorId,
        sessionEpoch: context.admission.sessionEpoch,
        fieldKey: identity.fieldKey,
        documentId: identity.documentId,
        encodedUpdate: Buffer.from(bytes).toString('base64'),
      });
      this.quarantinedContexts.set(id, { context, identity });
      this.recordRefusal(context, 'unresolved-struct');
      return { applied: false, closed: false, quarantined: true };
    }
    try {
      validateClassified(classified, [...context.admission.fields], new Set(candidate.authoritativeParagraphIds));
      validateVectorFreshness(candidate.vectorBefore, candidate.vectorAfter);
      validateResultingSchema(candidate, [...context.admission.fields]);
    } catch (error) {
      return this.refuseCandidate(context, connectionKey, error);
    }
    await this.applyValidatedAndCheckpoint(context, identity, bytes, classified, authoritative);
    try {
      await this.unresolvedQuarantine.dependenciesArrived();
    } catch {
      // Revalidation refusals are recorded per item and class; a failed flush
      // never rolls back the update that just admitted and applied.
    }
    this.hostileCounts.delete(connectionKey);
    return { applied: true, closed: false };
  }

  private async revalidateQuarantined(item: QuarantinedInput): Promise<'integrate' | 'refuse' | 'retain'> {
    const retained = this.quarantinedContexts.get(item.id);
    let context = retained?.context;
    if (this.deps.resolveAdmission) {
      const resolved = await this.deps.resolveAdmission({
        actorId: item.actorId,
        sessionEpoch: item.sessionEpoch,
        fieldKey: item.fieldKey,
        documentId: item.documentId,
      });
      if (!resolved) {
        this.quarantinedContexts.delete(item.id);
        this.recordQuarantineRefusal(item, 'revoked');
        return 'refuse';
      }
      context = resolved;
    }
    if (!context || !retained) {
      this.quarantinedContexts.delete(item.id);
      this.recordQuarantineRefusal(item, 'revoked');
      return 'refuse';
    }
    const identity = retained.identity;
    const bytes = new Uint8Array(Buffer.from(item.encodedUpdate, 'base64'));
    try {
      await this.deps.authorizeUpdate(context, identity, 'edit');
      const binding = this.deps.registry.resolveBinding(context.admission, identity);
      const authoritative = (binding.text as Y.Text).doc as Y.Doc;
      const { classified, candidate } = this.classifier.validateAgainstAuthoritative(
        bytes,
        authoritative,
        [...context.admission.fields],
      );
      if (classified.hasUnresolvedStructs) return 'retain';
      validateClassified(classified, [...context.admission.fields], new Set(candidate.authoritativeParagraphIds));
      validateVectorFreshness(candidate.vectorBefore, candidate.vectorAfter);
      validateResultingSchema(candidate, [...context.admission.fields]);
      await this.applyValidatedAndCheckpoint(context, identity, bytes, classified, authoritative);
    } catch (error) {
      const code = error instanceof IngressRefusal
        ? error.refusal
        : error instanceof AdmissionError
          ? error.code
          : 'decode-failed';
      this.quarantinedContexts.delete(item.id);
      this.recordQuarantineRefusal(item, code);
      return 'refuse';
    }
    this.quarantinedContexts.delete(item.id);
    return 'integrate';
  }

  private async applyValidatedAndCheckpoint(
    context: HocuspocusAuthContext,
    identity: FieldBindingIdentity,
    bytes: Uint8Array,
    classified: ClassifiedUpdate,
    authoritative: Y.Doc,
  ): Promise<void> {
    const { journalWatermark } = await this.deps.applyValidated(context, { identity, bytes, classified });
    if (this.deps.store) {
      await this.deps.store.storeCheckpoint(
        {
          tenantId: context.admission.tenantId,
          workspaceId: context.admission.workspaceId,
          documentId: context.admission.documentId,
        },
        {
          encodedState: Buffer.from(Y.encodeStateAsUpdate(authoritative)).toString('base64'),
          stateVector: Buffer.from(Y.encodeStateVector(authoritative)).toString('base64'),
          journalWatermark,
        },
      );
    }
  }

  private refuseCandidate(
    context: HocuspocusAuthContext,
    connectionKey: string,
    error: unknown,
  ): { applied: boolean; closed: boolean } {
    const code = error instanceof IngressRefusal ? error.refusal : 'decode-failed';
    this.recordRefusal(context, code);
    return this.afterHostile(context, connectionKey);
  }

  private recordQuarantineRefusal(item: QuarantinedInput, refusal: string): void {
    this.deps.refusals({
      actorId: item.actorId,
      documentId: item.documentId,
      refusal,
      at: new Date().toISOString(),
    });
  }

  private recordRefusal(context: HocuspocusAuthContext, refusal: string): void {
    this.deps.refusals({
      actorId: context.admission.actor.actorId,
      documentId: context.admission.documentId,
      refusal,
      at: new Date().toISOString(),
    });
  }

  private afterHostile(context: HocuspocusAuthContext, connectionKey: string): { applied: boolean; closed: boolean } {
    const threshold = this.deps.hostileThreshold ?? 2;
    const count = (this.hostileCounts.get(connectionKey) ?? 0) + 1;
    this.hostileCounts.set(connectionKey, count);
    if (count >= threshold) {
      this.closed.add(connectionKey);
      return { applied: false, closed: true };
    }
    return { applied: false, closed: false };
  }
}
