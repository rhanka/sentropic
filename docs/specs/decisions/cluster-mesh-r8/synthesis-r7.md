# Reconciled architecture synthesis — cluster-mesh shared core

Status: converged r7 authoring synthesis; D1–D5 are owner-decided, D6–D12 incorporate owner rework, and D10 remains open.
Revision: 2026-08-29-r7

Inputs:

- .tmp/engage/cluster-mesh-shared-core-raw-spec.md
- .tmp/engage/cluster-mesh-shared-core-synthesis-r1.md, r6 candidate identified by SHA-256 4efadd5d8be4930f1ea8919ffb064ef245c3470d71bfb47feacb5be058d28c13 in .tmp/engage/cluster-mesh-shared-core-owner-feedback-r6.json:3-5
- .tmp/engage/cluster-mesh-shared-core-owner-feedback-r6.json
- .tmp/engage/cluster-mesh-shared-core-r7-fable.md
- .tmp/engage/cluster-mesh-shared-core-r7-sol.md
- h2a evidence: packages/h2a/src/envelope.ts, packages/h2a/src/signature.ts, docs/specs/2026-08-15-SPEC_STUDY_memory-core-graphify-max.md, scratchpad/2026-08-15-DECISION-DOSSIER-agent-memory-core.md, and scratchpad/reviews/memory-core-graphify-max-architecture.md
- Graphify evidence: spec/SPEC_EVOL_AGENT_MEMORY_SUBSTRATE.md

## 1. Architectural thesis

cluster-mesh is the mandatory shared execution and coordination core for h2a and the Sentropic application. It remains a small workspace-scoped composition, policy, transaction, and audit kernel: providers keep their domain algorithms, protocol semantics, durable domain records, infrastructure, and secrets. This is one target, not an h2a target beside a separate application target (.tmp/engage/cluster-mesh-shared-core-raw-spec.md:7-19,34-44).

**Invocation path — runtime.** The cluster-mesh runtime admits, authorizes, correlates, deduplicates, audits, and receipts every capability invocation before any provider effect. No invocation is unwrapped in the target, including native MCP discovery/calls, workspace MCP proxying, enrollment, Track, Focus, messaging, sessions, terminal action, LLM use, workflows, and memory (.tmp/engage/cluster-mesh-shared-core-owner-feedback-r6.json:13-16; .tmp/engage/cluster-mesh-shared-core-r7-sol.md:20-26,206-214).

**Authoring boundary — packages.** MCP wire/platform/session/consent/enrollment/secret semantics and the MCP-to-neutral-invocation adapter are authored by the Sentropic MCP library, specifically @sentropic/mcp-platform with @sentropic/mcp-auth; cluster-mesh neither reimplements nor privately authors those semantics (.tmp/engage/cluster-mesh-shared-core-r7-fable.md:28-43; .tmp/engage/cluster-mesh-shared-core-r7-sol.md:216-224).

The same separation applies elsewhere: LLM Mesh authors model-account enrollment and routing, Graphify authors memory, h2a authors coordination/Track/Focus/local execution, and the hosts only compose provider-authored adapters with the neutral core. Runtime dependence on cluster-mesh is universal; compile-time dependence by the core on provider implementations is forbidden.

## 2. Evidence baseline

| Concern | Evidence-based current fact | Target implication |
|---|---|---|
| cluster-mesh | The current package is a narrow topology/membership/trust/projection/NHI seam, not the universal invocation runtime (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:43-49). | Generalize the existing wrap/port seam into the mandatory invocation gateway; do not label the target as implemented. |
| MCP | @sentropic/mcp-platform already owns provider, consent, enrollment, session, authorization, durable-call, and store contracts; current stores remain mock-grade, and the application still has a direct connector-host route (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:50-54). | The MCP library authors native ingress and provider bindings; all semantic effects cross cluster-mesh; durable ports and bypass removal remain transition gates. |
| h2a MCP lifecycle | h2a central-auto is a local process-lifecycle concern, while the Sentropic MCP library is the connector/platform concern; mcp-auth becomes the authorization seam when ingress exceeds loopback-only use (.tmp/engage/cluster-mesh-shared-core-r7-fable.md:45-51). | Keep lifecycle in an h2a host adapter; mount provider-authored ingress; never create a second MCP contract in the host. |
| Sessions and streaming | The app has durable ordered stream storage and replay; h2a remote commands/events are currently live and mostly in memory, without the shared transaction model described here (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:55-58,60-70). | Preserve local-only authority locally; make the app ledger authoritative for app-managed remote control; add fenced adoption, outbox/inbox, producer cursors, and commit-before-display. |
| h2a↔Graphify memory | The owner fixed M2=B · M3=B · M4=B · M5=C · M6=B · M7=B, retained F1/F2/F3, and directed maximum Graphify reuse with no bespoke h2a memory engine (/home/antoinefa/src/h2a/scratchpad/2026-08-15-DECISION-DOSSIER-agent-memory-core.md:691-700). | D8 starts from this design; cluster-mesh wraps the provider invocation and supplies verified context, but authors no memory semantics. |
| Graphify readiness | graphify-memory is a committed design whose implementation is blocked until the named realization and exit gates pass; its neutral package boundary and deployment modes are normative design, not current availability (/home/antoinefa/src/graphify/spec/SPEC_EVOL_AGENT_MEMORY_SUBSTRATE.md:1-20,34-59,1148-1181). | Reuse the designed ports and ownership split; gate activation and prohibit a substitute cluster-mesh memory store. |
| Signed h2a envelopes | h2a signs the full envelope view except the signatures array and verifies Ed25519 signatures, but actor-role validation only checks membership in the role vocabulary; the signature container carries by, alg, and signature value (/home/antoinefa/src/h2a/packages/h2a/src/envelope.ts:27-38,52-102; /home/antoinefa/src/h2a/packages/h2a/src/signature.ts:6-19). | Reuse canonical signing and verify-before-act evidence, but add authority-signed mandate proof, key binding/status, durable replay, action-time revocation, and a decided confidentiality profile. |
| LLM enrollment | LLM Mesh owns enrollment contracts and local keyring semantics, while the app has a separate account implementation today (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:57-58). | Converge on one LLM Mesh account authority, one non-secret shared descriptor, and one physical credential custodian per custody epoch. |
| Architecture rendering | The owner requires a design-system component plus a Focus skill, rejects off-DS rounded cards, and defers the deeper renderer decision to h2a/Focus (.tmp/engage/cluster-mesh-shared-core-owner-feedback-r6.json:25-27). | D9 is provisional C only; rendering becomes DS-owned and the renderer study stays outside this dossier. |

Evidence labels are strict throughout: **current** means observed implementation; **committed design** means a normative design exists without claiming implementation; **target** means this architecture; **open** means owner/security judgment remains required.

## 3. One stable three-level model

Notation, unchanged from r1 (.tmp/engage/cluster-mesh-shared-core-synthesis-r1.md:40-49):

- [F] application function: an outcome or behavior;
- (C) application component: a composable or deployable implementation;
- {I} interface: a versioned port or protocol boundary;
- [D] data and [N] infrastructure: store, process, terminal, gateway, or transport.

Every current, transition, and target view reads left-to-right as **Level 1 entry point → Level 2 shared core → Level 3 provider/store**. Stable semantic nodes retain their identifiers and lane positions; inactive target nodes are marked unbound rather than presented as current capability.

### Level 1 — experiences and entry points

| Functions | Components |
|---|---|
| [F] inspect and conduct work; review and decide; administer a workspace; control or observe a session; invoke an MCP/LLM/memory capability; enroll or bind an account | (C) h2a CLI; (C) h2a local server; (C) Sentropic app/API; (C) native CLI host; (C) MCP client; (C) agent/automation |

Target entry paths:

- h2a CLI → authenticated h2a local-server ingress → cluster-mesh runtime;
- Sentropic UI → Sentropic API host → cluster-mesh runtime;
- MCP client → MCP-platform-authored native ingress → cluster-mesh runtime;
- native CLI and agents → an authenticated host ingress → cluster-mesh runtime;
- both h2a and the app administer and use the same non-secret connector/account descriptors and bindings; provider credentials are never copied to either surface.

### Level 2 — cluster-mesh shared execution core

| Functions | Components and interfaces |
|---|---|
| [F] admit every invocation and resolve verified tenant/workspace/principal/mandate context | (C) ClusterInvocationGateway; (C) WorkspaceRuntime; {I} PrincipalResolver; {I} MandateVerifier; {I} WorkspaceDirectory |
| [F] authorize, correlate, deduplicate, bind, route, and receipt capability effects | (C) CapabilityRegistry; (C) PolicyRouter; (C) InvocationSupervisor; {I} CapabilityProvider; {I} InvocationReceipt |
| [F] coordinate durable commands, recovery, cancellation, replay references, and audit without becoming the domain writer | (C) Transaction/Outbox coordinator; (C) RecoveryCoordinator; {I} Persistence; {I} RecoveryHook; {I} EventSink |
| [F] select an authorized enrollment or custody route without receiving a secret | (C) EnrollmentBindingRegistry; {I} EnrollmentProvider; {I} SecretReference; {I} CustodianRoute |
| [F] coordinate session authority modes and replication cursors | {I} SessionProvider; {I} SessionLedger; {I} SessionReplica; {I} CommandOutbox; {I} ExecutorInbox |

Core stopping rule: if a behavior can evolve without knowing workspace isolation, generic invocation admission, transaction fencing, or cross-capability audit, it is provider behavior and stays outside the core.

### Level 3 — providers, adapters, infrastructure, and data

| Provider group | Functions | Components / infrastructure / data |
|---|---|---|
| h2a collaboration | [F] Track, Focus, decisions, local messages, presence, local sessions | Track; Focus; h2a secure-message and session providers; append-only Track data; h2a inbox/outbox/presence |
| h2a execution and NHI | [F] verified local wake/action and workload custody | h2a-runtime terminal adapter; tmux/native/PTY actuator; NHI/key provider; OS keyring/files |
| Sentropic identity/workspace | [F] OAuth/OIDC authentication, mandates, grants, product workspaces | oauth/auth providers; workspace service; product SQL; mandate/revocation/status stores |
| Sentropic MCP library | [F] native MCP ingress, protocol/session semantics, connector catalog, visibility, consent, enrollment, elicitation, durable calls, proxying | @sentropic/mcp-platform; @sentropic/mcp-auth; connector host/broker seam; concrete connector adapters; SQLite/server SQL; secret-provider handles |
| LLM, agents, workflows | [F] account enrollment, custody-aware routing, generation, turns, tools, workflows | LLM Mesh; LLM Gateway; provider adapters; agent/chat runtime; Flow; local keyring or managed secret store; checkpoints/queues |
| Graphify memory | [F] capture, canonical lifecycle, admission, ranking, projections, final revalidation | designed graphify-memory provider; AuthorizationPort; ActivityEvidenceSource; CanonicalMemoryStorePort; local SQLite or parity-gated managed Postgres; rebuildable graph/vector projections |

## 4. Two visual dimensions for D6/D11

The runtime path and the authoring boundary must never be collapsed into one diagram axis.

### Dimension A — runtime invocation path

~~~text
Level 1  h2a | Sentropic app | native CLI | MCP client | agent
             -> provider-authored authenticated ingress
Level 2      -> cluster-mesh WorkspaceRuntime / ClusterInvocationGateway
                 admit -> verify mandate -> authorize -> correlate
                 -> idempotency/replay -> binding revision -> audit/receipt
Level 3      -> selected provider -> domain effect -> provider receipt
~~~

Every arrow that can cause a capability effect crosses Level 2. Parsing a wire frame before the gateway is not an effect; discovery, enrollment, consent, invocation, streaming, cancellation, and resume are effects or effect-bearing operations and therefore cross the gateway (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:216-240).

### Dimension B — package authorship

~~~text
neutral invocation contracts -> cluster-mesh core
neutral/provider contracts   -> provider libraries
cluster-mesh + provider lib  -> provider-authored adapter
core + adapter + stores      -> h2a/Sentropic composition root

MCP authorship: @sentropic/mcp-platform + @sentropic/mcp-auth
MCP deployment: h2a local server or Sentropic API mounts the adapter
MCP execution: every operation is wrapped by cluster-mesh
~~~

Provider libraries do not import application internals. The neutral core does not import MCP tool schemas, provider tokens, Graphify DTOs, h2a registry formats, terminal drivers, or application database drivers.

### MCP invocation and binding schema

~~~text
MCP client
  -> @sentropic/mcp-platform NativeMcpIngress
       wire/session/authentication; map to neutral invocation
  -> cluster-mesh ClusterInvocationGateway
       boundary + mandate + capability + idempotency + transaction + audit
  -> MCP-platform-authored provider binding
       active connector instance + enrollment + consent + capability digest
       + credential-custodian reference + active binding revision
  -> connector-host / concrete connector
  -> progress, elicitation, result and receipts through the gateway

Core keeps: invocation/binding/consent/custodian references and receipts
MCP provider keeps: MCP session, enrollment semantics and connector records
Secret provider keeps: tokens, refresh material and provider credentials
~~~

The schema resolves D6 and is part of D11, not a detached appendix. It reflects the evidence-based call chain and binding fields in .tmp/engage/cluster-mesh-shared-core-r7-sol.md:226-271.

## 5. Comparable current, transition, and target states

| View | Level 1 — experiences | Level 2 — shared core | Level 3 — provider/data authority |
|---|---|---|---|
| Current | h2a, the app, MCP, and native clients use several separate direct paths. | cluster-mesh serves its current narrow seam; the universal invocation gateway is not current. | h2a files/terminal, direct app MCP/LLM paths, product SQL, and current Graphify code retain their authorities. |
| Transition | Each capability slice moves behind a provider-authored adapter and the gateway; the old write/effect path is fenced and then removed. | Gateway contracts, receipts, outbox, binding revisions, authority homes, and epochs activate incrementally. | Existing providers and stores remain semantic owners; durable migrations never create a second active writer or secret copy. |
| Target | All entry points invoke shared contracts; h2a and the app share connector/account visibility and custody-aware use. | One workspace-scoped gateway admits, authorizes, correlates, deduplicates, audits, and receipts every invocation. | MCP Platform, LLM Mesh, Graphify, h2a/Track/Focus, identity, agents, and workflows keep their domain semantics and authoritative data. |

The current view must visibly show bypasses and incomplete capabilities; it may not depict the target core as already mandatory (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:648-672).

## 6. D7 transactional session contract

Session authority is explicit and independent from executor placement, credential custody, and viewer/controller.

| Authority mode | Session transaction owner | Executor | App copy/control |
|---|---|---|---|
| LOCAL_ONLY | h2a local session provider and its PC-local journal | PC/local host | no app-managed guarantee; local use may continue |
| ADOPTING | fenced transition; neither side accepts conflicting commands | current executor paused or bounded | read-only progress while snapshot, high-water, hash, and epoch are reconciled |
| APP_MANAGED | Sentropic app Session Ledger | PC, app worker, or another authorized executor | app commits every command and every recoverable displayed event; replay and streaming are app-backed |
| DETACHING | fenced transition | selected destination executor | read-only progress until checkpoint, high-water, fence, and authority epoch switch commit |

The owner-requested remote-control path is:

~~~text
owner instruction
  -> app authentication and cluster-mesh admission
  -> app transaction: CommandAccepted + session revision + durable outbox
  -> signed recipient-bound courier
  -> PC durable inbox/dedup + action-time re-verification + custody check
  -> executor effect + producer-sequenced events in a retransmission spool
  -> cluster-mesh admission of events
  -> app ledger transaction assigns canonical sequence and high-water
  -> acknowledgement after commit
  -> UI streaming/replay from the app copy
~~~

The transaction rules are:

1. In LOCAL_ONLY, the PC-local provider is the sole journal writer.
2. In APP_MANAGED, the app Session Ledger is the sole canonical session writer even when execution and credential custody remain on the PC; a new human instruction must commit through the app before it can act.
3. Network delivery is at least once. Commands and producer events carry stable identities, idempotency, correlation/causation, an authority-home epoch, and expected revision; duplicate delivery returns the existing receipt rather than repeating the effect.
4. The PC persists an inbox/dedup record before action and retains unacknowledged producer events in a spool. The app acknowledges only after its ledger commit.
5. Streaming bytes or semantic events shown as recoverable app history are committed in the app copy before display. Intentionally ephemeral terminal bytes must be labeled as such and governed by an explicit retention/redaction policy.
6. Adoption and detachment pause/fence the old writer, reconcile checkpoint/hash/high-water, increment the persisted authority epoch, and only then resume. Dual writers with later reconciliation are forbidden.
7. Mandate, revocation, binding, session epoch, and terminal custody are rechecked immediately before action; a queued command may be rejected after admission if authority changed.

This reconciles the app's existing durable stream/replay primitive with the required PC execution spool and explicitly assigns the transaction owner in each mode (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:280-376).

## 7. D8 memory: existing h2a↔Graphify design is the starting point

D8 is not a new snapshot/log/rebuild choice. The owner-resolved memory vector, fixed baselines, and Graphify-max directive are the mandatory starting point (/home/antoinefa/src/h2a/scratchpad/2026-08-15-DECISION-DOSSIER-agent-memory-core.md:691-700). The reviewed h2a study places configuration and verified scope on the h2a side, ranking and projections on Graphify, and final canonical revalidation on the memory store (/home/antoinefa/src/h2a/docs/specs/2026-08-15-SPEC_STUDY_memory-core-graphify-max.md:18-44,80-134,1152-1169). Its independent architecture review returned GO for that design boundary and recall model (/home/antoinefa/src/h2a/scratchpad/reviews/memory-core-graphify-max-architecture.md:148-160).

Target ownership:

| Concern | Owner | Explicit non-owner |
|---|---|---|
| Episode capture, lifecycle, admission, recall, ranking, graph/vector projections, final revalidation, memory receipts | designed graphify-memory provider | cluster-mesh and h2a |
| Coordination/activity evidence production | h2a/Track integration adapter | Graphify engine |
| Verified workspace/mandate/correlation and generic invocation receipt | cluster-mesh | Graphify record semantics |
| Exact scope authorization and redaction | injected Graphify AuthorizationPort | caller-supplied role or scope |
| Activity ingestion | Graphify ActivityEvidenceSource implemented by an external adapter | direct Graphify parsing of h2a/Track files |
| Provider configuration and budgets | h2a composition/MemoryFacade boundary | cluster-mesh memory policy |

Integration shape:

~~~text
h2a/Track authenticated activity facts
  -> external ActivityEvidenceSource adapter
  -> cluster-mesh wrapped memory capability
       verified workspace/mandate/correlation -> provider binding
  -> graphify-memory
       canonical store -> accepted-only ranking/projections -> final revalidation
  -> typed provider receipt -> cluster-mesh correlated invocation receipt
~~~

Implementation readiness remains gated. graphify-memory is a committed design, not a shipped package; activation waits for its serial realization and mandatory exit gates, including neutral package extraction, public ports, fenced local persistence, managed-store parity, ranking/revalidation, and removal of legacy coupling (/home/antoinefa/src/graphify/spec/SPEC_EVOL_AGENT_MEMORY_SUBSTRATE.md:4-5,11-32,1148-1181). cluster-mesh may define provider-neutral fixtures but must not freeze a substitute Graphify schema or memory store.

## 8. D10 secure agent action — open security profile

The owner question is: **who may order what action to which agent, for how long, and what proof must the receiver validate before acting?** D10 remains open because an independent library orientation does not decide issuer topology, wire profile, offline revocation, confidentiality classes, delegation limits, or audit exposure (.tmp/engage/cluster-mesh-shared-core-r7-sol.md:421-429,559-573).

The target invariants are nevertheless fixed:

1. **Identity.** OIDC/OAuth proves the initiating principal; an NHI/workload key identifies the agent. A SPIFFE-shaped identifier is not described as live SPIFFE attestation without a real trust domain and attestation plane.
2. **Authority-signed mandate.** A trusted authority issues a short-lived, audience/resource/capability-constrained credential bound to the sender key. Role is descriptive; a self-signed role string is not authority.
3. **Sender proof-of-possession.** The sender signs a versioned immutable envelope binding mandate digest, target/audience, workspace, capability/action, payload or ciphertext digest, issuance/expiry, replay identity, idempotency, correlation/causation, and requested receipts.
4. **Courier separation.** HTTP, WebSocket, relay, A2A, native message facility, or inbox/outbox carries the original envelope. Delivery cannot manufacture verification or action authority. tmux/native/PTY is an actuator after verification and custody.
5. **Durable replay/idempotency.** The authority home stores accepted sender/replay identities through the validity window, enforces session/custody epochs and expected revisions, and rechecks queued work before effect.
6. **Revocation.** Issuer trust, key status, membership, mandate activity, provider binding, and session/custody epoch are validated again immediately before action. Unknown required status fails closed for actionable work; offboarding fences leases and queued work.
7. **End-to-end confidentiality.** Sensitive payloads require a recipient-bound encryption profile. TLS or signature alone does not hide prompts, terminal input, connector arguments, or results from couriers.

Industry anchors and profile choices:

| Layer | Named anchor | Target use |
|---|---|---|
| OAuth posture and delegation | RFC 9700, RFC 8693, RFC 9396 | secure OAuth baseline; audience-bound exchange preserving actor context; typed capability/resource/action authorization details |
| Key binding and HTTP proof | RFC 7800, RFC 9449 | bind mandate to sender key; DPoP on HTTP/MCP surfaces |
| JSON profile candidate | RFC 7515 JWS + RFC 8785 JCS; RFC 7516 JWE | deterministic signed JSON envelope and recipient encryption candidate |
| Binary profile candidate | RFC 9052 COSE | compact CBOR alternative, not silently interchangeable with JOSE |
| Replay and revocation | jti/issuance/expiry semantics, durable nonce cache; RFC 7662 introspection and RFC 7009 revocation where online | fail-closed replay and action-time credential status |
| Recipient confidentiality | RFC 9180 HPKE as a building block, or a fully profiled JWE/COSE encryption mode | recipient-bound encryption after key discovery, rotation, recovery, and audit-redaction rules are decided |
| Workload identity | SPIFFE/SVID only with actual attestation | optional NHI deployment profile, not a label for an exported key bundle |

The standards mapping is grounded in .tmp/engage/cluster-mesh-shared-core-r7-sol.md:82-97,431-545 and .tmp/engage/cluster-mesh-shared-core-r7-fable.md:139-161.

No profile is ratified in r7. Candidate families remain JOSE/JCS, DSSE with a separately profiled mandate/confidentiality layer, and COSE/CBOR-first. Whichever family is later selected must publish positive and negative cross-implementation test vectors for canonicalization, signature coverage, key binding, audience/target, expiry, replay, revocation, epoch fencing, ciphertext integrity, and receipt correlation before remote actionable use.

## 9. D11/D12 shared enrollment, bindings, and secret custody

### MCP connector enrollment

MCP connector enrollment is authored by the Sentropic MCP library. One provider-owned connector instance is referenced by explicit global, tenant, owner, and workspace bindings with consent, grants, revocation, capability/maturity constraints, and an active revision. Both h2a and the app invoke it through the wrapped path. Tokens and refresh material remain with the connector credential custodian (.tmp/engage/cluster-mesh-shared-core-r7-fable.md:53-74).

### LLM account enrollment

LLM Mesh is the single semantic account authority for both surfaces. “Pushing an enrollment” from h2a to the app or from the app to h2a propagates a non-secret account descriptor and authorized binding; it never copies a raw credential (.tmp/engage/cluster-mesh-shared-core-r7-fable.md:165-180; .tmp/engage/cluster-mesh-shared-core-r7-sol.md:575-637).

~~~text
h2a enrollment surface -------------------+
                                           v
Sentropic app enrollment surface -> cluster-mesh EnrollmentBindingRegistry
                                      owner/global/workspace binding
                                      consent + revocation + active revision
                                           |
                                           v
                                   LLM Mesh account authority
                                   non-secret descriptor:
                                   account/provider/transport refs
                                   status/capability/health refs
                                   custodian route + custody epoch
                                           |
                          +----------------+----------------+
                          v                                 v
                local PC custodian                 managed custodian
                protected local keyring            server secret provider
                reachable/offline state            managed availability
                          |                                 |
                          +------ routed invocation --------+

Consumers: h2a AND Sentropic app; secret custody remains physical and singular.
~~~

Cross-surface use routes the invocation to the current custodian. A PC-custodied account is app-usable only while its custodian route is reachable or under an explicitly decided queue policy. Moving custody is a fenced transfer: stop old leases, reauthorize or exchange at the destination, activate a new custody epoch and route, revoke/delete the old credential, and emit an auditable receipt. Silent secret replication is not a fallback.

## 10. Capability access matrix

Legend: C = client of the shared contract; H/P = host/provider implementation; G = separately granted/consented/custody-gated; R = read-only projection; — = not exposed. No cell bypasses the cluster-mesh gateway.

| Capability | h2a CLI | h2a server | Sentropic app | native CLI | MCP client | agent |
|---|---:|---:|---:|---:|---:|---:|
| Capability catalog and invocation receipts | C | H/P | C | C | C | C/G |
| Track/Focus decision action | C | H/P | C/G | C/G | C/G | C/G; never owner-sign authority |
| Secure message and receipts | C/G | H/P | C/G | C/G | C/G with original envelope | C/G after mandate and action-time verification |
| LOCAL_ONLY session | C/G | H/P | R only when explicitly projected | C/G | — | C/G |
| APP_MANAGED session stream/control | C/G | H/P executor | H/P ledger | C/G | — unless dedicated capability | C/G with mandate/custody |
| MCP catalog/enrollment/consent/revocation | C/G | H/P | H/P | C/G | C/G only if projected | C/G only under delegated administration |
| MCP connector invocation/proxy | C/G | H/P | H/P | C/G | C/G | C/G |
| LLM enrollment/binding administration | C/G | H/P | H/P | C/G | — unless dedicated capability | R or explicitly delegated administration |
| LLM generation via custody route | C/G | H/P when local custodian | H/P when managed custodian | C/G | — unless approved tool | C/G |
| Graphify memory capability | C/G after readiness gate | H/P adapter | C/G | C/G | C/G if projected | C/G |

## 11. Persistence and serialization matrix

| State | Semantic/codec owner | Local mode | Managed mode | Recovery/authority rule |
|---|---|---|---|---|
| Track decisions/events | Track | append-only Track authority | approved Track provider | verified replay; one writer |
| Core invocation/outbox/audit refs | cluster-mesh | append log or SQLite | control/product SQL | transactional outbox; provider effect remains provider-owned |
| LOCAL_ONLY session | h2a session provider | PC journal + checkpoints | not applicable until adopted | PC is sole writer |
| APP_MANAGED session | app session provider | PC inbox/spool is derived executor durability | app Session Ledger + outbox/high-water | app is sole canonical writer; PC retries until committed acknowledgement |
| Signed messages/mandates/receipts | security-message provider and issuing authorities | immutable envelopes, durable replay/status refs, keyring outside data store | message/status/replay/receipt tables; external keys | verify original digest and current status immediately before action |
| MCP connector records/bindings | MCP Platform/connector provider; core owns active generic binding revision only | durable injected MCP stores plus secret refs | provider-owned SQL namespaces plus secret refs | consent/revocation/idempotency; no token copying |
| LLM account descriptor/binding | LLM Mesh; core owns generic binding revision only | non-secret descriptor + local keyring custodian | non-secret descriptor + managed secret custodian | one custodian per epoch; routed use; fenced transfer |
| Agent memory | designed graphify-memory | fenced canonical SQLite; derived projections | parity-gated canonical Postgres; derived projections | Graphify ports/codecs; activation gated; final canonical revalidation |
| Terminal/PTY | h2a terminal provider | endpoint/custody receipt only | locator/lease only | live OS identity and custody revalidated; buffers are not generic core state |

## 12. Progressive migration and rollback boundaries

| Stage | Authoritative path and acceptance | Rollback boundary |
|---|---|---|
| 0. Characterize | Capture current IDs, auth decisions, receipts, session/store schemas, bypasses, and secret locations; no runtime change. | None required; observation only. |
| 1. Generic gateway fixtures | Freeze neutral invocation/receipt/error fixtures and composition checks that reject a provider effect outside the gateway. | Remove fixtures/config; current paths unchanged. |
| 2. Read-only wrapped slices | Wrap one h2a and one MCP read capability; compare authorization/results while the existing provider remains the only domain writer. | Disable route binding. |
| 3. h2a server and local sessions | h2a server dispatches through core; LOCAL_ONLY sessions retain PC authority; migrated bypasses are removed. | Fence new route and restore the previous adapter version, never a parallel business implementation. |
| 4. MCP convergence | MCP-platform-authored ingress/provider binding uses durable ports; application connector routes cross the gateway; discovery/call/enrollment/consent/elicitation/resume pass conformance. | Disable active binding revision; provider enrollment remains authoritative. |
| 5. Security profile minimum | No remote actionable command activates until D10 resolves issuer, wire, replay, revocation, and confidentiality minimums with test vectors. | Disable automatic action; retain envelopes for inspection only. |
| 6. App-managed session ledger | Adoption/detachment epochs, app outbox/ledger, PC inbox/spool, producer cursors, action-time verification, and commit-before-display are proven before app→PC control. | Pause, drain/receipt, fence epoch, and return authority through an explicit transition. |
| 7. Shared enrollment and custody routing | Publish non-secret descriptors/bindings, map legacy records, select one custodian without moving secrets, route calls to custody, then retire duplicate semantic paths. | Revert binding/custody route by a fenced epoch; keep provider secret in its prior custodian. |
| 8. Graphify memory binding | Bind the existing h2a↔Graphify design only after Graphify realization and exit gates pass; pin contract digest and cross-repo fixtures. | Disable provider binding; never dual-write a cluster-mesh substitute. |
| 9. Hard enforcement and optional federation | Composition, secret-flow, session-authority, and provider conformance gates reject bypass/dual-writer/secret-copy paths; federation remains off until its security/data dossier passes. | Gate off remote provider; local providers continue. |

Every cutover follows inventory → backup/checkpoint → compatible reader/codec → comparison → old-writer fence → final delta → active revision/epoch switch → observation → removal of the superseded path. Rollback means another fenced revision/epoch transition, not concurrent writers.

## 13. Decision state carried by r7

| Decision | State in this synthesis |
|---|---|
| D1 | **DECIDED B** — policy/composition kernel. |
| D2 | **DECIDED C** — explicit binding of product and repository workspace authorities. |
| D3 | **DECIDED C** — logical contracts first; physical extraction when a second consumer or security ownership justifies it. |
| D4 | **DECIDED C** — hybrid provider-owned files plus durable SQL/SQLite namespaces and separate key/secret custody. |
| D5 | **DECIDED C** — linked principals, short-lived delegated grants, and distinct terminal custody. |
| D6 | **C direction, rework resolved** — every MCP operation is wrapped; MCP is authored by the Sentropic MCP library. Owner confirmation remains. |
| D7 | **C direction, rework resolved** — explicit LOCAL_ONLY versus APP_MANAGED transaction ownership, fenced transitions, app-first remote commands, and streaming copy. Owner confirmation remains. |
| D8 | **Existing design is the starting point; no A/B/C** — Graphify activation remains readiness-gated. |
| D9 | **C provisional** — DS component plus Focus skill, no off-DS rounded cards; deeper renderer choice deferred to a separate h2a/Focus dossier. |
| D10 | **OPEN** — layered invariants and industry anchors established; issuer/wire/revocation/confidentiality/test-vector profile not yet ratified. |
| D11 | **C direction, rework resolved** — MCP-platform-authored enrollment/binding and invocation schema embedded in the decision. Owner confirmation remains. |
| D12 | **C direction, rework resolved** — bidirectional non-secret descriptor propagation, single physical custodian, custody routing, and co-located graph. Owner confirmation remains. |

## 14. Focus/owner presentation contract

- Architecture rendering is a Sentropic design-system component consumed through a Focus skill or Focus integration port.
- Off-design-system rounded-border cards are forbidden for this dossier; the renderer study and any ArchitectureView model are deferred to a separate h2a/Focus decision dossier (.tmp/engage/cluster-mesh-shared-core-owner-feedback-r6.json:25-27).
- Current, transition, and target reuse the same three levels, semantic nodes, lane order, direction, and scale.
- Runtime wrap and package authorship are two separate visual dimensions.
- D6 and D11 include the MCP invocation/binding schema on the decision card itself.
- D12 includes the shared descriptor/custodian graph on the decision card itself.
- D10 is presented as an open security chapter with standards mapping, replay, revocation, confidentiality, receipts, and test-vector gates; no preselected answer is disguised as ratified.
- Delivery, verification, action, and read receipts remain visually distinct; a UI selection or courier acknowledgement never implies agent action.

## 15. Convergence invariants

The architecture fails review if any of the following becomes false:

1. Every capability effect crosses cluster-mesh admission, authorization, correlation, idempotency/replay, audit, and receipt handling.
2. Universal runtime wrapping never becomes provider-domain authorship by the core.
3. MCP is authored by @sentropic/mcp-platform with @sentropic/mcp-auth; hosts mount it and cannot define a private MCP contract.
4. One semantic owner, one active writer, one authority home/epoch, and one explicit secret custodian exist for every durable namespace.
5. LOCAL_ONLY sessions are PC-authoritative; APP_MANAGED sessions are app-ledger-authoritative even with a PC executor; authority moves only through a fenced transition.
6. App-managed streaming shown as recoverable history is committed in the app ledger before display.
7. D8 reuses the owner-resolved h2a↔Graphify design and remains blocked on Graphify readiness; cluster-mesh never becomes a memory engine.
8. An actionable agent message requires authority-signed mandate proof plus sender proof-of-possession, durable replay protection, action-time revocation/status checks, and any required custody lease.
9. Couriers preserve the original signed envelope and cannot promote delivery to verification or action.
10. D10 remains open until one versioned industry-anchored profile, its confidentiality classes, revocation/offline rules, and interoperable test vectors are ratified.
11. Shared enrollment propagates non-secret descriptors and bindings in both directions; raw secrets do not propagate, and one custodian serves each active custody epoch.
12. Current-state views show current bypasses and implementation gaps rather than projecting the target backward.
13. Migration never relies on permanent dual implementations, concurrent writers, secret duplication, or bypass restoration as rollback.
14. Owner-facing diagrams use the design system, keep graphs on the relevant decision cards, and do not introduce forbidden rounded-card styling.
