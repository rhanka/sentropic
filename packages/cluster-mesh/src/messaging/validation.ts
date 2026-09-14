import type { MessageAckDisposition } from './delivery-contracts.js';
import type {
  MessageActuationIntent,
  MessageAddress,
  MessagePayload,
  MessagingProductContext,
  PutMessageRequest,
} from './message-contracts.js';
import type { NativeDrainCursor } from './native-drain-contracts.js';
import { canonicalJson } from './canonical-json.js';

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const optionalText = (value: unknown): boolean => value === undefined || text(value);

export const validContext = (value: unknown): value is MessagingProductContext => {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<MessagingProductContext>;
  return text(context.principalId)
    && optionalText(context.tenantId)
    && optionalText(context.workspaceId)
    && Array.isArray(context.scopes)
    && context.scopes.every(text)
    && text(context.policyRevision)
    && text(context.authenticationEvidenceRef);
};

export const validAddress = (value: unknown): value is MessageAddress => {
  if (!value || typeof value !== 'object') return false;
  const address = value as Record<string, unknown>;
  return address.kind === 'mailbox' ? text(address.mailboxId)
    : address.kind === 'topic' && text(address.topicId);
};

export const validPayload = (value: unknown): value is MessagePayload => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<MessagePayload>;
  if (!text(payload.contentType)) return false;
  try { canonicalJson(payload.value); return true; } catch { return false; }
};

export const validIntent = (value: unknown): value is MessageActuationIntent => {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<MessageActuationIntent>;
  return intent.kind === 'session-control'
    && text(intent.targetRegistrationId)
    && (intent.action === 'drive' || intent.action === 'wake' || intent.action === 'relaunch')
    && text(intent.commandRef);
};

export const validTimestamp = (value: unknown): value is string =>
  text(value) && Number.isFinite(Date.parse(value));

export const putFingerprint = (input: PutMessageRequest): string | null => {
  if (!validContext(input.context) || !validAddress(input.destination)
    || !text(input.idempotencyKey) || !validPayload(input.payload)
    || (input.actuation !== undefined && !validIntent(input.actuation))
    || (input.expiresAt !== undefined && !validTimestamp(input.expiresAt))) return null;
  try {
    if (input.metadata !== undefined) canonicalJson(input.metadata);
    return canonicalJson({
      destination: input.destination,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      ...(input.actuation === undefined ? {} : { actuation: input.actuation }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
  } catch { return null; }
};

export const validDisposition = (value: unknown): value is MessageAckDisposition => {
  if (!value || typeof value !== 'object') return false;
  const disposition = value as MessageAckDisposition;
  if (disposition.kind === 'processed') return true;
  if (disposition.kind === 'quarantined') {
    return text(disposition.reason) && optionalText(disposition.commandRef)
      && optionalText(disposition.effectRef);
  }
  if (disposition.kind !== 'actuation' || !text(disposition.commandRef)) return false;
  const result = disposition.result;
  return !!result && text(result.effectRef)
    && (result.outcome === 'acted' || result.outcome === 'deferred' || result.outcome === 'failed')
    && (result.actedTargets === undefined
      || (Array.isArray(result.actedTargets) && result.actedTargets.every(text)));
};

export const validCursor = (value: unknown): value is NativeDrainCursor => {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as Partial<NativeDrainCursor>;
  return text(cursor.sourceId) && text(cursor.sourceEpoch) && text(cursor.position);
};

export const sameCursor = (
  left: NativeDrainCursor | null,
  right: NativeDrainCursor | null,
): boolean => left === null ? right === null : right !== null
  && left.sourceId === right.sourceId
  && left.sourceEpoch === right.sourceEpoch
  && left.position === right.position;

export const laterPosition = (before: string | null, after: string): boolean => {
  if (before === null) return true;
  if (/^\d+$/.test(before) && /^\d+$/.test(after)) return BigInt(after) > BigInt(before);
  return after > before;
};
