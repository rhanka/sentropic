# OQ5 bounded-local custody source

Status: **LOCKED**. The owner confirmed the four recommended defaults on 2026-09-13. This is a design-only fold; no 0.9.0 contract, shipped registration code, schema, or migration is changed here.

## Contract boundary

OQ5 adds a custody issuer beside the 0.9.0 registration gate. A caller may request a token, but only the source resolves the current custody binding and emits signed evidence. Receipt evidence, adapters, executors, and context builders MUST NOT derive or fabricate custody.

```ts
import type { VerifiedCustodyRef, VerifiedInvocationContext,
  VerifiedInvocationContextRequest } from '@sentropic/contracts';
export type CustodyAction = 'drive' | 'wake' | 'relaunch';
export interface CustodyIssueRequest {
  readonly registrationId: string;
  readonly action: CustodyAction;
  readonly holderPrincipalId: string;
  readonly invocationId: string;
  readonly requestedTtlSeconds?: number;
}
export interface CustodyTokenIssuer {
  readonly issuerId: string; readonly keyId: string;
  readonly algorithm: 'EdDSA'; readonly curve: 'Ed25519';
}
export interface SignedCustodyToken {
  readonly kind: 'signed-custody-token';
  readonly version: 'sentropic.cluster-mesh.custody/v1';
  readonly tokenId: string;
  readonly issuer: CustodyTokenIssuer;
  readonly audience: string;
  readonly registrationId: string;
  readonly action: CustodyAction;
  readonly holderPrincipalId: string;
  readonly epoch: number;
  readonly custodyId: string;
  readonly invocationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly evidence: {
    readonly kind: 'detached-signature';
    readonly canonicalization: 'sentropic-json-v1';
    readonly signatureBase64Url: string;
  };
}
export type CustodyRevocationSelector =
  | { readonly kind: 'token'; readonly tokenId: string }
  | { readonly kind: 'binding'; readonly registrationId: string; readonly custodyId: string;
      readonly holderPrincipalId: string; readonly epoch: number }
  | { readonly kind: 'holder'; readonly holderPrincipalId: string };
export interface CustodyRevocationReceipt {
  readonly issuerId: string; readonly selector: CustodyRevocationSelector;
  readonly reason: string; readonly revokedAt: string;
}
export interface CustodySource {
  readonly issuerId: string;
  issue(input: CustodyIssueRequest): Promise<SignedCustodyToken | null>;
  revoke(input: { readonly selector: CustodyRevocationSelector; readonly reason: string }):
    Promise<CustodyRevocationReceipt>;
}
export interface CustodyTokenExpectation {
  readonly audience: string; readonly registrationId: string;
  readonly action: CustodyAction; readonly holderPrincipalId: string;
  readonly epoch: number; readonly custodyId: string; readonly invocationId: string;
}

export type CustodyTokenDecision =
  | { readonly ok: true; readonly token: SignedCustodyToken }
  | { readonly ok: false; readonly reason:
      'untrusted' | 'unbound' | 'stale' | 'revoked' | 'replayed' | 'unavailable' };

export interface CustodyTokenVerifierPort {
  verify(token: SignedCustodyToken, expected: CustodyTokenExpectation): Promise<CustodyTokenDecision>;
  consume(token: SignedCustodyToken, expected: CustodyTokenExpectation): Promise<CustodyTokenDecision>;
}

export interface SourceVerifiedCustodyRef extends VerifiedCustodyRef {
  readonly sourceToken: SignedCustodyToken; }

export type CustodyVerifiedInvocationContext = VerifiedInvocationContext & {
  readonly custody: SourceVerifiedCustodyRef; };

export interface CustodyInvocationContextRequest extends VerifiedInvocationContextRequest {
  readonly custodyToken?: string; readonly custodyAction?: CustodyAction; }
```

The signature covers every field except `evidence.signatureBase64Url`, including the version, issuer tuple, audience, complete required binding, invocation ID, and validity interval. `issue` returns `null` for an unknown, inactive, stale, holder-mismatched, or holder-revoked target. The source caps the requested TTL and never issues past either the registration expiry or custody-binding expiry. The source resolves `audience` from the mesh domain of the target registration; callers cannot choose or override it.

`custodyToken` is an inline bearer token, not a reference or URI. Its wire value is unpadded RFC 4648 base64url of the UTF-8 bytes of the complete `SignedCustodyToken` encoded as `sentropic-json-v1` canonical JSON. The decoder rejects malformed base64url, invalid UTF-8 or JSON, duplicate keys, and non-canonical token shapes before signature verification. The token travels as a distinct optional field on the `/auth/session/control/:action` request body; it never overloads receipt evidence. Optionality is only structural for actions that do not enter this gate: custody-controlled actions require it semantically.

The context verifier parses `custodyToken`, calls `verify`, and maps only verified claims to `context.custody`: the three existing fields remain unchanged and `sourceToken` retains provenance. This cluster-mesh-owned structural subtype is accepted by the existing `authorize(context, action)` signature. During transition, the OQ5 gate MUST first apply `!context.custody || !('sourceToken' in context.custody)` and return `custody_required`; legacy custody synthesized from receipt claims cannot pass this provenance guard. The gate then loads the current registration and calls `consume` before actuator selection, with expectations built from the current registration, `action`, `context.invocationId`, and `context.custody.custodyId`. Every failed token decision, verifier exception, and unavailable consume or revocation store maps to the existing fail-closed `custody_mismatch`; there is no degraded fail-open mode.

`verify` is non-consuming validation for context construction. `consume` repeats signature, trust, binding, freshness, and revocation checks and atomically marks both `tokenId` and `(registrationId, invocationId)` used. Tracking the invocation tuple at consume time is the normative deduplication model: `issue` may race or re-emit more than one valid token for the same tuple, but exactly one tuple consumption can succeed, so all sibling tokens become `replayed` before a second actuation. A successful consumption is not a cacheable capability.

## Bounded-local implementation shape

```ts
interface CustodyBinding {
  readonly registrationId: string; readonly custodyId: string;
  readonly holderPrincipalId: string; readonly epoch: number;
  readonly meshDomain: string;
  readonly status: 'active' | 'revoked'; readonly expiresAt: string;
}

interface CustodyTrustRoot {
  resolve(issuer: CustodyTokenIssuer):
    Promise<{ readonly publicKeyBase64Url: string } | null>;
}

interface CustodySigningPort { signCanonical(payload: Uint8Array): Promise<string>; }

export class BoundedLocalCustodySource implements CustodySource, CustodyTokenVerifierPort {
  readonly issuerId: string;
  // Privileged binding map, signer, pinned trust root, bounded TTL, clock,
  // revoked selectors, and consumed token and invocation keys are dependencies/state.
  issue(input: CustodyIssueRequest): Promise<SignedCustodyToken | null>;
  revoke(input: { readonly selector: CustodyRevocationSelector; readonly reason: string }):
    Promise<CustodyRevocationReceipt>;
  verify(token: SignedCustodyToken, expected: CustodyTokenExpectation): Promise<CustodyTokenDecision>;
  consume(token: SignedCustodyToken, expected: CustodyTokenExpectation): Promise<CustodyTokenDecision>;
}
```

The first implementation owns a process-local binding map, including each target's mesh domain, and an ephemeral Ed25519 key. Its named `issuerId` plus instance-specific `keyId` is pinned in the local trust root; restart replaces the key and trust entry, invalidating all prior tokens. Token and invocation consumption keys expire with the token horizon. Revocation selectors remain effective for the source-instance lifetime unless the privileged binding lifecycle explicitly replaces their state. Holder revocation blocks issuance and matches every binding and unexpired token for that authenticated principal across registrations. The public ports contain no local-process assumption: a later remote source may issue over authenticated transport and back the same verifier/revocation semantics with remote introspection or distributed state.

## Integration narrative

1. For each loop tick, relaunch/recovery attempt, or bounded drumbeat target, h-runtime allocates an invocation ID and calls `CustodySource.issue` with the target, action, and authenticated session principal as holder.
2. The source resolves its authoritative binding and target mesh domain, emits a fresh target-bound token, and returns `null` rather than weakening any failed precondition.
3. The executor carries the encoded token separately from receipt evidence. The session router forwards it as `custodyToken`; the invocation verifier validates it and constructs `context.custody`. It never synthesizes source custody from registration, receipt, or principal fields.
4. The PDP executes authorize→actuate synchronously inline in one awaited call chain: assert source provenance, reload and compare current registration/action, atomically consume the token and invocation tuple, select and resolve the actuator, and invoke actuator I/O before returning. It MUST NOT expose a reusable success decision, place it on a queue, or allow unrelated asynchronous work between consume and the actuation attempt. “Synchronous inline” defines the execution boundary; it does not claim a database transaction can include external I/O.
5. Missing source provenance returns `custody_required`. Untrusted, stale, revoked, replayed, cross-target, cross-action, wrong-holder, wrong-epoch, wrong-custody, or unavailable-store evidence returns `custody_mismatch`. No adapter or executor has an issuance fallback.

Once consumption succeeds, the invocation is spent whether actuation succeeds, fails, or returns an uncertain outcome. A retry after an actuation attempt MUST allocate a new `invocationId` and obtain a new token; retrying the old tuple is rejected before I/O. Concurrent duplicate deliveries of one tuple permit at most one actuation attempt. If the outcome is uncertain, h-runtime must reconcile target state or `effectRef` before intentionally creating the next invocation; a new invocation is a new attempt, not deduplication of the old effect.

Deferred actuation is outside the bounded-local lock. If a future path must cross a durable queue or unrelated asynchronous boundary, the PDP may instead issue a short-lived, target/action/invocation-bound, single-use execution lease. The actuator must verify freshness and revocation and atomically consume that lease immediately before I/O. That variant requires a separate owner-approved contract and is not an alternate behavior implementations may choose under this lock.

## Security analysis

| Property | Enforcement |
|---|---|
| Named emitter | The signed `issuerId`/`keyId` tuple identifies one configured emitter instance; unknown tuples fail. |
| Trust root | Verification resolves only pinned Ed25519 public keys and rejects algorithm/key confusion, malformed canonical payloads, and invalid signatures. |
| Evidence | A domain/version-separated canonical payload covers all claims; mutation invalidates the detached signature. |
| Binding | Registration, action, holder, epoch, custody ID, audience, and invocation ID are signed and compared with current trusted values. This blocks cross-target and cross-action substitution. |
| Freshness/TTL | ISO timestamps must parse, `issuedAt <= now < expiresAt`, lifetime must not exceed the configured maximum, and expiry is capped by registration and binding. Clock skew is bounded explicitly. |
| Revocation | Token, binding, and holder selectors are checked during verification and atomic consumption; holder selectors are also checked at issuance. Epoch change fences all tokens from the prior custody generation. |
| Single use | Atomic consume records both `tokenId` and `(registrationId, invocationId)`; sibling tokens and duplicate deliveries cannot authorize a second attempt. |
| Availability | Failure to reach consume or revocation state is `custody_mismatch`; TTL never licenses fail-open operation. |

Private signing material never leaves the source. Context verification alone is insufficient authorization: current registration state, source revocation, and invocation-level consumption are checked again at the gate. The inline boundary prevents an authorization decision from surviving into deferred work; a future deferred path must use the execution-lease variant above.

## Owner confirmations

- **OWNER-CONFIRMED 2026-09-13:** add the distinct optional `custodyToken` bearer field to the `/auth/session/control/:action` request body, using the canonical base64url wire encoding above; do not overload receipt evidence.
- **OWNER-CONFIRMED 2026-09-13:** `issue()` derives `audience` from the mesh domain of the target registration; callers do not supply it.
- **OWNER-CONFIRMED 2026-09-13:** `holderPrincipalId` is the authenticated session principal, aligned with current custody derivation; adapters and executors cannot nominate a different holder.
- **OWNER-CONFIRMED 2026-09-13:** `SourceVerifiedCustodyRef` remains a cluster-mesh subtype of `VerifiedCustodyRef`; OQ5 does not change `@sentropic/contracts`.

The owner adopted all four recommended defaults on 2026-09-13. The current API verifier may continue synthesizing legacy custody until activation, but the new gate provenance guard makes that custody insufficient for OQ5; activation removes the synthesis path rather than retaining a fallback. `ClusterMeshRegistration` still has no authoritative `custodyId` or mesh-domain field, so the bounded-local source owns those values in its privileged binding map without changing the shipped registration shape.

## Deferred owner-gated

- **Persistence/schema:** the bounded-local first implementation needs no table. Its in-memory bindings, revocations, consumption keys, and ephemeral trust entry deliberately disappear on restart, invalidating prior tokens. Restart-surviving or distributed operation requires an owner decision on residence and consistency plus a future migration. Migration `0007` is **FROZEN** and MUST NOT be written or changed for OQ5.
- **Key rotation window:** the owner must configure maximum TTL, allowed clock skew, and the overlap during which old and new pinned `keyId` values verify. The first ephemeral-key implementation's restart invalidation does not choose the production rotation window.
- **Deferred execution lease:** if an owner later admits queued actuation, the execution-lease contract, store semantics, and actuator verification boundary require a separate gated decision. Inline actuation remains the only locked bounded-local model.

A remote replacement additionally needs authenticated issuance transport, issuer discovery/rotation, revocation consistency, and a store availability design that preserves unconditional fail-closed behavior. Those concerns do not block the bounded-local lock candidate and do not weaken its public ports.
