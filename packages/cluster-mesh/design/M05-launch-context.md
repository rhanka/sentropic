# M05 launch-context relaunch

Status: **LOCKED** — the owner confirmed the recommended defaults D-A..D-E on 2026-09-13; gemini-3.8 design review returned APPROVE-WITH-NITS (0 must-fix, nits folded) and h-runtime consumer-confirms C1-C5 are all green. This is a 0.10.0 addition to the published 0.9.0 package; the design changes no shipped 0.9.0 contract, and the initial implementation adds no schema or migration.

## Commission boundary

M05 adds one request attribute to session relaunch: `launchContext.gateway` selects the llm-mesh gateway namespace for the recreated actuator process. The two canonical namespaces are:

- `gateway: true` → `gw`;
- `gateway: false` → `no-gw`.

The field is untrusted request input until the existing registration/custody policy decision point authorizes it. Ordinary relaunch authority permits `gateway: false`; `gateway: true` additionally requires the authenticated principal's verified `session:relaunch:gateway` scope under the invocation context's accepted policy revision. The gateway predicate is conjunctive with, and never a substitute for, the existing registration, principal, workspace, generation, and custody checks.

M05 does not define a second policy decision point, mint custody, change signed-instruction resolution, select an actuator, implement PTY operations, or prescribe how h-runtime builds a provider command. It adds an authorization-bound input to the existing 0.9.0 path and gives the selected actuator a process-recreation obligation. `ActuationResult` remains the complete return contract and is neither copied nor widened.

The existing seam remains authoritative: `VerifiedInvocationContext` → `RegistrationGate.authorize` → `CommandInstructionPort.resolve` → `PtyActuatorPort`/`SecondaryActuatorPort.actuate` → `ActuationResult`. M05 adds request attributes to the existing PDP call and actuator input; it does not replace any stage.

The first design is synchronous and carries launch context only through one awaited relaunch call. It does not persist launch context, queue a relaunch, or recover an interrupted call from a stored command. The existing command identity and actuator-side reconciliation supply duplicate-attempt safety without a schema change.

## AS-IS in 0.9.0

Version 0.9.0 exposes `POST /auth/session/control/:action` for `drive`, `wake`, and `relaunch`. The request body carries `commandRef`, `targetRegistrationId`, and `idempotencyKey`; it has no launch-context field or gateway namespace. The relaunch path is:

1. The session-control route parses the body and calls `VerifiedInvocationContextPort.verify(...)` with `invocationId === commandRef`.
2. It rejects a target that differs from the verified registration, records transported evidence, and calls `enqueueCommand`. A repeated `commandRef` is rejected as `duplicate_command` before authorization or actuation.
3. `RegistrationGate.authorize(context, action)` reloads the registration and fails closed on missing, stale, revoked, or cross-generation state; principal, workspace, or custody mismatch; and actuator unavailability. For relaunch, actuator selection probes liveness and may select a PTY or secondary actuator for an `alive`, `dead`, or `parked` target; `unknown` cannot be selected.
4. `CommandInstructionPort.resolve({ commandRef, registrationId, action })` resolves the existing `SignedInstruction`. The opaque `commandRef` is not executable content.
5. Capacity is reserved and the selected `PtyActuatorPort` or `SecondaryActuatorPort` receives the 0.9.0 `ActuationRequest`.
6. The actuator returns the 0.9.0 `ActuationResult` with `outcome: 'acted' | 'deferred' | 'failed'`. The route applies its existing persistence, receipt, and HTTP projection behavior.

The current registration binds one `registrationId`, `generationId`, `actuatorRef`, custody holder, and custody epoch. It does not record an actuator process incarnation or gateway namespace. The generation identifies the active cluster-mesh runtime generation, not an individual child-process launch. The custody epoch fences custody authority, not ordinary process replacement.

## Contract shapes

The following shapes are package-local 0.10.0 additions or additive amendments. They do not change `@sentropic/contracts`. `VerifiedInvocationContext`, `VerifiedInvocationContextRequest`, and `VerifiedInvocationContextPort` remain exactly as shipped.

```ts
import type { VerifiedInvocationContext } from '@sentropic/contracts';
import type {
  ClusterMeshRegistration,
  SignedInstruction,
} from './runtime/registration.js';

export const GATEWAY_RELAUNCH_SCOPE = 'session:relaunch:gateway' as const;

/** Complete M05 wire shape. No auto or inherited namespace is representable. */
export interface RelaunchLaunchContext {
  readonly gateway: boolean;
}

export type GatewayNamespace = 'gw' | 'no-gw';

export interface SessionControlIntent {
  readonly commandRef: string;
  readonly targetRegistrationId: string;
  readonly idempotencyKey: string;
  /** Accepted only by the relaunch route. Omission resolves to { gateway: false }. */
  readonly launchContext?: RelaunchLaunchContext;
}

export interface RelaunchAuthorizationAttributes {
  /** Canonical value resolved before the PDP call; always present for relaunch. */
  readonly launchContext: RelaunchLaunchContext;
}

export type RegistrationFailureReason =
  | 'missing_registration'
  | 'stale_registration'
  | 'revoked_registration'
  | 'generation_mismatch'
  | 'principal_mismatch'
  | 'workspace_mismatch'
  | 'custody_required'
  | 'custody_mismatch'
  | 'invalid_launch_context'
  | 'gateway_forbidden'
  | 'actuator_unavailable'
  | 'command_unresolved';

export type RegistrationDecision =
  | {
      readonly ok: true;
      readonly registration: ClusterMeshRegistration;
      readonly actuator: SessionActuatorPort;
      /** Present on every successful relaunch decision; absent for drive and wake. */
      readonly launchContext?: RelaunchLaunchContext;
    }
  | { readonly ok: false; readonly reason: RegistrationFailureReason };

export interface RegistrationGate {
  authorize(
    context: VerifiedInvocationContext,
    action: 'drive' | 'wake' | 'relaunch',
    /** Additive optional argument keeps existing drive/wake and legacy relaunch calls valid. */
    attributes?: RelaunchAuthorizationAttributes,
  ): Promise<RegistrationDecision>;
}

export interface ActuationRequest {
  readonly registration: ClusterMeshRegistration;
  readonly action: 'drive' | 'wake' | 'relaunch';
  /** Opaque, non-executable identifier and M05 process-recreation attempt key. */
  readonly commandRef: string;
  readonly resolvedInstruction: SignedInstruction;
  /** Required semantically for relaunch; absent for drive and wake. */
  readonly launchContext?: RelaunchLaunchContext;
}

/** Unchanged from 0.9.0. */
export interface ActuationResult {
  readonly effectRef: string;
  readonly outcome: 'acted' | 'deferred' | 'failed';
  readonly actedTargets?: readonly string[];
}

export interface PtyActuatorPort {
  readonly kind: 'pty';
  isAvailable(actuatorRef: string): Promise<boolean>;
  probeState(actuatorRef: string): Promise<'alive' | 'dead' | 'parked' | 'unknown'>;
  actuate(input: ActuationRequest): Promise<ActuationResult>;
}

export interface SecondaryActuatorPort {
  readonly kind: 'secondary';
  isAvailable(actuatorRef: string): Promise<boolean>;
  probeState(actuatorRef: string): Promise<'alive' | 'dead' | 'parked' | 'unknown'>;
  actuate(input: ActuationRequest): Promise<ActuationResult>;
}

export type SessionActuatorPort = PtyActuatorPort | SecondaryActuatorPort;
```

At the type level, consumers discriminate `RegistrationDecision` and the actuation request by `action` — a `relaunch` decision carries `launchContext`, while `drive`/`wake` never do — rather than treating `launchContext` as an independently-optional field. The optional properties preserve source compatibility with 0.9.0 consumers, but the runtime invariant is strict: every relaunch reaches the gate and actuator with an own `launchContext` value whose `gateway` member is boolean. A relaunch omission is normalized once to `{ gateway: false }`; it is never interpreted as `auto`, “current,” or “inherit.” `drive` and `wake` reject a supplied `launchContext` as `invalid_control_intent` and do not pass one to the gate or actuator.

`RegistrationDecision.launchContext` is the authorized value. After the gate succeeds, the route must build `ActuationRequest.launchContext` from that decision, never by rereading the raw request body. This prevents a checked value and an acted value from diverging. `launchContext` is not added to `VerifiedInvocationContext`, `SignedInstruction`, `ClusterMeshRegistration`, `StoredClusterMeshCommand`, invocation receipts, or any `@sentropic/contracts` type.

## Authorization binding

M05 extends the existing `RegistrationGate`; it does not create a gateway PDP or call a product authorization port. The route normalizes the requested launch context and passes it as the additive third argument to the same awaited `authorize(context, action, attributes)` call. Within that existing decision:

1. The gate performs the shipped registration, status, expiry, generation, principal, workspace, registration-reference, and custody checks.
2. For `action === 'relaunch'`, it resolves a missing third argument to `{ gateway: false }`. A malformed argument, or any launch-context argument on `drive` or `wake`, returns `invalid_launch_context`; values are never coerced by JavaScript truthiness.
3. If `gateway === true`, the gate requires `context.scopes` to contain the exact scope string `session:relaunch:gateway`. The scopes and `policyRevision` come only from `VerifiedInvocationContextPort`; request JSON, headers, instruction payloads, registrations, and actuator metadata cannot assert the capability.
4. Missing gateway authority returns `gateway_forbidden` before actuator probing, instruction resolution, capacity reservation, or process I/O. Invocation verification failure retains `unverified_invocation_context`; an exception from the registration gate retains the route's existing `authorization_failed` behavior. Every path is fail-closed.
5. If the complete decision succeeds, it returns the normalized `launchContext` beside the selected registration and actuator. The decision is consumed immediately in the same awaited path and is not cacheable authority.

`gateway: false` needs no new gateway-specific scope because ordinary relaunch authority already permits destructive process recreation, and disabling the gateway is the least-privilege namespace. It still requires every existing custody and registration check. A principal may set `gateway: true` only when both independent facts hold at decision time: it controls the target under the session-custody gate, and its verified current policy grants `session:relaunch:gateway`.

OQ5 custody evidence remains target-, holder-, action-, epoch-, and invocation-bound. A valid relaunch custody token authorizes no gateway capability by itself. Conversely, the gateway scope supplies no target custody. The existing `authorize(context, action)` decision point combines these predicates conjunctively; it is not split into reusable custody and gateway permits. OQ5 token consumption and the M05 predicate therefore remain in the same inline authorization boundary before actuator selection and I/O.

## Relaunch attachment and result flow

The normative 0.10.0 relaunch sequence is the existing 0.9.0 sequence with two additive values, shown here in full:

1. Parse `SessionControlIntent` under a strict schema: reject a non-object `launchContext`, a non-boolean `gateway`, any unexpected/unknown key inside `launchContext`, or any launch context on `drive`/`wake`. For relaunch, normalize omission to `{ gateway: false }`.
2. Call the unchanged `VerifiedInvocationContextPort.verify(...)`. Do not place launch context into the context request or manufacture verified evidence from it.
3. Preserve the existing verified-registration equality check, transported receipt, and one-time `enqueueCommand(commandRef, ...)` behavior. The stored command remains unchanged and contains no launch context.
4. Call the existing gate as `authorize(context, 'relaunch', { launchContext })`. The gate applies custody and the gateway predicate and returns the authorized canonical value.
5. Call the unchanged `CommandInstructionPort.resolve({ commandRef, registrationId, action: 'relaunch' })`. Launch context is neither instruction content nor an input to instruction lookup.
6. Preserve the existing capacity reservation and selected actuator. Call `decision.actuator.actuate(...)` once with the existing fields plus `launchContext: decision.launchContext`.
7. Await the process-recreation result. The actuator returns the exact existing `ActuationResult` object. M05 adds no wrapper, confirmation field, namespace field, process identifier, or new outcome. The route retains the 0.9.0 result persistence, receipt, error, and HTTP projection behavior.

No unrelated asynchronous work, durable queue, or hand-off may intervene between the gate decision and the actuator call. A future deferred execution path would need the separately owner-gated custody execution lease described by OQ5; M05 does not activate it.

## Actuator process-recreation contract

The selected actuator owns process recreation because it already owns the target-specific PTY or secondary mechanism. M05 does not add another actuator port. For a relaunch request, the following identities are normative:

```ts
/** Consumer-side implementation model; not a new cluster-mesh export. */
interface ProcessRecreationRequest {
  /** Stable logical target from the authorized registration. */
  readonly actuatorRef: string;
  /** Exactly ActuationRequest.commandRef; identifies one logical replacement attempt. */
  readonly attemptRef: string;
  readonly namespace: 'gw' | 'no-gw';
}

/** Internal confirmation evidence; never widens ActuationResult. */
interface ProcessRecreationConfirmation {
  readonly actuatorRef: string;
  readonly attemptRef: string;
  readonly namespace: 'gw' | 'no-gw';
  readonly processIdentity: string;
  readonly liveness: 'alive';
}
```

The adapter derives `namespace` mechanically from the authorized boolean and obtains all other launch material—profile, executable, arguments, resume data, working directory, environment allowlist, and terminal target—from its existing h-runtime target resolution. M05 launch context must not replace or trust those existing host-owned values.

For each `(actuatorRef, commandRef)`, the actuator performs one reconcile-and-replace operation:

1. Acquire or enter h-runtime's single-writer fence for `actuatorRef`. Concurrent replacement operations for one target must not pass the spawn boundary together.
2. Reconcile `commandRef` before mutation. If the same attempt already has a confirmed live process in the requested namespace, return the previously established `ActuationResult` with the same `effectRef`; do not spawn again. If the attempt has an unresolved prior effect, inspect it or return without spawning rather than guess.
3. Identify the currently authoritative process incarnation. Request its stop and confirm it is no longer live before creating a replacement. Failure to establish old-process death forbids a new spawn.
4. Request exactly one replacement process in `gw` or `no-gw`. The host invocation must select that exact mode (`--gw` or `--no-gw` where those are the h-runtime controls); `gateway: false` must not degrade to an automatic mode.
5. Confirm that the new process is live, is bound to the same logical `actuatorRef`, carries the same attempt identity, and is running in the requested namespace. A spawn acknowledgement alone is not confirmation.
6. Only then return `outcome: 'acted'`. The existing `effectRef` must identify the reconciliable replacement effect and remain stable for an idempotent observation of the same attempt. `actedTargets`, when present, retains its 0.9.0 meaning and never carries an OS PID, host process identifier, or process-incarnation token.

An actuator may return `deferred` only if its already-approved deferred contract has accepted single ownership of the same attempt and its `effectRef` is authoritative for reconciliation. M05 does not qualify a new deferred worker. It returns `failed` only for a completed, known failure. A disconnect, crash, or timeout after a possible stop or spawn is an uncertain external-effect boundary: the adapter must preserve enough host-side attempt/process evidence to reconcile it and must never convert a retry into a blind second spawn. M05 introduces no `uncertain` outcome because widening `ActuationResult` is forbidden; callers follow the existing external-effect reconciliation rule before intentionally issuing a new `commandRef`.

Idempotency has two layers. The 0.9.0 command store prevents the normal route from invoking the same `commandRef` twice, while the actuator fence and host-side attempt marker protect against transport ambiguity, adapter restart, and direct duplicate delivery at the effect boundary. A new `commandRef` is a new authorized replacement attempt even when its launch context is identical. At most one authoritative live process may exist for an `actuatorRef` after reconciliation.

## Namespace transition, generation, and custody epoch

A relaunch always recreates the process, whether the requested namespace matches or differs from the observed namespace. `gw → gw` and `no-gw → no-gw` are same-mode replacements. `gw → no-gw` and `no-gw → gw` are namespace transitions. All four use the same stop-confirm-create-confirm protocol and retain the same logical `registrationId` and `actuatorRef`.

Under the recommended model, a namespace transition does not change the cluster-mesh `generationId`: the active control-plane generation has not changed. It also does not increment `custodyEpoch`: neither the custody holder nor its authority has changed. The current registration remains active once h-runtime confirms the replacement under the same stable target reference. Every relaunch still requires a fresh verified invocation and, when OQ5 is active, a fresh action-bound single-use custody token. Every `gateway: true` attempt reevaluates the gateway scope; neither a prior gateway process nor a prior successful decision grants future authority.

The actuator may maintain an internal process incarnation or replacement fence. That implementation value is not the cluster-mesh generation, is not the custody epoch, and is not added to `ActuationResult`. If h-runtime cannot preserve `actuatorRef` across a namespace replacement, cannot reconcile the process by `(actuatorRef, commandRef)`, or treats a namespace switch as a new custody subject, the in-place model is not implementable as written. Implementation must stop and return that fact to the owner before changing registration identity, custody epoch, schema, or migration.

## Failure and security semantics

| Boundary | Fail-closed behavior |
|---|---|
| Malformed or misplaced launch context | Reject as `invalid_control_intent`; do not verify, enqueue, authorize, resolve, reserve, or actuate. |
| Malformed or misplaced attributes supplied directly to the registration gate | Return `invalid_launch_context`; do not probe or select an actuator. |
| Invocation context verification unavailable or invalid | Preserve `unverified_invocation_context`; request fields cannot synthesize principal, policy, scope, registration, or custody. |
| Registration/custody decision fails | Preserve the existing refusal and make no gateway-policy or process call. |
| `gateway: true` lacks verified gateway scope | Return `gateway_forbidden` before actuator probing, resolution, reservation, or I/O. Never downgrade silently to `no-gw`. |
| Registration gate throws while applying its decision | Preserve fail-closed `authorization_failed`; do not call the actuator. |
| Duplicate `commandRef` at the route | Preserve `duplicate_command`; never treat another launch context as a new attempt under the old identity. |
| Instruction resolution or capacity reservation fails | Preserve the existing refusal; no process recreation begins. |
| Old process cannot be proven stopped | Do not spawn a replacement; return a known failure or surface an uncertain effect for reconciliation. |
| Spawn accepted but namespace/liveness confirmation fails | Do not report `acted` and do not blindly spawn on retry; reconcile the attempt marker and process identity. |
| Same attempt is observed again | Return the stable reconciled result or remain non-acting while uncertain; never create a second process. |
| Actuator returns | Preserve the exact 0.9.0 `ActuationResult`; do not add namespace, process, or confirmation fields. |

Launch context is safe to log only as the boolean or canonical namespace alongside non-secret command and registration identifiers. Logs must not include custody tokens, signed instructions, authentication evidence, provider credentials, or the actuator's host-owned environment. A gateway process is not proof that the caller was authorized to request it; only the inline gate decision is authority.

## Decisions

### D-A — Launch-context shape and attachment point

**AS-IS:** 0.9.0 accepts no launch context. The verified context, signed instruction, stored command, registration, and actuator request contain no gateway namespace.

**Options:**

- `{ key: 'relaunch-body-gate-actuator', title: 'Boolean on relaunch body, authorized decision, and actuator request', consequence: 'Adds one minimal wire field, keeps it out of identity and instruction contracts, and ensures the actuator receives the exact value authorized by the existing gate.' }`
- `{ key: 'signed-instruction-field', title: 'Put gateway mode in SignedInstruction', consequence: 'Makes a process namespace part of executable instruction resolution, can retain stale environment authority, and still requires a separate PDP check.' }`
- `{ key: 'verified-context-field', title: 'Put gateway mode in VerifiedInvocationContext', consequence: 'Conflates caller identity evidence with requested effect attributes and requires a forbidden change to @sentropic/contracts.' }`

**RECOMMENDED default:** `relaunch-body-gate-actuator`. Use exact shape `{ gateway: boolean }`; normalize relaunch omission to `{ gateway: false }`, carry it through the additive gate argument and successful decision, and attach only that authorized value to `ActuationRequest`. Do not persist it or pass it to drive/wake.

### D-B — Gateway authorization model and fail-closed refusal

**AS-IS:** 0.9.0 `RegistrationGate.authorize(context, action)` enforces registration and session custody but has no gateway capability predicate. `VerifiedInvocationContext` already carries verifier-authored scopes and a policy revision.

**Options:**

- `{ key: 'same-gate-conjunctive-scope', title: 'Add a gateway predicate to the existing custody gate', consequence: 'gateway:true succeeds only when ordinary relaunch custody passes and verified current scopes contain session:relaunch:gateway; one inline decision remains authoritative.' }`
- `{ key: 'distinct-product-authz', title: 'Call a separate gateway authorization port', consequence: 'Separates policy ownership but creates ordering, evidence-binding, availability, and decision-lifetime questions for a single session-control effect.' }`
- `{ key: 'request-self-assertion', title: 'Trust gateway from the request body', consequence: 'Lets any relaunch caller promote its process into the gateway namespace and violates the commission security boundary.' }`

**RECOMMENDED default:** `same-gate-conjunctive-scope`. A verified principal with ordinary relaunch custody may request `gateway: false`; only one also holding `session:relaunch:gateway` may request `gateway: true`. Missing authority returns `gateway_forbidden`; invocation verification failure remains `unverified_invocation_context`, and a registration-gate exception remains `authorization_failed`. None reaches actuator probing or I/O, and no downgrade is attempted.

### D-C — Actuator process-recreation contract

**AS-IS:** 0.9.0 selects an existing actuator and awaits one `actuate(ActuationRequest)` call, but it does not carry a gateway namespace or define stop/spawn confirmation and effect-level duplicate prevention.

**Options:**

- `{ key: 'fenced-reconcile-replace-confirm', title: 'Single-writer reconcile, stop-confirm, create-confirm', consequence: 'Uses commandRef as the attempt identity, prevents parallel old/new processes, requires observed liveness and namespace before acted, and replays one stable result instead of spawning twice.' }`
- `{ key: 'fire-and-forget-spawn', title: 'Return after issuing a spawn', consequence: 'Cannot prove the requested namespace or liveness and can duplicate a process after timeout or redelivery.' }`
- `{ key: 'parallel-blue-green-processes', title: 'Start replacement before stopping the old process', consequence: 'Reduces downtime but intentionally permits simultaneous authoritative processes and requires a separate traffic/custody cutover protocol.' }`

**RECOMMENDED default:** `fenced-reconcile-replace-confirm`. The selected actuator owns the protocol within the existing `actuate` call and returns the unchanged `ActuationResult`. Same-attempt observation returns the stable prior result; uncertain attempts are reconciled before any new spawn.

### D-D — Default gateway and namespace-transition semantics

**AS-IS:** 0.9.0 relaunch has no gateway value, no current namespace in the registration, and no namespace-transition behavior.

**Options:**

- `{ key: 'default-off-in-place', title: 'Default no-gw and replace the process under the same logical registration', consequence: 'Preserves 0.9.0 callers without granting gateway access, makes omission deterministic, and lets gw↔no-gw use the existing stable actuator target.' }`
- `{ key: 'inherit-observed', title: 'Inherit the current process namespace when omitted', consequence: 'Avoids an implicit switch but requires a trustworthy namespace observation that 0.9.0 registration and liveness contracts do not expose.' }`
- `{ key: 'new-registration-per-namespace', title: 'Create a new registration for every namespace switch', consequence: 'Makes process identity explicit but adds issuance, cutover, rollback, and persistence behavior outside the relaunch seam.' }`

**RECOMMENDED default:** `default-off-in-place`. Omission means exact `gateway: false`, not `auto`. Every relaunch recreates one process; a mode change stops and fences the old namespace before starting the requested one while retaining `registrationId` and `actuatorRef`.

### D-E — Generation and custody-epoch interaction

**AS-IS:** 0.9.0 generation selects an active cluster-mesh runtime and fences cross-generation registration use. `custodyEpoch` fences custody-holder authority. Neither value is defined as a process-incarnation or launch-namespace counter.

**Options:**

- `{ key: 'preserve-control-and-custody-epochs', title: 'Keep generation and custody epoch across an authorized namespace replacement', consequence: 'Matches their existing meanings, needs no fresh registration or schema, and relies on fresh invocation/custody evidence plus actuator-side process fencing.' }`
- `{ key: 'increment-custody-epoch', title: 'Rotate custody epoch on every namespace change', consequence: 'Fences all prior custody evidence but requires an authoritative atomic registration update and token reissuance even though the holder did not change.' }`
- `{ key: 'new-generation-or-registration', title: 'Treat namespace change as a control-plane generation or registration cutover', consequence: 'Provides a new identity boundary but conflates process launch with runtime rollout and requires a broader cutover/recovery contract.' }`

**RECOMMENDED default:** `preserve-control-and-custody-epochs`. Namespace change alone changes neither the runtime generation nor custody ownership. Keep the registration and require a fresh invocation, a fresh OQ5 token when active, a new `commandRef`, current gateway-scope evaluation, and actuator-internal process-incarnation reconciliation.

## Consumer-confirm before lock

- **consumer-confirm M05-C1 — h-runtime gateway mapping:** confirm that the h-runtime actuator builder can map `gateway: true` to exact `gw`/`--gw` behavior and `gateway: false` to exact `no-gw`/`--no-gw` behavior, with no `auto` fallback and without replacing its existing host-owned launch material.
- **consumer-confirm M05-C2 — replace and confirm:** confirm that every supported PTY and secondary relauncher can serialize by stable `actuatorRef`, stop and confirm the prior process, start exactly one replacement, and confirm both liveness and effective namespace before returning `acted`.
- **consumer-confirm M05-C3 — attempt reconciliation:** confirm that h-runtime can durably enough for its effect boundary associate `commandRef` with the spawned process/incarnation, detect the same attempt after a timeout or adapter restart, keep one authoritative live process, and return a stable `effectRef` rather than spawning again. If it cannot, process recreation must stop before implementation.
- **consumer-confirm M05-C4 — result fidelity:** confirm that the actuator builder can return the published 0.9.0 `ActuationResult` object unchanged, including `outcome`, and keep process identity, namespace confirmation, and reconciliation diagnostics internal or out-of-band.
- **consumer-confirm M05-C5 — stable registration target:** confirm that a `gw ↔ no-gw` recreation preserves the logical `actuatorRef` and custody subject. If h-runtime requires a new target, registration, or custody subject, the owner must resolve the deferred identity model before implementation.

## Deferred owner-gated

- **Durable launch-context or relaunch recovery:** the recommended inline path requires no storage. If implementation requires launch context, process incarnation, namespace, or confirmation state in the cluster-mesh store—for queued execution, restart recovery, or distributed reconciliation—it must **STOP and report** the required residence, consistency, retention, and recovery semantics. Migration `0007` is **FROZEN** and MUST NOT be created or changed; any future schema needs a separate owner-approved migration.
- **Registration or custody rotation on namespace change:** if consumer confirmation shows that a namespace replacement changes the logical target or custody subject, the owner must choose fresh registration issuance, epoch rotation, cutover ordering, rollback, and stale-token behavior. Implementations must not infer those changes from the boolean.
- **Distributed actuator fencing:** cross-process or cross-host replacement needs a single-writer lease/fence, takeover generation, and recovery authority in h-runtime. The bounded inline M05 contract does not select a distributed coordinator or grant a cluster-mesh process lock.
- **Deferred process recreation:** durable queues, background spawners, or relaunch ownership transfer require the separately gated execution-lease model and a qualified meaning for `deferred`. They are not alternate implementations under this lock candidate.
- **Additional launch parameters:** provider profile, model, effort, command, environment, working directory, credentials, and arbitrary gateway configuration remain host-owned. Adding them to the request requires separate threat modeling, authorization, validation, and owner approval.

No schema or migration is required by the recommended defaults. The lock blockers are owner confirmation or override of D-A through D-E and consumer confirmations M05-C1 through M05-C5.
