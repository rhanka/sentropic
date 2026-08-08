---
review: Cowork Feature-3 MVP (Option-B narrow kiosk) — fresh-leg adversarial pass
reviewer: claude Opus (fresh leg — did not build; codex sol was usage-limited)
lens: OQ-1 / OQ-7 / OQ-9 + OQ-5 / OQ-8 / consent (architect-mandated pre-demo gate)
target-ref: bafe02423
verdict: CLEAR-FOR-DEMO (contained kiosk alpha) — NO release-blocker
date: 2026-08-08
---

# Verdict: CLEAR-FOR-DEMO (contained kiosk alpha)

No release-blocker found. All blocker classes are provably stopped in code (evidence below). The demo (contained, isolated-VM, owner-driven, Notepad-class surface) may proceed. Shipping the **general** computer-use surface remains gated on the MED item — which is the already-ratified §9/BC-3 boundary, not a new blocker for the provisioned-VM demo.

## Findings (none blocking)

| Sev | OQ | file:line | Observation | Fix |
|---|---|---|---|---|
| **MED** | OQ-9/OQ-5 | `api/src/services/cowork/device-capabilities.ts:40-43`; enrolled from client env `run.ts:101-105` | `isolatedVmTarget`/`kioskSurface` are **self-asserted by the enrolling client** (env vars, human-approved via pairing), never code-proven. A compromised client could enroll a general machine as a kiosk target. Containment = enrollment TRUST, not enforcement. Acceptable for an owner-provisioned contained demo; **HARD blocker for the general surface.** | Bind kiosk attestation to a provisioning-signed / out-of-band VM attestation (general spec BC-3/OQ-2). Do NOT ship general CU on self-attestation. |
| Low | OQ-7/C4 | `lease-envelope.ts:17-39` | Lease envelope Ed25519-signed with the shared OIDC id_token key, no domain-separation tag. Not exploitable today (disjoint preimage spaces, single oracle) but fragile. | Prefix canonical preimage with `cowork-lease-v1:` and/or dedicated lease key. |
| Low | OQ-5 | `windows-provider.ts:164-169` | `provider.key(combo)` can press Enter/Ctrl/Alt/Win but has **zero callers** (executor dispatches only click/type/scroll). Denied primitive exists one dispatch-line from actuation. | Remove `key()` from provider/interface for the MVP. |
| Low | OQ-5 | `tools/input-action.ts:77` | `type` submission filter is `/[\r\n]/` only; misses Tab / U+2028 / U+2029 / U+0085. On the kiosk still cannot submit (no reachable Enter primitive). | Also deny `\t`, U+2028/9, U+0085 or allowlist printable ranges. |
| Low | C2 | `target-selection.ts:23,48`; `lease-runner.ts:100` | `coworkTargetSelections` is a per-process in-memory Map → multi-instance API misses the human selection → PAS-FAIT (fail-closed/flaky). `stop()` revokes only in-memory active leases. | Shared/durable selection store for multi-instance; document `stop()` scope. |
| Low | OQ-8 | `lease-runner.ts:121-125` + `windows-provider.ts:145-148` | `FAIT` reported whenever executor doesn't throw; a silent no-op (no focused window) still yields FAIT. Over-reports success, never false authority. | Optional: verify effect before FAIT. Not required for safety. |

## Why each blocker class fails (evidence)
- **Forged/replayed lease (OQ-7/C4):** MAC over all 5 fields (`lease-envelope.ts:17-25`); device recomputes preimage with its OWN deviceId as targetDeviceId (`lease-runner.ts:140`) so A's lease never verifies on B; `acknowledgeLease` filters on deviceId (`device-lease-service.ts:161-166`); verify BEFORE ack/execute (`lease-runner.ts:114`); two-sided (device-signed ack issued→acknowledged + device-signed completion acknowledged→consumed, userId-scoped); replay blocked by monotonic terminal state machine + 32-byte nonce + 45s atomic lazy expiry; wrong/absent kid → reject.
- **Guard/prod bypass (OQ-9):** `signLeaseEnvelope` is the ONLY minting site, called ONLY in `issueLease`, which blocks `NODE_ENV==='production'` (`device-lease-service.ts:51`) + requires `isNarrowCoworkKioskTarget` on the locked device row under `FOR UPDATE` (`:86-100`); legacy/missing attestation denies. (Residual = MED attestation-truthfulness.)
- **Lease survives deletion (OQ-9):** both deletion paths revoke in-flight leases in the SAME transaction before the row goes (`me.ts:308-311`, `device-registry.ts:79-95`) + FK cascade; issue-vs-delete race safe via `FOR UPDATE OF d`; double-consume/ack/revoke are single-winner conditional `UPDATE … RETURNING`.
- **Cross-invocation/tenant leak (OQ-1/C1):** mount holds only immutable ports; fresh broker closure per call over per-request input (`cowork.ts:143-151,83-97`); no module-scope mutable state; all queries userId-scoped; selections keyed userId:workspaceId:sessionId; same-toolCallId converges via (deviceId,turnRef) partial-unique index + onConflictDoNothing.
- **Model-chosen target (C2):** target from trusted human selection, not tool args (`catalog.ts:102-114`); direct HTTP route enforces `selected.deviceId===body.device_id`; public MCP route only constructs gmail/drive hosts, never the cowork adapter.
- **Unauthorized input / missed confirm (OQ-5+consent):** closed enum click/type/scroll default-throw; Enter blocked twice (filter + no reachable key primitive); consent default-deny, input_action never durable, always fresh foreground allow_once.
- **False FAIT (OQ-8/I5):** FAIT only on status=consumed (device-signed completion); timeout/non-FAIT/malformed → PAS-FAIT; ack-alone stays in-flight; all routers behind requireAuth.
