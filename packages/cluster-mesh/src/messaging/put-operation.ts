import { canonicalBytes, canonicalJson } from './canonical-json.js';
import { MESSAGE_OVERHEAD_BYTES, DELIVERY_OVERHEAD_BYTES, type PreparedPut } from './local-model.js';
import { authorizeProduct } from './local-support.js';
import { LocalMessagingState } from './local-state.js';
import type { MeshMessage, PutMessageRequest, PutMessageResult } from './message-contracts.js';
import type {
  MessageTopicRoutePort,
  MessagingProductAuthorizationPort,
} from './product-authorization.js';
import { putFingerprint } from './validation.js';

export type PreparePutResult = { readonly ok: true; readonly prepared: PreparedPut } | {
  readonly ok: false;
  readonly reason: Extract<PutMessageResult, { ok: false }>['reason'];
};

export class PutOperation {
  constructor(
    private readonly state: LocalMessagingState,
    private readonly authorization: MessagingProductAuthorizationPort,
    private readonly routes: MessageTopicRoutePort,
  ) {}

  async put(input: PutMessageRequest): Promise<PutMessageResult> {
    const fingerprint = putFingerprint(input);
    if (fingerprint === null) return { ok: false, reason: 'invalid_message' };
    const putAuthorization = await authorizeProduct(
      this.authorization, input.context, 'message:put', input.destination,
    );
    if (putAuthorization !== 'allowed') return {
      ok: false, reason: putAuthorization === 'forbidden' ? 'forbidden' : 'unavailable',
    };
    const scope = this.scope(input);
    const replay = await this.state.mutex.run(() => {
      const messageId = this.state.idempotency.get(scope);
      return messageId ? this.state.messages.get(messageId) : undefined;
    });
    if (replay) {
      if (replay.fingerprint !== fingerprint) return { ok: false, reason: 'idempotency_conflict' };
      const routeAuth = await this.authorizeRoutes(input, replay.mailboxIds);
      if (routeAuth) return routeAuth;
      return { ok: true, outcome: 'idempotent_replay', messageId: replay.message.messageId,
        mailboxIds: replay.mailboxIds };
    }
    const prepared = await this.prepareAuthorized(input, fingerprint, scope);
    if (!prepared.ok) return prepared;
    const mutation = await this.state.mutex.run(() => {
      const nowMs = this.state.nowMs();
      if (nowMs === null) return { error: 'unavailable' } as const;
      this.state.cleanup(nowMs);
      return this.state.mutatePut(prepared.prepared);
    });
    if ('error' in mutation) return { ok: false, reason: mutation.error };
    if (mutation.outcome === 'idempotent_replay') {
      const routeAuth = await this.authorizeRoutes(input, mutation.mailboxIds);
      if (routeAuth) return routeAuth;
    }
    return { ok: true, ...mutation };
  }

  async prepare(input: PutMessageRequest): Promise<PreparePutResult> {
    const fingerprint = putFingerprint(input);
    if (fingerprint === null) return { ok: false, reason: 'invalid_message' };
    const decision = await authorizeProduct(
      this.authorization, input.context, 'message:put', input.destination,
    );
    if (decision !== 'allowed') return {
      ok: false, reason: decision === 'forbidden' ? 'forbidden' : 'unavailable',
    };
    return this.prepareAuthorized(input, fingerprint, this.scope(input));
  }

  private async prepareAuthorized(
    input: PutMessageRequest,
    fingerprint: string,
    idempotencyScope: string,
  ): Promise<PreparePutResult> {
    const mailboxIds = await this.resolveRoutes(input);
    if (!mailboxIds) return { ok: false, reason: 'route_unresolved' };
    const routeAuth = await this.authorizeRoutes(input, mailboxIds);
    if (routeAuth) return routeAuth;
    const nowMs = this.state.nowMs();
    if (nowMs === null) return { ok: false, reason: 'unavailable' };
    const messageId = this.state.options.id('message');
    if (!messageId) return { ok: false, reason: 'unavailable' };
    const body = JSON.parse(fingerprint) as Omit<MeshMessage,
      'version' | 'messageId' | 'producerPrincipalId' | 'enqueuedAt'>;
    const message: MeshMessage = {
      version: 'sentropic.cluster-mesh.message/v1', messageId,
      producerPrincipalId: input.context.principalId, ...body,
      enqueuedAt: new Date(nowMs).toISOString(),
    };
    const canonicalSize = canonicalBytes(message);
    if (canonicalSize > this.state.options.maxMessageBytes) {
      return { ok: false, reason: 'invalid_message' };
    }
    const deliveryIds = mailboxIds.map(() => this.state.options.id('delivery'));
    if (deliveryIds.some((id) => !id) || new Set(deliveryIds).size !== deliveryIds.length) {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, prepared: {
      producerPrincipalId: input.context.principalId, idempotencyScope, fingerprint,
      mailboxIds, deliveryIds, message, messageBytes: canonicalSize + MESSAGE_OVERHEAD_BYTES,
      deliveryBytes: mailboxIds.reduce((total, mailboxId, index) =>
        total + DELIVERY_OVERHEAD_BYTES + Buffer.byteLength(mailboxId, 'utf8')
          + Buffer.byteLength(deliveryIds[index], 'utf8'), 0),
    } };
  }

  private scope(input: PutMessageRequest): string {
    return canonicalJson([input.context.principalId, input.destination, input.idempotencyKey]);
  }

  private async resolveRoutes(input: PutMessageRequest): Promise<readonly string[] | null> {
    if (input.destination.kind === 'mailbox') return [input.destination.mailboxId];
    try {
      const resolved = await this.routes.resolve({
        context: input.context, topicId: input.destination.topicId,
      });
      if (!Array.isArray(resolved) || resolved.some((id) => typeof id !== 'string' || !id)) return null;
      const unique = [...new Set(resolved)].sort();
      return unique.length > 0 ? unique : null;
    } catch { return null; }
  }

  private async authorizeRoutes(
    input: PutMessageRequest,
    mailboxIds: readonly string[],
  ): Promise<Extract<PutMessageResult, { ok: false }> | null> {
    if (input.destination.kind === 'mailbox') return null;
    for (const mailboxId of mailboxIds) {
      const decision = await authorizeProduct(
        this.authorization, input.context, 'message:route', { kind: 'mailbox', mailboxId },
      );
      if (decision !== 'allowed') return {
        ok: false, reason: decision === 'forbidden' ? 'forbidden' : 'unavailable',
      };
    }
    return null;
  }
}
