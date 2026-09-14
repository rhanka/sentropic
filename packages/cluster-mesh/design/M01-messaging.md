# M01 bounded-local messaging

Status: **LOCKED** — the owner confirmed the recommended defaults D-A..D-F on 2026-09-13; gemini-3.8 design review returned APPROVE-WITH-NITS (0 must-fix, nits folded) and h-runtime consumer-confirms C1-C4 are all green. This is a 0.10.0 addition to the published 0.9.0 package; the design changes no shipped 0.9.0 contract, and the initial bounded-local implementation adds no schema or migration.

## Commission boundary

M01 adds four related capabilities:

- **M01a — core messaging:** bounded-local `put`, `pop`, `subscribe`, and idempotent `ack` operations;
- **M01b — product routing and authorization:** mailbox/topic routing plus product-owned authorization for store, route, delivery, acknowledgement, and subscription push;
- **M01c — delivery-to-actuation hand-off:** an authorized executor hands a delivered command to the existing 0.9.0 signed-instruction, custody PDP, and `PtyActuatorPort` path;
- **M01d — native drain:** a one-way, resumable import from a retained native source, protected by a generation-and-lease mono-worker fence and deterministic idempotency.

Messaging owns transport state, routing state, visibility leases, acknowledgements, and drain progress. It does **not** own product policy, session custody, instruction verification, actuator selection, PTY I/O, or an execution PDP. Product authorization and custody authorization are independent mandatory gates: passing either one never implies passing the other.

The first store is process-local and bounded. Restart discards messages, deliveries, acknowledgement tombstones, subscriptions, drain fences, and drain cursors. The public contract therefore promises no restart survival. A retained native source can rehydrate a new store instance from its origin cursor; advancing or deleting a native source beyond a volatile destination is not part of this lock candidate.

## AS-IS in 0.9.0

Version 0.9.0 has no message store, mailbox, topic, delivery lease, acknowledgement, subscription, product messaging authorization, or native-drain surface. Its existing actuation path is authoritative and remains unchanged:

1. `VerifiedInvocationContextPort.verify(...)` constructs a verified invocation context.
2. `RegistrationGate.authorize(context, action)` reloads the registration, enforces generation, principal, workspace, custody, expiry, liveness, and actuator availability, then returns the selected existing actuator.
3. `CommandInstructionPort.resolve({ commandRef, registrationId, action })` resolves a `SignedInstruction`; `commandRef` itself is expressly opaque and non-executable.
4. The selected `PtyActuatorPort` or existing secondary actuator receives the 0.9.0 `ActuationRequest` and returns the 0.9.0 `ActuationResult` with `outcome: 'acted' | 'deferred' | 'failed'`.
5. The session-control route preserves `commandRef === invocationId`, records transported/verified/acted evidence, and fails closed on missing registration, custody mismatch, unresolved instruction, unavailable actuator, or invalid result.

M01c is an adapter into that sequence. It must not call PTY I/O directly, accept a message body as an executable instruction, mint custody, cache a PDP success, select an actuator, or define another `authorize` method with session-custody meaning.

## Contract shapes

The following shapes are package-local additions. They deliberately reuse the shipped actuation result rather than copying or widening it.

```ts
import type {
  ActuationRequest,
  ActuationResult,
  RegistrationFailureReason,
} from './runtime/registration.js';

export type MessageId = string;
export type DeliveryId = string;
export type MailboxId = string;
export type TopicId = string;
export type SubscriptionId = string;
export type MessageLeaseId = string;

export type MessageJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly MessageJsonValue[]
  | { readonly [key: string]: MessageJsonValue };

export interface MessagingProductContext {
  /** Authenticated product principal; never accepted from the message body. */
  readonly principalId: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly scopes: readonly string[];
  readonly policyRevision: string;
  readonly authenticationEvidenceRef: string;
}

export type MessageAddress =
  | { readonly kind: 'mailbox'; readonly mailboxId: MailboxId }
  | { readonly kind: 'topic'; readonly topicId: TopicId };

export interface MessagePayload {
  readonly contentType: string;
  readonly value: MessageJsonValue;
}

export interface MessageActuationIntent {
  readonly kind: 'session-control';
  readonly targetRegistrationId: string;
  readonly action: ActuationRequest['action'];
  /**
   * Opaque command identity and signed-instruction lookup key. It is not executable
   * content. Under the 0.9.0 seam it is also the invocation ID.
   */
  readonly commandRef: string;
}

export interface MeshMessage {
  readonly version: 'sentropic.cluster-mesh.message/v1';
  readonly messageId: MessageId;
  readonly producerPrincipalId: string;
  readonly destination: MessageAddress;
  readonly idempotencyKey: string;
  readonly payload: MessagePayload;
  readonly actuation?: MessageActuationIntent;
  readonly metadata?: Readonly<Record<string, MessageJsonValue>>;
  readonly enqueuedAt: string;
  readonly expiresAt?: string;
}

export interface PutMessageRequest {
  readonly context: MessagingProductContext;
  readonly destination: MessageAddress;
  readonly idempotencyKey: string;
  readonly payload: MessagePayload;
  readonly actuation?: MessageActuationIntent;
  readonly metadata?: Readonly<Record<string, MessageJsonValue>>;
  readonly expiresAt?: string;
}

export type PutMessageResult =
  | {
      readonly ok: true;
      readonly outcome: 'accepted' | 'idempotent_replay';
      readonly messageId: MessageId;
      readonly mailboxIds: readonly MailboxId[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'forbidden'
        | 'invalid_message'
        | 'route_unresolved'
        | 'idempotency_conflict'
        | 'capacity_exhausted'
        | 'unavailable';
    };

export interface MessageVisibilityLease {
  readonly leaseId: MessageLeaseId;
  readonly ownerPrincipalId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface MessageDelivery {
  readonly deliveryId: DeliveryId;
  readonly mailboxId: MailboxId;
  readonly mailboxSequence: number;
  readonly deliveryAttempt: number;
  readonly message: MeshMessage;
  readonly lease: MessageVisibilityLease;
}

export interface PopMessageRequest {
  readonly context: MessagingProductContext;
  readonly mailboxId: MailboxId;
  readonly visibilityTimeoutMs?: number;
}

export type PopMessageResult =
  | { readonly ok: true; readonly outcome: 'delivery'; readonly delivery: MessageDelivery }
  | { readonly ok: true; readonly outcome: 'empty' }
  | { readonly ok: false; readonly reason: 'forbidden' | 'unavailable' };

export interface SubscribeMessagesRequest {
  readonly context: MessagingProductContext;
  readonly mailboxId: MailboxId;
  readonly visibilityTimeoutMs?: number;
  readonly maxInFlight?: number;
}

export type MessageSubscriptionTerminal =
  | { readonly reason: 'closed' }
  | { readonly reason: 'authorization_revoked' | 'unavailable' | 'store_restarted' };

export interface MessageSubscription extends AsyncIterable<MessageDelivery> {
  readonly subscriptionId: SubscriptionId;
  readonly mailboxId: MailboxId;
  readonly terminal: Promise<MessageSubscriptionTerminal>;
  close(): Promise<void>;
}

export type SubscribeMessagesResult =
  | { readonly ok: true; readonly subscription: MessageSubscription }
  | {
      readonly ok: false;
      readonly reason: 'forbidden' | 'subscription_capacity_exhausted' | 'unavailable';
    };

export type MessageAckDisposition =
  | { readonly kind: 'processed' }
  | {
      readonly kind: 'actuation';
      readonly commandRef: string;
      /** The exact object returned by the existing actuator. */
      readonly result: ActuationResult;
    }
  | {
      readonly kind: 'quarantined';
      readonly reason: string;
      readonly commandRef?: string;
      readonly effectRef?: string;
    };

export interface AckMessageRequest {
  readonly context: MessagingProductContext;
  readonly deliveryId: DeliveryId;
  readonly leaseId: MessageLeaseId;
  readonly ackIdempotencyKey: string;
  readonly disposition: MessageAckDisposition;
}

export type AckMessageResult =
  | { readonly ok: true; readonly outcome: 'acked' | 'idempotent_replay' }
  | {
      readonly ok: false;
      readonly reason:
        | 'forbidden'
        | 'delivery_not_found'
        | 'lease_mismatch'
        | 'lease_expired'
        | 'ack_conflict'
        | 'unavailable';
    };

export interface ClusterMeshMessagingPort {
  put(input: PutMessageRequest): Promise<PutMessageResult>;
  pop(input: PopMessageRequest): Promise<PopMessageResult>;
  subscribe(input: SubscribeMessagesRequest): Promise<SubscribeMessagesResult>;
  ack(input: AckMessageRequest): Promise<AckMessageResult>;
}
```

`producerPrincipalId`, IDs, acceptance time, mailbox sequence, delivery attempt, and visibility lease are store-authored. A caller cannot inject them. An idempotency key is scoped to `(producerPrincipalId, destination, idempotencyKey)`. Reusing that tuple with byte-equivalent canonical input returns the original message and route set; reusing it with different input returns `idempotency_conflict`.

### Product authorization and routing

```ts
export type MessagingProductAction =
  | 'message:put'
  | 'message:route'
  | 'message:pop'
  | 'message:subscribe'
  | 'message:push'
  | 'message:ack';

export type MessagingProductResource =
  | { readonly kind: 'mailbox'; readonly mailboxId: MailboxId }
  | { readonly kind: 'topic'; readonly topicId: TopicId }
  | {
      readonly kind: 'delivery';
      readonly mailboxId: MailboxId;
      readonly messageId: MessageId;
      readonly deliveryId: DeliveryId;
    };

export type MessagingProductAuthorizationDecision =
  | {
      readonly ok: true;
      readonly decisionRef: string;
      readonly policyRevision: string;
    }
  | { readonly ok: false; readonly reason: 'forbidden' | 'unavailable' };

export interface MessagingProductAuthorizationPort {
  authorize(input: {
    readonly context: MessagingProductContext;
    readonly action: MessagingProductAction;
    readonly resource: MessagingProductResource;
  }): Promise<MessagingProductAuthorizationDecision>;
}

export interface MessageTopicRoutePort {
  resolve(input: {
    readonly context: MessagingProductContext;
    readonly topicId: TopicId;
  }): Promise<readonly MailboxId[]>;
}
```

The messaging domain calls this product port for every operation. A topic put requires `message:put` on the topic, successful route resolution, and `message:route` on every concrete destination mailbox before any copy is accepted. A direct mailbox put requires `message:put` on that mailbox. `pop` and `subscribe` are checked before claiming a message. An active subscription is not a durable permit: `message:push` is checked again against the concrete delivery immediately before each yield. `ack` is checked against the concrete delivery before lease validation or mutation.

Denial, exception, timeout, missing context, route failure, an empty route set, or a policy revision that the host cannot validate is fail-closed. Topic fan-out is all-or-nothing for one `put`; partial authorized fan-out is not allowed. Authorization decisions are evidence for diagnostics, not reusable capabilities and not custody evidence.

### Delivery-to-actuation hand-off

```ts
export interface DeliveryActuationHandoffRequest {
  readonly delivery: MessageDelivery;
  readonly intent: MessageActuationIntent;
  readonly invocation: {
    /** MUST equal intent.commandRef for the existing 0.9.0 control seam. */
    readonly invocationId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly authorizationEvidenceRef?: string;
    /** Structurally optional for non-custody calls; required for custody-controlled actions. */
    readonly custodyToken?: string;
  };
}

export type DeliveryActuationRefusalReason =
  | RegistrationFailureReason
  | 'unverified_invocation_context'
  | 'instruction_resolution_failed'
  | 'invalid_handoff'
  | 'authorization_unavailable';

export type DeliveryActuationHandoffResult =
  | {
      readonly kind: 'result';
      readonly deliveryId: DeliveryId;
      readonly commandRef: string;
      /** Preserved verbatim from PtyActuatorPort/SessionActuatorPort. */
      readonly result: ActuationResult;
    }
  | {
      readonly kind: 'refused';
      readonly deliveryId: DeliveryId;
      readonly commandRef: string;
      readonly actuationAttempted: false;
      readonly reason: DeliveryActuationRefusalReason;
    }
  | {
      readonly kind: 'uncertain';
      readonly deliveryId: DeliveryId;
      readonly commandRef: string;
      /** A thrown actuator call cannot prove whether external I/O occurred. */
      readonly actuationAttempted: 'unknown';
      readonly reason: 'actuation_failed' | 'handoff_unavailable';
      readonly effectRef?: string;
    };

export interface DeliveryActuationHandoffPort {
  handoff(input: DeliveryActuationHandoffRequest): Promise<DeliveryActuationHandoffResult>;
}
```

The port is implemented by an adapter around the existing session-control/custody path, not by the messaging store. Its normative sequence is:

1. Verify that the delivery carries a `session-control` intent, that the request `intent` is deep-equal to `delivery.message.actuation` (the executor may not substitute a different intent than the one carried by the delivered message), and that `invocationId === commandRef`.
2. Forward the invocation and custody evidence to the existing invocation-context verifier. Messaging does not parse, derive, or mint custody.
3. Call the existing `RegistrationGate.authorize(context, intent.action)`. Product authorization is not passed as a substitute or extra scope.
4. After authorization, call the existing `CommandInstructionPort.resolve` with `commandRef`, the authorized registration ID, and the action. The message payload is never cast to `SignedInstruction`.
5. Pass the resulting existing `ActuationRequest` to the actuator selected by the existing registration gate. M01 neither prefers nor constructs a `PtyActuatorPort`.
6. Return the existing `ActuationResult` object unchanged. A rejection before actuator invocation returns `refused`; a thrown or disconnected actuator call returns `uncertain` because external effect cannot be disproved.

The fixed `commandRef` makes all redeliveries of one message refer to the same custody/invocation tuple. They must never silently allocate a fresh actuation attempt. A deliberate retry after reconciliation is a new message with a new `commandRef`, invocation ID, custody token, and producer idempotency key.

The messaging store never auto-acknowledges on hand-off. An authorized executor records an exact returned `ActuationResult` with the `actuation` acknowledgement disposition. `acted` is terminal success. `deferred` is terminal ownership transfer only for an actuator whose separately approved contract makes `effectRef` authoritative. A returned `failed` result, a refusal after the command tuple has been recorded, or any `uncertain` result must be reconciled and acknowledged as `quarantined`; blind visibility-timeout retry could duplicate an external effect. If the executor crashes after I/O but before ack, redelivery is allowed by the messaging guarantee, while the unchanged `commandRef` and custody replay fence must prevent a second actuation attempt and force reconciliation. The redelivered delivery for such an uncertain external effect must terminate in a `quarantined` ack after reconciliation — never a silent visibility-timeout retry loop and never an `actuation` ack that re-drives the actuator.

### Native-drain fence, cursor, and import

```ts
export interface NativeDrainCursor {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  /** Opaque exclusive position: the next read starts strictly after it. */
  readonly position: string;
}

export interface NativeDrainFence {
  readonly sourceId: string;
  readonly workerId: string;
  /** Monotonically increases on every successful acquisition. */
  readonly generation: number;
  readonly leaseId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface NativeMessageRecord {
  readonly nativeMessageId: string;
  readonly cursorAfter: NativeDrainCursor;
  readonly destination: MessageAddress;
  readonly payload: MessagePayload;
  readonly actuation?: MessageActuationIntent;
  readonly metadata?: Readonly<Record<string, MessageJsonValue>>;
  readonly producedAt?: string;
  readonly expiresAt?: string;
}

export interface NativeMessageBatch {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly after: NativeDrainCursor | null;
  readonly records: readonly NativeMessageRecord[];
  readonly nextCursor: NativeDrainCursor | null;
  readonly exhausted: boolean;
}

export interface NativeMessageSourcePort {
  /** Read-only with respect to the native source. Records remain replayable. */
  read(input: {
    readonly sourceId: string;
    readonly after: NativeDrainCursor | null;
    readonly limit: number;
  }): Promise<NativeMessageBatch>;
}

export type NativeDrainAcquireResult =
  | {
      readonly ok: true;
      readonly fence: NativeDrainFence;
      readonly cursor: NativeDrainCursor | null;
    }
  | { readonly ok: false; readonly reason: 'lease_held' | 'unavailable' };

export type NativeDrainImportResult =
  | {
      readonly ok: true;
      readonly outcome: 'advanced' | 'idempotent_replay' | 'exhausted';
      readonly imported: number;
      readonly cursor: NativeDrainCursor | null;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'fenced'
        | 'lease_expired'
        | 'cursor_conflict'
        | 'source_epoch_changed'
        | 'invalid_batch'
        | 'forbidden'
        | 'capacity_exhausted'
        | 'unavailable';
    };

export interface NativeDrainCoordinatorPort {
  acquire(input: {
    readonly sourceId: string;
    readonly workerId: string;
    readonly leaseMs: number;
  }): Promise<NativeDrainAcquireResult>;

  renew(input: {
    readonly fence: NativeDrainFence;
    readonly leaseMs: number;
  }): Promise<NativeDrainFence | null>;

  importBatch(input: {
    readonly context: MessagingProductContext;
    readonly fence: NativeDrainFence;
    readonly expectedCursor: NativeDrainCursor | null;
    readonly batch: NativeMessageBatch;
  }): Promise<NativeDrainImportResult>;

  release(input: { readonly fence: NativeDrainFence }): Promise<boolean>;
}
```

`importBatch` is an internal fenced ingress operation, not a product bypass around `put`. For each record it derives the destination idempotency key from canonical components without delimiter ambiguity:

```ts
`native/v1:${base64url(sha256(sentropicJsonV1({ sourceId, sourceEpoch, nativeMessageId })))}`
```

The coordinator applies the same `message:put` and `message:route` checks as an ordinary producer, with the authenticated drainer product context. It then validates the exact current `(sourceId, workerId, generation, leaseId)`, the unexpired lease, the expected cursor, the batch epoch, cursor monotonicity, record identity uniqueness, and capacity inside the bounded-local store's mutation critical section. A stale generation is rejected even if its old lease timestamp appears valid to the stale worker.

The cursor advances only after every record in the batch is either newly accepted or confirmed as the byte-equivalent idempotent replay. A crash after one or more puts but before cursor advancement is safe: the next worker rereads the same batch, receives idempotent replay for already accepted records, completes the rest, and advances once. A worker whose lease expires during a slow native read cannot import or advance after a successor acquires a newer generation.

The native source is read-only and retains stable `(sourceId, sourceEpoch, nativeMessageId, cursorAfter)` records. `sourceEpoch` change, cursor regression, key reuse with different content, malformed ordering, or an unavailable fence check stops the batch without cursor advancement. The drain never acknowledges, deletes, or mutates the source. Within one messaging-store lifetime, a new worker resumes at the in-memory checkpoint. After messaging-process restart, both destination and checkpoint are empty, so the source is replayed from origin into the new empty store.

## Bounded-local implementation shape

```ts
export interface BoundedLocalMessagingOptions {
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly maxMessageBytes: number;
  readonly maxSubscriptions: number;
  readonly defaultVisibilityTimeoutMs: number;
  readonly maxVisibilityTimeoutMs: number;
  readonly ackTombstoneTtlMs: number;
  /** Upper bound on retained ack tombstones. Tombstones count against store capacity and are reclaimed by TTL or this cap (oldest first), so acknowledgement history cannot grow unbounded relative to message capacity. */
  readonly maxAckTombstones: number;
  readonly maxDrainLeaseMs: number;
  readonly now?: () => Date;
  readonly id?: (kind: 'message' | 'delivery' | 'lease' | 'subscription' | 'drain-lease') => string;
}

export class BoundedLocalMessagingStore
  implements ClusterMeshMessagingPort, NativeDrainCoordinatorPort {
  constructor(input: {
    readonly options: BoundedLocalMessagingOptions;
    readonly authorization: MessagingProductAuthorizationPort;
    readonly routes: MessageTopicRoutePort;
  });

  put(input: PutMessageRequest): Promise<PutMessageResult>;
  pop(input: PopMessageRequest): Promise<PopMessageResult>;
  subscribe(input: SubscribeMessagesRequest): Promise<SubscribeMessagesResult>;
  ack(input: AckMessageRequest): Promise<AckMessageResult>;
  acquire(input: Parameters<NativeDrainCoordinatorPort['acquire']>[0]):
    ReturnType<NativeDrainCoordinatorPort['acquire']>;
  renew(input: Parameters<NativeDrainCoordinatorPort['renew']>[0]):
    ReturnType<NativeDrainCoordinatorPort['renew']>;
  importBatch(input: Parameters<NativeDrainCoordinatorPort['importBatch']>[0]):
    ReturnType<NativeDrainCoordinatorPort['importBatch']>;
  release(input: Parameters<NativeDrainCoordinatorPort['release']>[0]):
    ReturnType<NativeDrainCoordinatorPort['release']>;
}
```

The store keeps canonical messages once and mailbox delivery records by reference. A topic is resolved at `put` time into a sorted, duplicate-free snapshot of concrete mailboxes; later membership changes do not rewrite accepted deliveries. Each mailbox owns one monotonically increasing safe-integer sequence. The store rejects sequence exhaustion.

Capacity is measured before mutation using the canonical UTF-8 representation plus implementation-declared bookkeeping overhead. Acked and explicitly expired records may be reclaimed; visible or leased unacked records are never silently evicted. When safe reclamation cannot admit an entire direct put, topic fan-out, or drain batch, the operation returns `capacity_exhausted` and leaves no partial route set or cursor advance.

All local state disappears on restart. The instance closes subscriptions with `store_restarted` when orderly shutdown is observable; abrupt process loss is observed as transport loss. There is no local file, database table, outbox, hidden host persistence, or use of the frozen migration `0007`.

## Delivery, acknowledgement, and ordering semantics

- The guarantee is **at-least-once delivery within one live store instance** for an accepted, unexpired message when an authorized consumer continues polling or subscribing. It is not exactly-once processing and not restart-durable delivery.
- `pop` and subscription push use the same claim operation. A successful claim creates a unique visibility lease and increments `deliveryAttempt`. No two live leases for the same mailbox delivery may coexist.
- A claimed record is invisible until ack or lease expiry. At expiry it becomes eligible for redelivery with a new lease ID. The old lease can never ack the new attempt.
- `ack` is terminal for the mailbox delivery. Repeating the same authorized `(deliveryId, leaseId, ackIdempotencyKey, disposition)` during tombstone retention returns `idempotent_replay`. Changing any acknowledged content returns `ack_conflict`.
- Authorization precedes lease inspection so callers cannot probe delivery existence outside their product authority. Ack authorization or storage failure leaves the message unacked; it becomes visible after the lease expires.
- A subscription's `maxInFlight` bounds its unacked leases. Backpressure stops further claims; it does not drop records. Closing a subscription does not acknowledge deliveries, and its leases become redeliverable only at their existing expiry.
- Initial claims are selected by the lowest currently visible mailbox sequence. Multiple in-flight deliveries permit completion and redelivery order to differ from initial enqueue order. Products requiring strict serial completion set `maxInFlight: 1` and use one active consumer for that mailbox.
- Topic ordering is not a separate global log. Every concrete mailbox observes its own acceptance sequence. Two concurrent producers have the order in which the store commits their puts; there is no cross-process or wall-clock ordering claim.
- Message expiry is explicit. Once `expiresAt <= now`, an unleased record is terminally expired and not delivered. A lease already issued before expiry remains valid until its lease expiry so its authorized consumer can ack; it is not redelivered afterward.

The store retains no automatic poison-message policy. A consumer that has entered an external-effect boundary must use the terminal `quarantined` acknowledgement after reconciliation rather than depend on repeated delivery. Repeatedly unacked ordinary messages remain eligible and may eventually consume bounded capacity; overload is visible as fail-closed rejection, never silent loss.

## Failure and security semantics

| Boundary | Fail-closed behavior |
|---|---|
| `put` product auth or routing unavailable | Reject before message ID/sequence allocation; no partial topic fan-out. |
| Store capacity exhausted | Reject the complete operation; never evict an unacked record. |
| `pop`/`subscribe` authorization unavailable | Create no lease and reveal no delivery metadata. |
| Per-delivery `message:push` denied or unavailable | Yield nothing, create no new lease, and terminate the subscription as authorization-revoked or unavailable. |
| `ack` denied, stale, conflicting, or unavailable | Do not mutate delivery state; the valid current lease remains until ack or expiry. |
| Custody context/PDP/instruction resolution failure | Return `refused`; never call an actuator. Product authorization cannot override it. |
| Actuator throws or transport disconnects | Return `uncertain`; do not manufacture `failed`, `acted`, or an `effectRef`. Reconcile before a new command. |
| Native fence, lease, cursor, epoch, auth, or validation failure | Import nothing in that critical section and do not advance the cursor. |
| Store restart | Lose all bounded-local state by contract; make no durability or replay claim beyond retained-source rehydration. |

Message payload, metadata, native records, product scopes, and authorization decision references are untrusted data at their respective boundaries. Size, canonical JSON shape, finite numbers, timestamp parsing, address syntax, cursor progression, and configured time bounds must be validated before mutation. Logs and metrics may include IDs, route kind, attempts, outcome, and policy revision, but must not emit payloads, custody tokens, signed instructions, or authentication evidence.

## Decisions

### D-A — Store model and persistence

**AS-IS:** 0.9.0 has host-owned durable runtime ports but no messaging store. Migration `0007` is frozen and has no messaging schema.

**Options:**

- `{ key: 'bounded-local', title: 'In-memory bounded-local store', consequence: 'Ships the required core without schema; state and guarantees end at process restart, overload rejects instead of silently evicting unacked work.' }`
- `{ key: 'host-durable-port', title: 'Host-supplied durable messaging port', consequence: 'Could survive restart but requires a residence, transaction, recovery, retention, and compatibility decision outside this commission.' }`
- `{ key: 'database-schema', title: 'New cluster-mesh messaging tables', consequence: 'Requires an owner-approved schema and future migration; implementation must stop rather than change frozen migration 0007.' }`

**RECOMMENDED default:** `bounded-local`. Durable persistence is deferred and owner-gated; it is not required for this lock candidate.

### D-B — Delivery, acknowledgement, and visibility

**AS-IS:** 0.9.0 records command and actuation status but defines no message delivery guarantee, visibility lease, or message acknowledgement.

**Options:**

- `{ key: 'at-least-once-lease', title: 'At-least-once with visibility lease and idempotent ack', consequence: 'Consumer crash causes redelivery; stale leases cannot ack; processing must be idempotent and external effects require command-level reconciliation.' }`
- `{ key: 'at-most-once', title: 'Remove on delivery', consequence: 'Simpler but loses messages when a consumer or push transport fails after claim.' }`
- `{ key: 'exactly-once', title: 'Transactional exactly-once processing', consequence: 'Cannot be promised across product handlers and PTY effects without a durable shared transaction/effect protocol that does not exist.' }`

**RECOMMENDED default:** `at-least-once-lease`, with explicit terminal ack dispositions, lease-bound idempotent ack, no automatic effect retry, and no claim of restart durability.

### D-C — Delivery-to-actuator hand-off

**AS-IS:** 0.9.0 already owns `VerifiedInvocationContextPort` → `RegistrationGate.authorize(context, action)` → `CommandInstructionPort.resolve(...)` → selected `PtyActuatorPort.actuate(...)`. `commandRef` is opaque and the returned `ActuationResult` is authoritative.

**Options:**

- `{ key: 'existing-custody-seam', title: 'Adapter into the existing custody and signed-instruction seam', consequence: 'Messaging passes delivery identity, target/action, fixed commandRef, and opaque invocation/custody evidence; the existing gate resolves and actuates, and its ActuationResult flows back verbatim.' }`
- `{ key: 'embedded-instruction', title: 'Embed executable or signed instruction in the message', consequence: 'Creates stale/replayable authority in the store and bypasses the existing post-authorization resolver boundary.' }`
- `{ key: 'direct-pty', title: 'Messaging selects or calls PtyActuatorPort directly', consequence: 'Reimplements actuator selection and bypasses session custody/PDP; forbidden by the commission.' }`

**RECOMMENDED default:** `existing-custody-seam`. One message has one fixed `commandRef`/invocation tuple; redelivery never mints a new attempt. Returned outcomes are recorded exactly, and attempted or uncertain effects are reconciled before a new message is intentionally issued.

### D-D — Product authorization versus custody PDP

**AS-IS:** 0.9.0 has a session-custody PDP for actuation, but no authorization vocabulary for mailboxes, topics, routing, acknowledgement, or subscription push.

**Options:**

- `{ key: 'two-independent-gates', title: 'Distinct product-authz port and custody PDP', consequence: 'Product policy gates put/route/pop/subscribe/push/ack; the existing custody PDP separately gates actuation, and neither decision satisfies the other.' }`
- `{ key: 'reuse-custody-pdp', title: 'Use session custody for messaging access', consequence: 'Conflates resource access with target control, gives non-actuating messages an artificial custody requirement, and risks treating product access as actuation authority.' }`
- `{ key: 'store-only-authz', title: 'Authorize only at put/pop', consequence: 'Long-lived subscriptions and acknowledgements can outlive revocation; routing and per-delivery push remain unchecked.' }`

**RECOMMENDED default:** `two-independent-gates`, including per-push reauthorization and fail-closed policy-port failures.

### D-E — Native-drain fence, cursor, and idempotency

**AS-IS:** 0.9.0 has generation concepts but no native message import, drainer ownership, drain cursor, or native-message deduplication.

**Options:**

- `{ key: 'generation-lease-cas', title: 'Generation-and-lease fence with cursor CAS and deterministic import keys', consequence: 'Only the current worker can mutate; takeover increments generation; replay after a crash deduplicates accepted records before advancing the cursor.' }`
- `{ key: 'process-mutex', title: 'Process mutex only', consequence: 'Prevents local overlap but cannot fence a paused worker after lease expiry or authoritative replacement.' }`
- `{ key: 'distributed-durable-coordinator', title: 'Durable distributed fence and cursor', consequence: 'Supports multi-process restart survival but requires consistency, residence, schema, and recovery decisions outside bounded-local M01.' }`

**RECOMMENDED default:** `generation-lease-cas`, held in the same bounded-local instance as the destination. The source remains replayable and unmodified; restart rehydrates from origin rather than claiming a durable cursor.

### D-F — Ordering and topic/mailbox model

**AS-IS:** 0.9.0 defines neither topics nor mailboxes and makes no messaging-order claim.

**Options:**

- `{ key: 'mailbox-canonical-topic-fanout', title: 'Canonical mailboxes with put-time topic fan-out', consequence: 'Each mailbox gets a stable sequence and independent delivery/ack state; topic membership is snapshotted atomically at acceptance, with no global topic offset.' }`
- `{ key: 'topic-log-consumer-offsets', title: 'Canonical topic log with consumer offsets', consequence: 'Enables replayable shared logs but introduces retention, durable offsets, group ownership, and rebalance semantics inappropriate for the bounded-local first store.' }`
- `{ key: 'mailbox-only', title: 'Direct mailboxes only', consequence: 'Simplest ordering model but omits the requested topic routing surface and forces fan-out into every producer.' }`

**RECOMMENDED default:** `mailbox-canonical-topic-fanout`, with FIFO initial claim per mailbox, no completion-order promise under concurrency, and `maxInFlight: 1` for products that require serial completion.

## Consumer-confirm before lock

- **consumer-confirm M01-C1 — h-runtime hand-off input:** confirm that the authorized executor can preserve `commandRef === invocationId`, provide a fresh OQ5 custody token before the first call, and enter the existing session-control/custody adapter without any direct `PtyActuatorPort` path.
- **consumer-confirm M01-C2 — h-runtime result handling:** confirm that h-runtime can consume the `result | refused | uncertain` hand-off union, preserve `ActuationResult` verbatim, and reconcile a redelivered fixed command tuple instead of creating a fresh actuation attempt automatically.
- **consumer-confirm M01-C3 — native source:** confirm that the native adapter exposes stable, ordered, replayable `(sourceId, sourceEpoch, nativeMessageId, cursorAfter)` records and does not require destructive source acknowledgement. If it must delete or irreversibly advance the native source, durable destination residence becomes a blocking owner decision.
- **consumer-confirm M01-C4 — routing surface:** confirm the 0.10.0 consumer accepts canonical mailbox delivery with put-time topic fan-out and does not require durable topic offsets, consumer groups, or cross-process global ordering.

## Deferred owner-gated

- **Durable or distributed messaging:** restart-surviving messages, acknowledgements, topic offsets, fences, cursors, outbox semantics, multi-process author election, retention, and recovery require a separate owner-approved residence and consistency design. If implementation makes any of them required, it must stop and report rather than create or modify a migration. Migration `0007` remains **FROZEN**.
- **Destructive native drain:** deleting, acknowledging, truncating, or irreversibly advancing the native source is not allowed while the destination is volatile. Enabling it requires durable destination proof and an owner-gated cutover/recovery contract.
- **Deferred actuation ownership:** the 0.9.0 type can report `outcome: 'deferred'`, but queued/deferred custody execution and its execution lease remain separately owner-gated. M01 merely preserves an already-qualified actuator result; it does not activate a deferred executor.
- **Exactly-once effects:** a database/message transaction cannot include PTY I/O. Any future exactly-once effect claim needs an effect journal and reconciliation protocol owned with the actuator and custody design.
- **Federated topics and remote brokers:** cross-node routing, broker discovery, remote trust, flow control, and server-to-server delivery are outside the bounded-local 0.10.0 commission.
- **Administrative dead-letter surface:** durable quarantine inspection, replay, purge, and retention policy need a product decision. The bounded-local core only records a terminal quarantine disposition for its instance lifetime.

No durable persistence or schema is required by the recommended defaults. The only lock blockers are the four consumer confirmations and owner confirmation or override of decisions D-A through D-F.
