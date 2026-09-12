---
reviewer-model: opus-4.8
reviewer: cowork-redteam (W33)
target-ref: 1407af7e4
branch: feat/cowork-connector-host-mvp
lens: 7-BC + SOL-01/N-01/R3-01/R3-02 + J-1..J-4 + OQ-5/8 + C1-C6
independent-from-builder: gemini-3.7-flash-high
persisted-by: cowork lane (subagent was environment-blocked from writing/committing report files; dossier relayed verbatim for the record)
verdict: RELEASE-BLOCK
---

# cowork-redteam W33 — independent adversarial review of F3 MVP @ 1407af7e4

Sanity check: branch/HEAD verified (`feat/cowork-connector-host-mvp` @ `1407af7e4`); both offline gates independently re-run green — cowork-desktop 89/89 (15 files, incl. the SOL-01/N-01 device proofs) and connector-host 11/11, matching the builder's claims. Every contract judgment is re-derived from source.

## VERDICT: RELEASE-BLOCK
No code-determinable unauthorized-action / false-FAIT / forged-lease / secret-leak / guard-bypass / lease-survives-deletion hole was found (all such properties are CLOSED in code or strictly PENDING-RUNTIME). The block rests on two not-fully-closed attacked findings at medium severity — SOL-01's §2.3(c) `settled`/`reason` finalization label (NEW-1) and the §3.5 planted-marker test (J-3, hollow) — plus F-01/F-02 and the R3-01/R3-02/J api suites still PENDING-RUNTIME and Windows-hardware-UAT owed. Not CLEAR-FOR-UAT. Zero new critical/high.

## (a) Attack-surface results

| finding | status | key evidence | exploit result |
|---|---|---|---|
| SOL-01 | STILL-OPEN (partial) — actuation CLOSED, §2.3(c) label VIOLATED | `windows-provider.ts:124-155`, `lease-runner.ts:208`, `foreground-surface.ts:89-113`, fence `device-lease-service.ts:456-459`; label bug `device-lease-service.ts:500-504` + `cowork.ts:79-91` | Held 36-char `type` across Stop → device runs ≤1 ten-char chunk then aborts, no late FAIT (`remote-lease-runner.spec.ts:307-350`). BUT an executing lease the device never terminalizes is reaped and journaled `settled:'attested', reason:'stop_controller'` where §2.3(c) mandates `settled:'unverified', reason:'quiescence_unconfirmed'`; the correct branch (`cowork.ts:91`) is dead code → NEW-1 |
| N-01 | CLOSED (logic) + UAT-ONLY (native) | type/scroll require `guard.targetedInput`, throw when absent — no global fallback (`windows-provider.ts:115-155`); guard rechecks HWND/PID/signer/bounds around each chunk (`foreground-surface.ts:96-113,172-236`) | Focus-drift between recheck and send lands on pinned HWND via `WM_CHAR`/`WM_MOUSEWHEEL`, refuses on drift, fails closed when unmeasured (`windows-provider.spec.ts:22-28`). Real WM_CHAR into Notepad = UAT |
| R3-01 | CLOSED (wiring) / PENDING-RUNTIME (real revoke) | Signal traced end-to-end: `chat.ts:80`→`postgres-job-queue.ts:144` abort→`chat-service.ts:3887,4153-4167`→`foundation-executor.ts:586-589`→`catalog.ts:113`→`mount.ts:282`→`cowork.ts:280`→broker `wait(signal)` `cowork.ts:62-77` | Stop revokes lease, job not finalized until broker returns. Test uses mock `wait` (`cowork-broker.test.ts:100-135`). Residual: in-memory same-process abort only → NEW-4 |
| R3-02 | CLOSED (code) / PENDING-RUNTIME | Post-issue try/catch revokes `fault`, audits `settled:'unverified'` (`cowork.ts:112-205`); pre-start atomic revoke `device-lease-service.ts:510-516`; test faults `wait` (`cowork-broker.test.ts:74-98`) | Injected post-issue throw → PAS-FAIT, no orphan pre-start authority. Residual: faulted `executing` row never reaped → NEW-3 |
| J-1 | CLOSED | `projectDeliveryScope` keeps only `{capability,serverEnvelope,action}`, drops invocation/result/fence (`device-lease-service.ts:37-51`); applied at both device emit sites (`streams.ts:181`, `chrome-extension.ts:304`); no other route serializes `lease.scope` | Planted invocation/metadata/result → dropped (real test `cowork-lease-envelope.test.ts:32-53`). Minor: no `schema_violation` alert on extra keys |
| J-2 | CLOSED (code) / test-gap | `validCaptureResult` closes keys to `{ok,screen,width,height,image}` (`device-lease-service.ts:85-86`); extra key → `not_issuable` → PAS-FAIT, not persisted | Smuggled capture `metadata.secret` rejected before persist/return. No test plants it (see J-3); silent reject, no alert |
| J-3 | STILL-OPEN (test integrity) | audit "planted-marker" test exercises only the allowlist `redactCoworkAudit` (`cowork-redacted-audit.test.ts:13-63` vs `redacted-audit.ts:35-47`) | Tautological — see (c). Redaction code sound; the proving test is hollow |
| J-4 | CLOSED | 16-entry closed enum, reason/settled validated, free text dropped (`redacted-audit.ts:1-47`); tested `cowork-redacted-audit.test.ts:65-94` | Unknown reason dropped; audit carries only id/state scalars |

## (b) Binding-conditions / OQ / regression
Could not locate a distinct verbatim `BC-1..BC-7` list; the verbatim conditions are C1-C6 (`BRANCH.md:93-99`) + OQ-5/OQ-8 (ratification dossier). All no regression: C1 broker closure (`cowork.ts:252-282`), C2 human-select (`cowork.ts:225`), C3 device-proof (code present, PENDING-RUNTIME), C4 5-field server-signed envelope (`lease-envelope.ts:16-25`, `cowork-lease-envelope.test.ts:17-30`), C5a VM/kiosk gate (`device-lease-service.ts:159,208-226`), C5b revoke-before-delete + refuse-while-executing (`me.ts:309-320`, `device-registry.ts:84-96`), C6 doc citation (N-A), OQ-5 allowlist + chord primitive deleted (`input-action-schema.ts:7-55`, `windows-provider.spec.ts:86-90`), OQ-8 no false FAIT (`cowork-broker.test.ts:55-72`). SOL-02..07 / N-02 / N-03 / F-03 all still closed. F-01 / F-02 = PENDING-RUNTIME (unchanged; code aligned, not definitively wrong).

## (c) Planted-marker verdict — HOLLOW (as the §3.5 cross-surface proof)
`redactCoworkAudit` is a pure positive allowlist, so the audit "planted-marker" test (`cowork-redacted-audit.test.ts:13-63`) is tautological — it asserts an allowlist drops unlisted keys, fed a synthetic object, never a real emitted frame. §3.5 requires planting in `lease.scope` + `input_action.text` + capture `metadata.secret` and asserting absence from every response/SSE/audit line. Only the delivery surface has a genuine marker test (`cowork-lease-envelope.test.ts:32-53`, SOUND); the capture-result surface has none; positive controls lack a benign-marker-in-admitted-field + frame-count assertion. Net: delivery = SOUND, audit = HOLLOW, capture = ABSENT → §3.5 not satisfied. No actual leak found; closure rests on code reading, not this test.

## (d) NEW findings — zero critical/high; 2 medium, 2 low
- NEW-1 (medium, journal integrity, violates §2.3(c)) `device-lease-service.ts:500-504` + `cowork.ts:88-91`: reaper-forced revoke of an unreachable executing device is journaled `settled:'attested', reason:'stop_controller'` instead of `unverified/quiescence_unconfirmed`; false quiescence attestation + timeout mis-attributed as controller-stop. Fix: mark device-attested terminals distinctly so a reaped row reports `unverified`, and carry the true reason.
- NEW-2 (medium, = J-3, test integrity) `cowork-redacted-audit.test.ts:13-63`: add a real cross-surface planted-marker test (scope.invocation + input text + capture metadata.secret asserted absent from a real SSE frame/poll/result/audit + frame-key-count == allowlist-count).
- NEW-3 (low, liveness/fail-closed) `cowork.ts:88` / `device-lease-service.ts:469-488`: `reapExecutingLeases` is called only at the broker deadline; a faulted `executing` row (R3-02 path) is never reaped and lazy-expiry skips `executing`, so it wedges device/account deletion (409) indefinitely. Fix: background/lazy reap of stale executing rows, or reap in the fault path.
- NEW-4 (low, architectural, MVP-scoped) `queue-manager.ts:536`, `postgres-job-queue.ts:142-144`: Stop aborts via an in-memory per-process controller map; cross-process Stop / client-disconnect / no per-job timeout don't abort. Fine for single-instance isolated-VM MVP; bounded by the 25 s lease TTL otherwise.

Informational: `lease_settled_late` is defined but emitted nowhere; `schema_violation` alerts for J-1/J-2 drops are never emitted (leak closed, alerting absent).
