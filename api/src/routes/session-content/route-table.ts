/**
 * RC2.receiver frozen dispatch table (plan v1.6 r2 lot RC2.receiver, line 646).
 *
 * Source of truth: RC2.contract r3 manifest
 * /home/antoinefa/src/h2a/tmp/h-cond/rc2-contract/remote-session-contract-manifest.v1.json
 * sealed by MANIFEST.sha256 6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715
 * (manifest JSON sha256 88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565;
 * replaces r2 133e23f5…, delta in CHANGES-r3.md: N1 tool_call_delta args→delta, N2 policy-confirm
 * bodyless plus the zero-entity-bytes rule on the 14 bodyless/query routes, N3/N4 labels only).
 * A further re-pin = replace both pins and regenerate RECEIVER_ROUTE_TABLE; every route carries
 * its vectorSha256 so a per-route vector receipt can be asserted (R-9).
 */

/** Sealed RC2.contract r3 manifest hash (MANIFEST.sha256). Change only on an accepted re-pin. */
export const CONTRACT_MANIFEST_SHA256 =
  '6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715';

/** Sealed RC2.contract r3 manifest JSON hash (remote-session-contract-manifest.v1.json). */
export const CONTRACT_MANIFEST_JSON_SHA256 =
  '88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565';

export const RELAY_MOUNT = '/mesh/v1/session-relay';
export const CONTENT_MOUNT = '/api/v1/auth/session/content';
export const INNER_MOUNT = '/mesh/v1/remote-sessions';
export const REMOTE_MOUNT = '/api/v1/auth/session/remote';
export const IDP_MOUNT = '/api/v1/auth/session/content-policy-evidence';

/** Exact WSS subprotocol of the outer relay upgrade (plan §3.2.2). */
export const RELAY_WSS_SUBPROTOCOL = 'cluster-mesh.session-relay.v1';

export type ReceiverLane = 'lifecycle' | 'content' | 'actions' | 'results' | 'outer' | 'browser' | 'internal';
export type ReceiverStage = 'listing' | 'bootstrap' | 'bound';
export type ReceiverEngine = 'cli' | 'app-chat';
/** Refusal family per route (R-2): relay = SessionRelayErrorV1, view = RemoteSessionViewErrorV1, rc0-http = frozen RC0 HTTP union. */
export type RefusalFamily = 'relay' | 'view' | 'rc0-http';
export type RouteMount = 'relay' | 'content' | 'inner' | 'remote' | 'idp';

export interface ReceiverRoute {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly lane: ReceiverLane;
  readonly stages: readonly ReceiverStage[];
  readonly engines: readonly ReceiverEngine[];
  readonly authority: string;
  readonly refusal: RefusalFamily;
  readonly successStatus: number;
  readonly maxRequestBytes: number;
  readonly vectorSha256: string;
}

export const mountOfPath = (path: string): RouteMount => {
  if (path.startsWith(`${RELAY_MOUNT}/`)) return 'relay';
  if (path.startsWith(`${INNER_MOUNT}/`)) return 'inner';
  if (path.startsWith(`${REMOTE_MOUNT}/`)) return 'remote';
  if (path === IDP_MOUNT || path.startsWith(`${IDP_MOUNT}/`)) return 'idp';
  return 'content';
};

/** The 38 manifest routes (28 inner: 19 frozen RC0 + 9 additive mesh, 2 outer relay, 5 browser V, 2 policy, 1 policy-idp). */
export const RECEIVER_ROUTE_TABLE: readonly ReceiverRoute[] = [
  { id: "source-open", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions", lane: "lifecycle", stages: ["bootstrap", "bound"], engines: ["cli"], authority: "source-register", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "26bda742c134fc2d072e97e915f34da95d627d5b312c71161e58a4cbba64e4cd" },
  { id: "source-renew", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/renew", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "source-control", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "9aeecf90f6e323f1ffc7819ec6c3bd30d4f230a485eb1b3ca2b03c9e5a62f410" },
  { id: "grant-fetch", method: "GET", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/grants/:proposalId", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "source-control", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "8c90567874b669520d26342acdfbf4aff344c691b793a105109d45c2155fc284" },
  { id: "policy-fetch", method: "GET", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/policies/:policyId/:policyRevision", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "source-control", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "ed2c60094373b82e876a4e4c3b19a255f514aefe50f5792f6e619737b141e43b" },
  { id: "activation-ack", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/acks", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "source-ack", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "108aabaadfed51c40ba89680c21ae92dc91eb3840a987c810d046022ea0f1519" },
  { id: "native-challenge", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/challenges", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "source-control", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "e051cb152da481009ae45dc33ee9ea0eb7b752b64f4b465dbde0a768dfb94ba4" },
  { id: "source-control", method: "GET", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/control", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "source-control", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "2e94ac5e0d6351fa635506ad0f4387cbfffcd22925f0ab75af3d6af4602ac999" },
  { id: "cli-proof", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/proofs", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "proof-publish", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "7ad92a453d6c0d889bab419e4865a5893a9c18ba3390f5f6a2071866cb471742" },
  { id: "action-nonce", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/nonces", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "nonce-publish", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "9e3823d0ab962d3cba8924b19f08d4a05de205f1c24456be3b45301d8da15fdb" },
  { id: "continuity-ack", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/acks", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "source-ack", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "a0cbb76a6b9f930119e9a5550f38ae37e6dd94ead12f36409feb39c3100cd41a" },
  { id: "history-auth", method: "GET", path: "/api/v1/auth/session/content/:bindingId/history/authorizations/:authorizationId", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "retained-read", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "ecd8d776d18f8cde487986d4797f68a7b8d3aac01eef8c456bfdfca2e90430c5" },
  { id: "history-admission", method: "GET", path: "/api/v1/auth/session/content/:bindingId/history/admissions/:descriptorHash", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "retained-read", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "30a6fb6ea54aa8fe7157a764229393694419f062a919e79973f1301999453d27" },
  { id: "typed-events", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/events", lane: "content", stages: ["bound"], engines: ["cli"], authority: "capture", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "f432c01de4adc5f1769b623ebf35cbf0190e26db14f7882a57b19be5f16953d0" },
  { id: "pty-fragments", method: "POST", path: "/api/v1/auth/session/content/:bindingId/fragments", lane: "content", stages: ["bound"], engines: ["cli"], authority: "capture", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "cea3d94e4ec06a7130a95f6987b6ca3dd9190cdb00c6f2c4bb6468c06d3b930f" },
  { id: "archive-snapshot", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/snapshots", lane: "content", stages: ["bound"], engines: ["cli"], authority: "capture", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "2c4d21af07539ae0f2bd6ab1915b628584af65cd1a491d477f037a742aa27450" },
  { id: "archive-segment", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/segments", lane: "content", stages: ["bound"], engines: ["cli"], authority: "capture", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "9535f53d46f6bd3b4ef5e0edc78ad0d6418f0351b33596c2cbc42b09f0228c0d" },
  { id: "action-stream", method: "GET", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/stream", lane: "actions", stages: ["bound"], engines: ["cli"], authority: "action-channel", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "1d9c3a48f0a19c0858ce5cf82ea181d27e8945bd07665ca35a2cae0947a644e4" },
  { id: "action-claim", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/:actionId/claim", lane: "actions", stages: ["bound"], engines: ["cli"], authority: "action-claim", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "8735fae8ff6d153d0b0fcdf0462346cbe3c90776e1440efbb4814aa871d8c4b6" },
  { id: "action-result", method: "POST", path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/:actionId/results", lane: "results", stages: ["bound"], engines: ["cli"], authority: "result-publish", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "20e3a453f6427cf71abee300dd99b9b6548938f68d8647668cac19bc473ea332" },
  { id: "listing-grant-fetch", method: "GET", path: "/mesh/v1/remote-sessions/:sessionId/listing-grants/:grantId", lane: "lifecycle", stages: ["listing", "bootstrap", "bound"], engines: ["cli", "app-chat"], authority: "listing-approved-descriptor", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "0046d35b1bc8698203741279922653efff01f5a2cb334ce2c18c0d664f9605c2" },
  { id: "listing-grant-ack", method: "POST", path: "/mesh/v1/remote-sessions/:sessionId/listing-grants/:grantId/acks", lane: "lifecycle", stages: ["listing", "bootstrap", "bound"], engines: ["cli", "app-chat"], authority: "listing-approved-descriptor", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "147690f35239c66d3a880d23996409690d52ee5edab09565e28a7748f1735b6b" },
  { id: "listing-publish", method: "POST", path: "/mesh/v1/remote-sessions/:sessionId/listing", lane: "lifecycle", stages: ["listing", "bootstrap", "bound"], engines: ["cli", "app-chat"], authority: "listing-acknowledged", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "98ac691268eb226e98ab7d4051be9b4e41cfd03341a54d02071390f5873870b1" },
  { id: "freshness-publish", method: "POST", path: "/mesh/v1/remote-sessions/:sessionId/freshness", lane: "lifecycle", stages: ["listing", "bootstrap", "bound"], engines: ["cli", "app-chat"], authority: "visibility-grant", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "94b12eec8b215c25ede6655fb8ed72d2f599e0ffd1978ef5c6a23fc400c4782f" },
  { id: "lifecycle-publish", method: "POST", path: "/mesh/v1/remote-sessions/:sessionId/lifecycle", lane: "lifecycle", stages: ["bound"], engines: ["cli", "app-chat"], authority: "activated-read-export", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "078cc15260f9fa8291491f99178627e94ca93edf8320a252a55ec24db8a55cdf" },
  { id: "snapshot-publish", method: "POST", path: "/mesh/v1/remote-sessions/:sessionId/snapshot", lane: "lifecycle", stages: ["bound"], engines: ["cli", "app-chat"], authority: "activated-read-export", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "99d7d7c91280e4d9db21cc05a48f31baf4f85222061d43c398f30b775871ff9d" },
  { id: "drive-binding-fetch", method: "GET", path: "/mesh/v1/remote-sessions/:sessionId/drive-bindings/:bindingId/:consentRevision", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "paired-drive-consent", refusal: "relay", successStatus: 200, maxRequestBytes: 0, vectorSha256: "1785998e25a3a93eb9f2e2935b0756c86206974d14be939cb948f617875a8069" },
  { id: "drive-binding-ack", method: "POST", path: "/mesh/v1/remote-sessions/:sessionId/drive-bindings/:bindingId/:consentRevision/acks", lane: "lifecycle", stages: ["bound"], engines: ["cli"], authority: "paired-drive-consent", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "2284c04fa886ed0fc135aa0be62675bce8d3ab728847a8b0339018366578fdc3" },
  { id: "chat-events", method: "POST", path: "/mesh/v1/remote-sessions/:sessionId/chat/events", lane: "content", stages: ["bound"], engines: ["app-chat"], authority: "conversation-read-export", refusal: "relay", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "e371e1595928fa5e6dca8d28d0270bfb18b056b3d0a06914c2cd78995e4667be" },
  { id: "relay-prepare", method: "POST", path: "/mesh/v1/session-relay/routes", lane: "outer", stages: [], engines: ["cli", "app-chat"], authority: "H2-I + approved path + endpoint admissions", refusal: "relay", successStatus: 200, maxRequestBytes: 8192, vectorSha256: "578ef46081dee293f53c44a63145a1f7c72434e0c870abf3fca796c1a4baa47a" },
  { id: "relay-upgrade", method: "GET", path: "/mesh/v1/session-relay/tunnels/:tunnelId", lane: "outer", stages: [], engines: ["cli", "app-chat"], authority: "H2-I + unused prepared adjacency", refusal: "relay", successStatus: 101, maxRequestBytes: 0, vectorSha256: "5ef144bce3c87cef8e6e9973de26770d1fe78e76cbb7cbb18cdbd965517357ce" },
  { id: "browser-listing-create", method: "POST", path: "/api/v1/auth/session/remote/listing-grants", lane: "browser", stages: [], engines: ["cli", "app-chat"], authority: "owner-login + explicit listing choice + Origin/CSRF", refusal: "view", successStatus: 201, maxRequestBytes: 65536, vectorSha256: "e41a33356038d4367d5e9bbf7b630195bca7109e9609ee7a214ab86a9efdfbbc" },
  { id: "browser-listing-delete", method: "DELETE", path: "/api/v1/auth/session/remote/listing-grants/:grantId", lane: "browser", stages: [], engines: ["cli", "app-chat"], authority: "owner-login + denial/subscriber commit + Origin/CSRF", refusal: "view", successStatus: 204, maxRequestBytes: 0, vectorSha256: "f61ebb633ebd3a061a03b4d9d516fe03cb2ad83e3c41e081bba52d214b116bc5" },
  { id: "browser-list", method: "GET", path: "/api/v1/auth/session/remote/sessions", lane: "browser", stages: [], engines: ["cli", "app-chat"], authority: "current per-row listing/read grant", refusal: "view", successStatus: 200, maxRequestBytes: 0, vectorSha256: "9a100babfa87ccc9f758787dd90bff2400cdba40b71c9d2daeeda3e3a2e473df" },
  { id: "browser-detail", method: "GET", path: "/api/v1/auth/session/remote/sessions/:sessionId", lane: "browser", stages: [], engines: ["cli", "app-chat"], authority: "current activated/retained read", refusal: "view", successStatus: 200, maxRequestBytes: 0, vectorSha256: "6a4a023c622cae0c01b9679760d1428845d8b9e289402e45988624e7f2e1747e" },
  { id: "browser-events", method: "GET", path: "/api/v1/auth/session/remote/sessions/:sessionId/events", lane: "browser", stages: [], engines: ["cli", "app-chat"], authority: "current listing/read/capture per event", refusal: "view", successStatus: 200, maxRequestBytes: 0, vectorSha256: "5478790a519af38634e1a3c9cf17007f7b0f9f2bc3d9f212cf2544b918007144" },
  { id: "policy-intent", method: "POST", path: "/api/v1/auth/session/content/:bindingId/policy-proposals", lane: "browser", stages: [], engines: ["cli"], authority: "owner-login + explicit policy intent + Origin/CSRF", refusal: "rc0-http", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "e0905739382f0f38222f2453db28a31f1c7784c6d312b153a092aad924a1e031" },
  { id: "policy-confirm", method: "POST", path: "/api/v1/auth/session/content/:bindingId/policy-proposals/:proposalId/confirm", lane: "browser", stages: [], engines: ["cli"], authority: "owner-login + exact proposal + Origin/CSRF", refusal: "rc0-http", successStatus: 200, maxRequestBytes: 0, vectorSha256: "8b833543ccb95ded8e22aaf8c5a3c90a80f3c78b5d36fdfb43b5a722bc3e3161" },
  { id: "policy-idp", method: "POST", path: "/api/v1/auth/session/content-policy-evidence", lane: "internal", stages: [], engines: ["cli"], authority: "isolated policy workload TLS + issuer-verifiable current credential", refusal: "rc0-http", successStatus: 200, maxRequestBytes: 65536, vectorSha256: "90d706ccc2be27d04d47999816442ee0adc2ed1cba249d401b11693eb4a6783b" },
];

export const routeById = (id: string): ReceiverRoute | undefined =>
  RECEIVER_ROUTE_TABLE.find((route) => route.id === id);

/** Exact method+path match after identifier resolution; no wildcard, verb alias or unlisted endpoint is admitted. */
export const matchRoute = (method: string, path: string): ReceiverRoute | undefined =>
  RECEIVER_ROUTE_TABLE.find((route) => route.method === method && route.path === path);

/** Closed route→lane table (W04): one lane per route; no HTTP/2 stream crosses lanes. */
export const LANE_ROUTES: Readonly<Record<ReceiverLane, readonly string[]>> = {
  lifecycle: RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'lifecycle').map((r) => r.id),
  content: RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'content').map((r) => r.id),
  actions: RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'actions').map((r) => r.id),
  results: RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'results').map((r) => r.id),
  outer: RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'outer').map((r) => r.id),
  browser: RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'browser').map((r) => r.id),
  internal: RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'internal').map((r) => r.id),
};

/** Listing-stage subset (plan §3.2.2): lifecycle only, exactly these four routes. */
export const LISTING_STAGE_ROUTE_IDS = [
  'listing-grant-fetch', 'listing-grant-ack', 'listing-publish', 'freshness-publish',
] as const;

/** Bootstrap stage: CLI only, source-open plus the listing-stage subset when independently listing-authorized. */
export const BOOTSTRAP_STAGE_ROUTE_IDS = ['source-open', ...LISTING_STAGE_ROUTE_IDS] as const;
