import { randomUUID } from 'node:crypto';
import type { CustodySigningPort, CustodyTokenIssuer } from '../runtime/custody-types.js';
import { canonicalCustodyJson } from '../runtime/custody-wire.js';
import type { AckMessageResult, ClusterMeshMessagingPort } from './delivery-contracts.js';
import type {
  MeshMessage, MessageId, MessageJsonValue, MessagingProductContext, PutMessageResult,
} from './message-contracts.js';

export const AGENT_MESSAGE_CONTENT_TYPE = 'application/vnd.sentropic.agent-message+json';
export type AgentMessageKind = 'wake' | 'notify' | 'text';

export interface SignedAgentMessageEnvelope {
  readonly version: 'sentropic.cluster-mesh.agent-message/v1';
  readonly senderPrincipalId: string;
  readonly destination: { readonly kind: 'mailbox'; readonly mailboxId: string };
  readonly idempotencyKey: string;
  readonly kind: AgentMessageKind;
  readonly message: MessageJsonValue;
  readonly issuer: CustodyTokenIssuer;
  readonly evidence: {
    readonly kind: 'detached-signature';
    readonly canonicalization: 'sentropic-json-v1';
    readonly signatureBase64Url: string;
  };
}

export interface ReceivedAgentMessage extends MeshMessage {
  readonly kind: AgentMessageKind;
  readonly message: MessageJsonValue;
  readonly envelope: SignedAgentMessageEnvelope;
}

export interface SendMessageInput {
  readonly to: string;
  readonly message: MessageJsonValue;
  readonly kind?: AgentMessageKind;
}

export type SendMessageResult =
  | { readonly ok: true; readonly messageId: MessageId }
  | {
      readonly ok: false;
      readonly messageId: null;
      readonly reason: Extract<PutMessageResult, { ok: false }>['reason'];
    };

export interface ClusterMeshMessageClientOptions {
  readonly store: ClusterMeshMessagingPort;
  readonly context: MessagingProductContext;
  readonly signer: CustodySigningPort;
  readonly issuer: CustodyTokenIssuer;
  readonly idempotencyKey?: () => string;
  readonly visibilityTimeoutMs?: number;
}

export function messageEnvelopeSignaturePayload(
  envelope: SignedAgentMessageEnvelope,
): Uint8Array {
  const { signatureBase64Url: _signature, ...evidence } = envelope.evidence;
  return new TextEncoder().encode(canonicalCustodyJson({ ...envelope, evidence }));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const kinds = new Set<AgentMessageKind>(['wake', 'notify', 'text']);

function decodeEnvelope(message: MeshMessage): SignedAgentMessageEnvelope {
  const value = message.payload.value;
  if (message.payload.contentType !== AGENT_MESSAGE_CONTENT_TYPE || !isRecord(value)
    || value.version !== 'sentropic.cluster-mesh.agent-message/v1'
    || !isText(value.senderPrincipalId) || !isRecord(value.destination)
    || value.destination.kind !== 'mailbox' || !isText(value.destination.mailboxId)
    || !isText(value.idempotencyKey) || !kinds.has(value.kind as AgentMessageKind)
    || !('message' in value) || !isRecord(value.issuer) || !isText(value.issuer.issuerId)
    || !isText(value.issuer.keyId) || value.issuer.algorithm !== 'EdDSA'
    || value.issuer.curve !== 'Ed25519' || !isRecord(value.evidence)
    || value.evidence.kind !== 'detached-signature'
    || value.evidence.canonicalization !== 'sentropic-json-v1'
    || !isText(value.evidence.signatureBase64Url)
    || value.senderPrincipalId !== message.producerPrincipalId
    || value.destination.mailboxId !== (message.destination.kind === 'mailbox'
      ? message.destination.mailboxId : undefined)
    || value.idempotencyKey !== message.idempotencyKey) {
    throw new TypeError('invalid signed agent message envelope');
  }
  return value as unknown as SignedAgentMessageEnvelope;
}

export class ClusterMeshMessageClient {
  private readonly deliveries = new Map<MessageId, { deliveryId: string; leaseId: string }>();
  private readonly createIdempotencyKey: () => string;

  constructor(private readonly options: ClusterMeshMessageClientOptions) {
    this.createIdempotencyKey = options.idempotencyKey ?? randomUUID;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const idempotencyKey = this.createIdempotencyKey();
    const unsigned: SignedAgentMessageEnvelope = {
      version: 'sentropic.cluster-mesh.agent-message/v1',
      senderPrincipalId: this.options.context.principalId,
      destination: { kind: 'mailbox', mailboxId: input.to }, idempotencyKey,
      kind: input.kind ?? 'notify', message: input.message, issuer: { ...this.options.issuer },
      evidence: {
        kind: 'detached-signature', canonicalization: 'sentropic-json-v1',
        signatureBase64Url: 'unsigned',
      },
    };
    try {
      const signatureBase64Url = await this.options.signer.signCanonical(
        messageEnvelopeSignaturePayload(unsigned),
      );
      if (!signatureBase64Url) return { ok: false, messageId: null, reason: 'unavailable' };
      const envelope = {
        ...unsigned, evidence: { ...unsigned.evidence, signatureBase64Url },
      };
      const result = await this.options.store.put({
        context: this.options.context, destination: unsigned.destination, idempotencyKey,
        payload: { contentType: AGENT_MESSAGE_CONTENT_TYPE,
          value: envelope as unknown as MessageJsonValue },
      });
      return result.ok ? { ok: true, messageId: result.messageId }
        : { ok: false, messageId: null, reason: result.reason };
    } catch {
      return { ok: false, messageId: null, reason: 'unavailable' };
    }
  }

  async receiveMessages(input: { readonly instance: string }): Promise<ReceivedAgentMessage[]> {
    const messages: ReceivedAgentMessage[] = [];
    while (true) {
      const result = await this.options.store.pop({
        context: this.options.context, mailboxId: input.instance,
        visibilityTimeoutMs: this.options.visibilityTimeoutMs,
      });
      if (!result.ok) throw new Error(`message receive failed: ${result.reason}`);
      if (result.outcome === 'empty') return messages;
      const { delivery } = result;
      let envelope: SignedAgentMessageEnvelope;
      try {
        envelope = decodeEnvelope(delivery.message);
      } catch {
        // Leave foreign or malformed messages unacknowledged until their lease expires.
        continue;
      }
      this.deliveries.set(delivery.message.messageId, {
        deliveryId: delivery.deliveryId, leaseId: delivery.lease.leaseId,
      });
      messages.push({ ...delivery.message, kind: envelope.kind,
        message: envelope.message, envelope });
    }
  }

  async ack(messageId: MessageId): Promise<AckMessageResult> {
    const delivery = this.deliveries.get(messageId);
    if (!delivery) return { ok: false, reason: 'delivery_not_found' };
    const result = await this.options.store.ack({
      context: this.options.context, deliveryId: delivery.deliveryId,
      leaseId: delivery.leaseId, ackIdempotencyKey: `agent-message/v1:${messageId}`,
      disposition: { kind: 'processed' },
    });
    if (result.ok) this.deliveries.delete(messageId);
    return result;
  }
}
