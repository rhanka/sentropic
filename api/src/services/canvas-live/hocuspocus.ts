import type { AdmissionRecord } from './admission';
import { AdmissionError } from './contracts';
import type { FieldBindingIdentity } from './contracts';
import { IngressRefusal, validateClassified, type ClassifiedUpdate } from './ingress';
import { reassemble } from './sync-framing';
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

export interface HocuspocusHostDeps {
  authenticate(token: string): Promise<HocuspocusAuthContext>;
  authorizeUpdate(context: HocuspocusAuthContext, identity: FieldBindingIdentity, operation: string): Promise<void>;
  classifyUpdate(bytes: Uint8Array, admittedFields: string[]): ClassifiedUpdate;
  applyValidated(context: HocuspocusAuthContext, update: ValidatedUpdate): Promise<void>;
  refusals: RefusalSink;
  hostileThreshold?: number;
}

export class HocuspocusHost {
  private readonly hostileCounts = new Map<string, number>();
  private readonly closed = new Set<string>();

  constructor(private readonly deps: HocuspocusHostDeps) {}

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
    registry: Pick<SessionRegistry, 'resolveBinding'>,
  ): Promise<{ applied: boolean; closed: boolean }> {
    const connectionKey = `${context.admission.tenantId}:${context.admission.actor.actorId}:${context.admission.sessionEpoch}`;
    if (this.closed.has(connectionKey)) return { applied: false, closed: true };
    let bytes: Uint8Array;
    try {
      bytes = reassemble(frames);
    } catch (error) {
      this.recordRefusal(context, error instanceof Error ? error.message : 'frame-too-large');
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
    let classified: ClassifiedUpdate;
    try {
      classified = this.deps.classifyUpdate(bytes, [...context.admission.fields]);
    } catch (error) {
      const code = error instanceof IngressRefusal ? error.refusal : 'decode-failed';
      this.recordRefusal(context, code);
      return this.afterHostile(context, connectionKey);
    }
    try {
      validateClassified(classified, [...context.admission.fields]);
    } catch (error) {
      const code = error instanceof IngressRefusal ? error.refusal : 'decode-failed';
      this.recordRefusal(context, code);
      return this.afterHostile(context, connectionKey);
    }
    try {
      registry.resolveBinding(context.admission, identity);
    } catch (error) {
      const code = error instanceof AdmissionError ? error.code : 'invalid-binding';
      this.recordRefusal(context, code);
      return { applied: false, closed: false };
    }
    await this.deps.applyValidated(context, { identity, bytes, classified });
    this.hostileCounts.delete(connectionKey);
    return { applied: true, closed: false };
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
    const threshold = this.deps.hostileThreshold ?? 3;
    const count = (this.hostileCounts.get(connectionKey) ?? 0) + 1;
    this.hostileCounts.set(connectionKey, count);
    if (count >= threshold) {
      this.closed.add(connectionKey);
      return { applied: false, closed: true };
    }
    return { applied: false, closed: false };
  }
}
