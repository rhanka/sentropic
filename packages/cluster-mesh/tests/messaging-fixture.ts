import {
  BoundedLocalMessagingStore,
  type BoundedLocalMessagingOptions,
  type MessageTopicRoutePort,
  type MessagingProductAction,
  type MessagingProductAuthorizationDecision,
  type MessagingProductAuthorizationPort,
  type MessagingProductContext,
  type PutMessageRequest,
} from '../src/index.js';

export const productContext: MessagingProductContext = {
  principalId: 'product-1', tenantId: 'tenant-1', workspaceId: 'workspace-1',
  scopes: ['messages'], policyRevision: 'revision-1', authenticationEvidenceRef: 'auth-1',
};

type AuthorizationHandler = MessagingProductAuthorizationPort['authorize'];
type RouteHandler = MessageTopicRoutePort['resolve'];

export function messagingFixture(input: {
  readonly options?: Partial<BoundedLocalMessagingOptions>;
  readonly authorize?: AuthorizationHandler;
  readonly routes?: RouteHandler;
} = {}) {
  let nowMs = Date.parse('2030-01-01T00:00:00.000Z');
  const counters = new Map<string, number>();
  const authorizationCalls: Array<Parameters<AuthorizationHandler>[0]> = [];
  const routeCalls: Array<Parameters<RouteHandler>[0]> = [];
  let authorize: AuthorizationHandler = input.authorize ?? (async ({ context }) => ({
    ok: true, decisionRef: 'allow-1', policyRevision: context.policyRevision,
  }));
  let resolve: RouteHandler = input.routes ?? (async () => ['mailbox-b', 'mailbox-a', 'mailbox-a']);
  const store = new BoundedLocalMessagingStore({
    options: {
      maxMessages: 20, maxBytes: 100_000, maxMessageBytes: 10_000,
      maxSubscriptions: 4, defaultVisibilityTimeoutMs: 100,
      maxVisibilityTimeoutMs: 1_000, ackTombstoneTtlMs: 1_000,
      maxAckTombstones: 10, maxDrainLeaseMs: 1_000,
      now: () => new Date(nowMs),
      id: (kind) => {
        const next = (counters.get(kind) ?? 0) + 1;
        counters.set(kind, next);
        return `${kind}-${next}`;
      },
      ...input.options,
    },
    authorization: {
      async authorize(call) {
        authorizationCalls.push(call);
        return authorize(call);
      },
    },
    routes: {
      async resolve(call) {
        routeCalls.push(call);
        return resolve(call);
      },
    },
  });
  return {
    store,
    authorizationCalls,
    routeCalls,
    advance(ms: number) { nowMs += ms; },
    setAuthorization(handler: AuthorizationHandler) { authorize = handler; },
    setRoutes(handler: RouteHandler) { resolve = handler; },
  };
}

export const allow = (revision = productContext.policyRevision): MessagingProductAuthorizationDecision => ({
  ok: true, decisionRef: 'allow', policyRevision: revision,
});

export const putRequest = (
  idempotencyKey: string,
  overrides: Partial<PutMessageRequest> = {},
): PutMessageRequest => ({
  context: productContext,
  destination: { kind: 'mailbox', mailboxId: 'mailbox-1' },
  idempotencyKey,
  payload: { contentType: 'application/json', value: { text: idempotencyKey } },
  ...overrides,
});

export const denyAction = (action: MessagingProductAction): AuthorizationHandler =>
  async (call) => call.action === action
    ? { ok: false, reason: 'forbidden' }
    : allow(call.context.policyRevision);
