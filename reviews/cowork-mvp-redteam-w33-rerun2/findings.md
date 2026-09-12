---
reviewer-model: opus-4.8
reviewer: cowork-redteam RE-RUN 2 (W33, fix cycle 5)
target-ref: 6843a461a  (on 1407af7e4 + redteam-1 dossier 36997de2d)
branch: feat/cowork-connector-host-mvp
lens: re-run-2 fix-verification (NEW-1/NEW-2/NEW-3/NEW-4) + full non-regression
independent-from-builder: gemini-3.7-flash-high
method: source re-derivation only — docker test stack unavailable in checkout (buildx/"invalid reference format"), so all DB-backed suites are PENDING-RUNTIME; unit tests read, not executable via make-only path
persisted-by: cowork lane (subagent environment-blocked from writing/committing report files; dossier relayed verbatim for the record)
verdict: CLEAR-FOR-UAT (with PENDING-RUNTIME + Windows-hardware-UAT residuals)
---

# cowork-redteam RE-RUN 2 — independent adversarial re-review of F3 MVP @ 6843a461a

Sanity: Branch/HEAD confirmed `feat/cowork-connector-host-mvp` @ `6843a461a`. Cycle-5 diff surface is tight: only `device-lease-service.ts`, `admin.ts`, `me.ts`, `device-registry.ts` (+ tests + BRANCH.md + the redteam-1 doc). No SOL-01/N-01/OQ-5/C4 core file was touched. Made no product-code changes, no push, no merge. Docker test stack unavailable in checkout (buildx/"invalid reference format") → all DB-backed suites genuinely PENDING-RUNTIME; every claim re-derived from source.

## (b) NEW-1 / NEW-2 / NEW-3 / NEW-4 status

| fix | status | file:line | exploit attempted → result |
|---|---|---|---|
| NEW-1 (journal integrity, §2.3c) | CLOSED (code) | `device-lease-service.ts:521-533` (branch logic); `:447-452,463` (deviceSettled marker); `:474-491` (reap sets `reaped`); `cowork.ts:70,84,88-91` (stop/timeout→reap(0)) | Raced an executing lease to a reaper/timeout-forced revoke with NO device terminal: `revokeLease('timeout')` sets `cancellationRequestedAt` only (status stays executing); at deadline `reapExecutingLeases(0)` sets `reaped:true`→ `readLeaseOutcome` branch-1 returns `settled:'unverified', reason:'quiescence_unconfirmed'`. Genuine device-attested stop: `completeLease` PAS-FAIT sets `deviceSettled:true`+`consumedAt`→ branch-2 `settled:'attested'`. Tried to force a false `attested` on an actuated lease: executing→revoked only via reap (`reaped→unverified`, checked first) or `completeLease` (`deviceSettled→legit attested`); `cancellationAcknowledgedAt` requires status already `revoked` + device signature, and `reaped` dominates in branch order. No false-attested path found. Actuation fence (`completeLease:461-464` NOT `scope?'cancellationRequestedAt'` + `gt(expiresAt,now)`) byte-identical to baseline → NOT weakened. |
| NEW-2 / J-3 (planted-marker test) | CLOSED at projection level; end-to-end wire test PENDING-RUNTIME | running: `cowork-redacted-audit.test.ts:15-117`; skipped: `cowork-planted-marker.spec.ts:15` (`describe.skip`) | See soundness verdict (c). Running unit test is SOUND + failure-sensitive across all 3 real projections; closes the "hollow/tautological" finding. The literal end-to-end cross-surface spec is `describe.skip` (PENDING-RUNTIME) and carries vacuous witnesses → new low finding N5-1. |
| NEW-3 (reap stale executing / deletion liveness) | CLOSED (code); no C5b regression | `device-lease-service.ts:474-491,500`; `me.ts:315-332`; `admin.ts:373-390`; `device-registry.ts:92-110` | Within-fence executing (`cancellationRequestedAt` <5s old, or none, and unexpired) NOT reaped → deletion still 409. Stale (`cancellationRequestedAt`≤now−5s) OR expired (`expiresAt`≤now) executing is reaped→revoked(`reaped`) → deletion succeeds. Tried delete-while-actuatable: reap targets ONLY non-actuatable rows (authority lapsed at envelope `expiry`, or device told to stop >5s past quiescence grace); unexpired-uncancelled executing untouched → delete-while-can-actuate window NOT opened. Deletion tx holds `cowork_devices ... FOR UPDATE` serializing against issue/ack/claim → no lease can reach executing mid-deletion. No race. |
| NEW-4 (cross-process Stop residual) | HONESTLY DOCUMENTED | `BRANCH.md` resolved-note + checkbox ("NEW-4 ACCEPTED residual: cross-process/client-disconnect Stop relies on 25s lease-TTL expiry") | Matches redteam-1's NEW-4 (in-memory per-process Stop bounded by 25s TTL). Documented as accepted, not silently changed. |

## (c) Planted-marker test soundness — RUNNING TEST SOUND; SKIPPED WIRE TEST DEFECTIVE (N5-1)

Running test (`cowork-redacted-audit.test.ts:15-117`) — SOUND + failure-sensitive (not tautological): drives the three ACTUAL projection functions on realistic inputs with real markers in real leak-candidate fields, genuinely FAILS on a projection regression:
- Surface 1 `projectDeliveryScope` — markers in `invocation.secretNote`, `metadata.secret`, `result.secret`, plus `cancellationRequestedAt`; asserts `M_SCOPE`/`M_CAPTURE` absent, no `invocation`/`metadata`/`result`/`cancellationRequestedAt` props, positive control `action.text==M_TEXT`, key-count `==3`/sorted-keys allowlist. Both emit sites route through this one function (`streams.ts:181` SSE, `chrome-extension.ts:304` poll) → redteam-1 "poll vs SSE" gap closed at projection level.
- Surface 2 `validCaptureResult` — smuggled `metadata.secret` AND top-level `secret` both →false (fail-closed), well-formed →true, key-count `==5`.
- Surface 3 `redactCoworkAudit` — markers in `text`/`action`/`scope`/`result`/`secret`; asserts none present, deep-equals 8-key allowlist, key-count `==8`.

Skipped end-to-end spec (`cowork-planted-marker.spec.ts`, `describe.skip`) — PENDING-RUNTIME and DEFECTIVE as written (N5-1): (i) `M_SCOPE` planted in request `scope.metadata`, but `issueLease` persists only `{capability, serverEnvelope, invocation, action}` — `metadata` never stored → asserting its absence is vacuously true; (ii) `M_CAPTURE` absence from SSE frame (step 3) checked BEFORE `M_CAPTURE` introduced in step-4 result POST → vacuous; (iii) capture surface asserts only 409 rejection, not secret-absence-from-emitted-result-frame. Net: running unit proof genuine and closes the finding; the literal "real cross-surface bytes" proof remains PENDING-RUNTIME and its vacuous witnesses must be fixed before it can serve as the §3.5 runtime gate. No actual leak exists.

## (d) Non-regression — ALL CLEAR
Cycle-5 modified no core-safety file; each previously-CLOSED property re-checked:

| property | result | evidence |
|---|---|---|
| SOL-01 actuation fence | not regressed | `completeLease:461-464` unchanged; device files untouched |
| N-01 HWND guard / fail-closed | not regressed | `windows-provider.ts`/`foreground-surface.ts` untouched |
| R3-01 chat-stop wiring | not regressed | `cowork.ts:62-77` unchanged |
| R3-02 exception-safe lifecycle | not regressed | `cowork.ts:177-205` unchanged; faulted executing now reaped (NEW-3) |
| J-1 delivery projection | not regressed | `projectDeliveryScope:37-51` unchanged; both emit sites intact |
| J-2 closed capture schema | not regressed | `validCaptureResult:81-93` unchanged |
| J-4 closed audit enum | not regressed | enum now 16 entries incl. `quiescence_unconfirmed`,`fault`; allowlist projection intact |
| C1 broker closure / C2 human-select | not regressed | `cowork.ts:252-282`, `:225` unchanged |
| C4 5-field server-signed lease | not regressed | `issueLease:182-193` (leaseId,capability,targetDeviceId,nonce,expiry) unchanged |
| C5a VM/kiosk gate | not regressed | `issueLease:159` prod-block + eligibility SQL `:208-226` unchanged |
| C5b revoke-before-delete + refuse-while-executing | not regressed (improved) | deletion tx lock + within-fence 409 preserved; only stale/expired reaped |
| OQ-5 input allowlist | not regressed | `input-action-schema.ts:3-52` only `click`/`type`/`scroll` |
| OQ-8 no false FAIT | not regressed | FAIT requires signed valid result + unfenced + unexpired; reap never yields FAIT |
| SOL-02..07 / N-02 / N-03 / F-03 | not regressed | no related file touched in cycle 5 |

## (e) F-01 / F-02
PENDING-RUNTIME (unchanged). Code aligned, not definitively wrong; require a real migrated Postgres/API run, impossible in this checkout (docker API image build unavailable). Not ruled CLOSED from TypeScript alone.

## (f) NEW findings this cycle — zero critical/high

| severity | file:line | issue | fix |
|---|---|---|---|
| LOW (test-integrity) N5-1 | `cowork-planted-marker.spec.ts:32-87` | Skipped §3.5 integration spec has vacuous negative witnesses (M_SCOPE never persisted by `issueLease`; M_CAPTURE checked pre-introduction; capture surface asserts rejection not emitted-frame-absence). Not a leak; will not prove what it claims when un-skipped for UAT. | Plant markers in fields `issueLease` actually persists (`action.text`, `invocation`); read the delivery frame AFTER a completed capture; assert secret absence from the actual result/poll frame bytes. |
| INFORMATIONAL/LOW (perf) | `device-lease-service.ts:474-491,500` | `reapExecutingLeases` is an UNFILTERED global sweep (no user/device predicate) now invoked on every `readLeaseOutcome`, i.e. every 100ms of a broker `wait` loop → write amplification / row-lock contention under concurrency. Safe (only stale/expired rows flip) but not scale-friendly. | Filter by leaseId/device, or move to a background/lazy interval, before multi-instance. |

Also still-informational (from redteam-1, unchanged): `lease_settled_late` defined but never emitted; `schema_violation` alerts never emitted (leak closed in code, alerting absent).

## (g) VERDICT
CLEAR-FOR-UAT (with residuals) — NEW-1, NEW-2/J-3, NEW-3 genuinely closed in code (NEW-2's substantive no-leak property closed AND now guarded by a failure-sensitive, non-tautological unit test across all three projection surfaces), NEW-4 honestly documented as an accepted MVP residual, nothing regressed, zero new critical/high (two low/informational only). Residuals confined strictly to the two allowed categories and block real production use until cleared:
1. PENDING-RUNTIME — a real migrated Postgres/API run to execute the DB-backed lease/journal/deletion suites, F-01/F-02, and the §3.5 cross-surface integration spec (which must FIRST have its vacuous witnesses fixed, N5-1, before it is a valid gate). Docker test stack unavailable in this checkout, so none of this could be executed here.
2. Windows-hardware-UAT — real WM_CHAR/foreground-guard actuation and HWND-drift refusal on Windows (N-01 native half, SOL-01 device actuation).

No unauthorized/unconsented action, false FAIT, cross-invocation/tenant leak, forged/replayed lease, guard bypass, secret-on-wire leak, lease-surviving-deletion, or deletion-race-on-an-executing-lease was found in code. This lifts redteam-1's RELEASE-BLOCK, whose two medium (NEW-1, NEW-2/J-3) and one low (NEW-3) grounds are remediated.
