# SPEC F3 MVP — Permissions, Stop/fail-closed, Journal (Notepad-kiosk computer-use)

Design-only consolidation of the Feature-3 contract for three concerns, grounded on the ratified conditions and the four independent adversarial dossiers. Code anchors are `path:line` against branch `feat/cowork-connector-host-mvp` at code HEAD `fc945379` (dossier re-run 3 target). This spec targets the build leg, the independent redteam leg, and the owner UAT; it changes no product code.

## 0. Scope, vocabulary, grounding

- Scope: F3 only — `screen_capture` + `input_action` from controller Cowork **A** against a human-selected isolated Notepad-kiosk VM **B**. Not general computer use (`BRANCH.md:8,160`).
- Status labels used below:
  - **CLOSED** — closed in code per the independent dossiers, code-determinable, with an existing test.
  - **OUTSTANDING** — needs the build leg; a target fail-closed contract is given here.
  - **PENDING-RUNTIME** — statically aligned; needs a migrated Postgres/API run (the isolated stack is not runnable in this checkout, `BRANCH.md:80,150`).
  - **UAT-ONLY** — native Windows behaviour verifiable only by the owner on the isolated VM.
- Ratified binding conditions C1–C6: `BRANCH.md:89-94`; decision record `../COWORK_MVP_RATIFICATION_archi.md` (OQ-1/4/5/6/7/8/9/10). I5 is the in-force version: the MVP returns only FAIT or PAS-FAIT; DÉPOSÉ-EN-ATTENTE is deferred (`../COWORK_MVP_RATIFICATION_archi.md:6`; `spec/SPEC_EVOL_COWORK_CONNECTOR_HOST_MVP.md:63`). The authoritative I1–I5 publisher is h2a `docs/governance/surface-invariants.md` (PR #152), cited cross-repo (`BRANCH.md:79,94`).
- Dossiers (independent, gpt-5.6-sol): `reviews/cowork-mvp-oq179-sol/findings.md` (SOL-01..07), `-rerun/findings.md` (N-01..03), `-rerun2/findings.md` (F-01..03), `-rerun3/findings.md` (R3-01/02 + final matrix). Prior Opus leg `reviews/cowork-mvp-oq179/findings.md` (refuted on three premises, `…-sol/findings.md:38`).
- Cross-lane redaction contract (memory `reference_session_fact_redaction_contract`, rules 1–10) is adopted verbatim in §3.

### 0.1 Blocker ledger (single source for the handoff)

| id | concern | status at `fc945379` | evidence | closes by |
|---|---|---|---|---|
| C1 broker closure | P | CLOSED (lifecycle gap = R3-02) | `…-rerun3/findings.md:39`; `api/src/services/connector-host/cowork.ts:151-170` | build (R3-02) |
| C2 human-select-always | P | CLOSED | `…-rerun3/findings.md:19`; `api/src/services/connector-host/cowork.ts:124-125` | — |
| C3 device proof | P | CLOSED | `api/tests/api/cowork-device-delivery.spec.ts:69`; `api/src/services/cowork/device-identity.ts:64-85` | — |
| C4 server-signed lease | P | CLOSED | `…-rerun3/findings.md:40`; `api/tests/unit/cowork-lease-envelope.test.ts:17` | — |
| C5a isolated-VM + kiosk | P | CLOSED static (SOL-02); runtime = N-01 | `…-rerun3/findings.md:17,23` | build (N-01) + UAT |
| C5b revoke-before-delete, Stop-revokes, atomic | S | CLOSED pre-start; post-start = SOL-01 | `…-rerun3/findings.md:16,41` | build (SOL-01) |
| SOL-01 act after revoke/expiry/Stop | S | **OUTSTANDING** | `…-rerun3/findings.md:16` | build |
| SOL-02 self-asserted kiosk gate | P | CLOSED | `…-rerun3/findings.md:17` | — |
| SOL-03 tool-call id aliasing | P | CLOSED | `…-rerun3/findings.md:18` | — |
| SOL-04 workspace exposure | P | CLOSED | `…-rerun3/findings.md:19` | — |
| SOL-05 reusable capture consent | P | CLOSED | `…-rerun3/findings.md:20` | — |
| SOL-06 control chars through `type` | P | CLOSED | `…-rerun3/findings.md:21` | — |
| SOL-07 capture pixels dropped | J/P | CLOSED | `…-rerun3/findings.md:22` | — |
| N-01 runtime kiosk guard (type/scroll global focus) | S/P | **OUTSTANDING** (click CLOSED) | `…-rerun3/findings.md:23` | build + UAT |
| N-02 narrowed capture | P/J | CLOSED | `…-rerun3/findings.md:24` | — |
| N-03 exposure grant path | P | CLOSED | `…-rerun3/findings.md:25` | — |
| F-01 exposure revoke vs issued authority | S | PENDING-RUNTIME | `…-rerun3/findings.md:26` | runtime run |
| F-02 migration admits `executing` | S | PENDING-RUNTIME | `…-rerun3/findings.md:27` | runtime run |
| F-03 malformed action → FAIT | P | CLOSED | `…-rerun3/findings.md:28` | — |
| R3-01 controller Chat Stop not wired to lease | S | **OUTSTANDING** | `…-rerun3/findings.md:34` | build |
| R3-02 post-issue exception orphans authority | S | **OUTSTANDING** | `…-rerun3/findings.md:35` | build |
| J-1 delivery frame emits `scope` verbatim | J | **OUTSTANDING** (new, §3.3) | `api/src/routes/api/streams.ts:181-186` | build |
| J-2 capture result key set not closed | J | **OUTSTANDING** (new, §3.3) | `api/src/services/cowork/device-lease-service.ts:59-69` vs `:79` | build |
| J-3 planted-marker test absent | J | **OUTSTANDING** (new, §3.5) | only `api/tests/unit/cowork-redacted-audit.test.ts:6-11` exists | build |
| J-4 audit has no closed `reason` enum | J | OUTSTANDING (proposed, §3.4) | `api/src/services/cowork/device-lease-service.ts:459` discards `reason` | build |
| J-5 durable audit journal | J | DEFERRED (logger sink accepted for the isolated-VM MVP) | `api/src/services/connector-host/cowork.ts:153-158` | hardening |
| P-x unreachable `key()` chord primitive | P | OUTSTANDING-LOW (delete) | `packages/cowork-desktop/src/capability/types.ts:85-89`; `windows-provider.ts:72-101,190-196` | build |

## 1. Permissions model

### 1.1 Invariants

- **P1 Deny-by-default, finite allowlist.** Exactly two capabilities exist anywhere in the system: `screen_capture` and `input_action` (OQ-5). Unknown capability, unknown action shape, unknown key → refused before any authorization, never normalized.
- **P2 `input_action` = click / scroll / type-literal only.** Chords, Enter, Tab, submission, clipboard, IME, and every Unicode control/format/line/paragraph/surrogate code point are denied on both sides (server issuance and device execution). A "safe" literal is still only allowed against the attested surface (see N-01, §2.3).
- **P3 Consent is per invocation, allow-once, bound to `{tool, leaseId, actionDigest}`, consumed exactly once immediately before actuation. Never durable for either remote capability.** A standing deny may be durable.
- **P4 Human selects the target device, always, even with one eligible device; the id never comes from model arguments.** The actuated window is the measured foreground Notepad displayed in the consent prompt, never a model choice.
- **P5 Device proof of possession on every delivery/ack/start/result; a bearer alone receives nothing** (C3).
- **P6 Two-sided authorization:** server-signed envelope over exactly `{leaseId, capability, targetDeviceId, nonce, expiry}` verified by the device before consent/ack/action, plus device-signed ack/start/result (C4).
- **P7 Isolation is enforced by the server and by the device runtime guard, never by a client claim** (redaction rule 7 — never trust a producer's safety flag). Non-production only; server provisioning record keyed by the device public key with exact `kioskSurface='notepad'`; DPAPI machine-bound key; measured System32 Microsoft-signed Notepad HWND/PID/client bounds.
- **P8 Per-invocation broker closure owns the lease lifecycle; the shared mount holds ports only** (C1). Nothing per-invocation lives on the mount.
- **P9 Exposure is a durable `(device, workspace, capability)` grant required at discovery, selection, issuance, ack and start; selection narrows a grant, never creates one** (SOL-04, N-03).

### 1.2 Mechanism (as built) with anchors

| invariant | server | device |
|---|---|---|
| P1 | `api/src/services/cowork/device-capabilities.ts:11,21`; issue gate `device-lease-service.ts:137-144`; mount gate `connector-host/cowork.ts:159,164-166` | registry of two tools `packages/cowork-desktop/src/tools/registry.ts:15-23`, unknown tool `:46-53` |
| P2 | exact discriminated schema + closed keys `api/src/services/cowork/input-action-schema.ts:2-5,29,37-55`; literal-text class filter `\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}` + 1 024 code points `:1,7,21-27` | mirror `packages/cowork-desktop/src/tools/input-action-schema.ts:13-32`; `literal-text.ts:1,3,5-28`; executor three cases only `tools/input-action.ts:51-53,63-79`; sole `keyboard.type` primitive, no fallback `capability/windows-provider.ts:165-173` |
| P3 | — (receipt never sent to server, `consent/types.ts:31-35`) | persisted remote allow deleted and prompt forced `consent/manager.ts:67-71,78-82`; `allow_always` downgraded `:153-154`; receipt `{id, toolName, leaseId, actionDigest}` `consent/types.ts:36-41`; single consumption `manager.ts:107-118`; gate `tools/registry.ts:55-70` |
| P4 | selection store + sole authenticated route `api/src/services/cowork/target-selection.ts:17-21,32-43`; `api/src/routes/api/chrome-extension.ts:276-290`; one-device ambiguity denied `connector-host/cowork.ts:124-125`; model path fails closed `api/src/services/skills/catalog.ts:102-105` | consent prompt shows measured `executable`, `signerSubject`, `clientArea`, `windowTitle`, `hwnd` + coordinates/text `remote/lease-runner.ts:42-55` |
| P5 | delivery proof ±30 s `device-identity.ts:64-85`; SSE gate `api/src/routes/api/streams.ts:262-275` | proof headers on every call `remote/lease-runner.ts:329-336` |
| P6 | envelope `lease-envelope.ts:6-12,17-39`; ack/start/cancel/result domain prefixes `device-lease-service.ts:293,346,383,414` | verify before ack `remote/lease-runner.ts:146,230-238` |
| P7 | client flags non-authorizing `device-capabilities.ts:15-18,42-47`; provisioning `provisioning.ts:6,33-54`; issuance lock joins active provisioning `device-lease-service.ts:196-198`; ack recheck `:310-312`; admin-only provision `api/src/routes/auth/device.ts:64,123-135` | DPAPI fail-closed `enroll/windows-machine-identity.ts:40-42`; signed System32 Notepad + bounds `capability/foreground-surface.ts:7,38-48,60,81-87` |
| P8 | `connector-host/cowork.ts:80-107,151-170` | — |
| P9 | grant route `routes/auth/device.ts:138-145`; `provisioning.ts:71-118`; enforced `connector-host/cowork.ts:167-169`, `target-selection.ts:32-43`, `device-lease-service.ts:184-205` | — |

### 1.3 Status

- CLOSED: P1, P2, P3, P5, P6, P8 (closure creation), P9; P4 for device selection; P7 static gate. Dossier rows SOL-02..06, N-02, N-03, F-03.
- OUTSTANDING: P7 runtime for `type`/`scroll` (N-01, contract in §2.3); P8 lifecycle closure (R3-02, §2.3); P-x delete the unreachable chord primitive `key()`/`resolveKeyCombo`/mock `kind:'key'` (`capability/types.ts:85-89`; `windows-provider.ts:72-101,190-196`; `mock-provider.ts:15`) — structural absence beats an unreachable path (redaction rule 9; repo rule "no legacy fallback").
- UAT-ONLY: DPAPI restart survival and copied-blob failure on another host/account; the packaged PowerShell probe resolving the real Microsoft Notepad identity; the foreground prompt actually presenting in front of Notepad (`…-rerun2/findings.md:41`; `…-rerun3/findings.md:44`).

### 1.4 Acceptance tests

Existing (keep green): `packages/cowork-desktop/tests/tools.spec.ts:40,93,110-125,137`; `windows-provider.spec.ts:12-45` (zero native loads on rejected text); `consent.spec.ts:23,52,95-127`; `foreground-surface.spec.ts:12-39`; `api/tests/unit/cowork-broker.test.ts:7-41`; `api/tests/services/cowork/target-selection.spec.ts:6,18`; `api/tests/api/cowork-device-leases.spec.ts:69,78,110,133`; `cowork-exposure.spec.ts:21-108`; `cowork-device-delivery.spec.ts:37-69`.

Required additions (build leg):
- `windows-provider.spec.ts`: the provider interface exposes no `key` member; a `{action:'key'}` request fails at schema, and no `pressKey` symbol exists in the compiled provider.
- `tools.spec.ts`: `type` and `scroll` without a `targetedInput` primitive of matching `kind` → `CapabilityUnavailableError`, zero `nut` loads (mirrors click at `windows-provider.ts:155-160`).

## 2. Stop / fail-closed semantics

### 2.1 Invariants

- **S1 (I5)** Only a signed, validated, persisted `consumed` result is FAIT. Timeout, offline, denial, mismatch, replay, malformed, expiry, surface-guard failure, Stop → PAS-FAIT, never a success-lookalike (OQ-8; `spec/SPEC_EVOL_COWORK_CONNECTOR_HOST_MVP.md:51`).
- **S2** Stop revokes the active lease (C5b). "Active" means every non-terminal lease of the invocation, whichever surface raised Stop: local Stop on B, controller Chat Stop on A, bounded server timeout, lease expiry, exposure revoke, device/account deletion.
- **S3** Pre-start: Stop/revoke/expiry/deletion and the device's final start claim have exactly one winner; if revoke wins, the device never enters the provider.
- **S4** Post-start: a terminal PAS-FAIT is reported only after confirmed quiescence of the native actuation, or is explicitly labelled unverified in the journal (§3.4). The connector never reports terminal PAS-FAIT while a start-winner can still actuate (SOL-01).
- **S5** Native actuation is bounded and abortable between bounded chunks; the maximum actuation after a Stop is one chunk.
- **S6** Every actuation chunk is delivered to the measured HWND with a guard-and-act check around it; foreground drift → refuse the chunk and terminalize PAS-FAIT (N-01).
- **S7** Once a lease is issued, no exception, abort, or fault path can return to the caller with the lease non-terminal and no cancellation fence recorded (R3-02).
- **S8** Late results after a durable cancellation fence never become FAIT; they are accepted only as settlement evidence.

### 2.2 Mechanism (as built)

- Lease FSM `issued → acknowledged → executing → consumed | expired | revoked` (`device-lease-service.ts:16-17,35`); each transition is a conditional single-winner update (`:316-327,359-363,421-433`); a late FAIT is fenced by `expiresAt > now` and `NOT (scope ? 'cancellationRequestedAt')` (`:425-432`); PAS-FAIT → `revoked` (`:419`); a PAS-FAIT carries no result (`:83`).
- Server revoke: pre-start statuses → `revoked`; an `executing` row gets only the durable fence `cancellationRequestedAt` and returns `execution_in_progress` (`:458-476`; route 409 `chrome-extension.ts:233-240`); device polls the fence every 100 ms (`:478-487`; `remote/lease-runner.ts:291-312`).
- Broker bounded wait: 30 s total, cancellation requested at 25 s (`connector-host/cowork.ts:30,62-76,100`), lease TTL 25 s (`device-lease-service.ts:12-14`), non-FAIT → revoke (`cowork.ts:101`), fixed PAS-FAIT at deadline (`:75`).
- Lazy expiry only for `issued|acknowledged` (`device-lease-service.ts:442-446`); missing row, consumed-without-result, expired, revoked → PAS-FAIT (`:449-454`).
- Device Stop: synchronous cancel + abort, revoke I/O, then awaits every execution's `settled` (`remote/lease-runner.ts:123-138`); gate `canEnter` re-checked before consent-ack, before start, before and after the tool (`:176,183,202,210,245-247`); consent precedes ack (`:170-186`); signed start claim (`:187-191`); expiry and server-cancellation watchers (`:193-194`); `AbortSignal` handed to the tool (`:208`).
- Native quiescence: the provider deliberately awaits the whole native promise, then observes the signal (`capability/windows-provider.ts:39-51`); click is HWND-targeted `SendMessage` with foreground/PID/bounds re-derived inside the native process (`capability/foreground-surface.ts:89-111,154-181`); `type` and `scroll` are global-focus `nut` calls after a JS-side recheck (`windows-provider.ts:165-188`).
- Deletion paths revoke pre-start leases and refuse to cascade while `executing` (`device-registry.ts:75-99`; `routes/api/me.ts:308-325`; `routes/api/admin.ts:366-383`); exposure revoke terminalizes matching pre-start leases (`provisioning.ts:101-106`).
- Controller Chat Stop cancels the chat job only (`api/src/routes/api/chat.ts:59-93`, `:80`); no `revokeLease` caller exists on that path.

Status: S1, S3, S8 CLOSED (`…-rerun3/findings.md:40-43`); S2 CLOSED for local Stop / timeout / expiry / deletion / exposure pre-start, OUTSTANDING for controller Stop (R3-01); S4, S5, S6 OUTSTANDING (SOL-01, N-01); S7 OUTSTANDING (R3-02); F-01/F-02 PENDING-RUNTIME.

### 2.3 Outstanding code-blockers and the target fail-closed contract

**SOL-01 — abortable native op + confirmed quiescence** (`…-rerun3/findings.md:16`; `windows-provider.ts:39-51,172`; `connector-host/cowork.ts:62-75`).
- Device: replace the single `keyboard.type(text)` / scroll call by bounded chunks. Target bound: one chunk ≤ 250 ms wall-clock (the build leg picks the chunk size and proves it with a timing test); between chunks: `throwIfAborted()` + `recheckAfterNativeAwait()`; the abort signal, the server-cancellation poll, and the expiry watcher all feed the same `AbortController` (`remote/lease-runner.ts:148-153,193-194`). Capture must run in a killable helper (sub-process) whose kill is awaited. `stop()` keeps its `settled` barrier (`:137`), which now resolves within one chunk bound.
- Device terminal: after abort, post signed `PAS-FAIT` only after the barrier resolves (existing `:210-215` ordering kept); the cancel-ack transition `cowork-lease-cancel-v1` (`device-lease-service.ts:383`) is the settlement proof for a pre-start cancel; for post-start, the signed PAS-FAIT is the settlement proof.
- Server finalization: the broker no longer returns at a fixed grace. Contract: `wait()` requests cancellation at `deadline − QUIESCENCE_BOUND_MS` and then waits for a device-signed terminal until `deadline`. `QUIESCENCE_BOUND_MS ≥ cancellation-poll interval (100 ms) + one chunk bound (250 ms) + network margin`; the current 5 000 ms satisfies it. At `deadline`: (a) signed PAS-FAIT arrived → PAS-FAIT, audit `settled: 'attested'`; (b) row never started → `revoked|expired`, PAS-FAIT, `settled: 'not_started'`; (c) row still `executing` with the fence recorded and no device terminal → terminalize `revoked`, PAS-FAIT, audit `reason: 'quiescence_unconfirmed'`, `settled: 'unverified'` (I2: asserted, not measured). The caller receives the same PAS-FAIT in all three; the journal distinguishes them. A later device PAS-FAIT on a row already `revoked` by (c) is accepted idempotently as `lease_settled_late` (audit only; never FAIT; `completeLease` gains that one non-mutating branch, `:410,425`).
- Reaper: an `executing` row with `cancellationRequestedAt` older than `QUIESCENCE_BOUND_MS` and no device terminal is terminalized to `revoked` + `quiescence_unconfirmed` so that `device-registry.ts:92-95` deletion refusal converges (fail-closed without a permanent orphan).
- Bound on residual actuation: with S5, the worst case after any Stop surface is one chunk; this is the ratified "bounded" contract, and the audit states when settlement was not attested.

**N-01 — HWND-targeted `type`/`scroll`, refuse on foreground drift** (`…-rerun3/findings.md:23`; `windows-provider.ts:165-188`; `capability/types.ts:26-31`; `foreground-surface.ts:196`).
- Extend `TargetedNativeInput` to `kind: 'click' | 'type' | 'scroll'`; the Windows probe delivers each chunk from inside one native invocation that (1) re-measures foreground HWND + PID and compares with the consent token, (2) re-verifies executable identity and client bounds, (3) delivers the chunk addressed to that HWND (window-message delivery or an equivalent whose destination is the HWND, never an OS-focus injection resolved at delivery time), (4) re-measures after delivery; any mismatch before delivery → refuse the chunk; mismatch after delivery → no further chunk, PAS-FAIT. This mirrors the click helper (`foreground-surface.ts:166-177`).
- Deny, never degrade: if HWND-addressed text/scroll delivery is not achievable on the provisioned Notepad build, `type`/`scroll` become `CapabilityUnavailableError` → PAS-FAIT (as click does today, `windows-provider.ts:155-160`). Global-focus `nut.keyboard.type` / `nut.mouse.scroll*` are removed, not kept as fallback.
- The consent token retains the canonical signed executable identity and measured client area (already, `foreground-surface.ts:41-48`) and the same token is required around every chunk.
- UAT-ONLY: whether the provisioned Windows 11 Notepad accepts HWND-addressed character/wheel delivery; zero input after Stop on real hardware; DPAPI; signed-executable probe.

**R3-01 — controller Chat Stop must reach the lease** (`…-rerun3/findings.md:34`; `routes/api/chat.ts:80`).
- Thread the chat job `AbortSignal` into the catalog invocation context and into `createCoworkInvocationBroker` (`connector-host/cowork.ts:80-90`; `skills/foundation-executor.ts:583-588`; `catalog/sources/standalone-tool-source.ts:54-64`). On abort: immediately `revokeLease` (pre-start → `revoked`; executing → fence), then keep waiting for the device terminal under the SOL-01 finalization rule; the stopped chat job is not finalized (`chat.ts:83-90`) until the broker returned. Stop from A therefore has the same three outcomes as the timeout path.

**R3-02 — post-issue exception-safe lifecycle** (`…-rerun3/findings.md:35`; `connector-host/cowork.ts:93-107`).
- After `broker.issue` succeeds, every audit/wait/read/revoke path runs inside one `try/finally`; on any thrown error or abort the finally block revokes/fences, awaits the bounded settlement, emits `lease_result` with `outcome: 'PAS-FAIT'` and a closed `reason`, and the closure returns PAS-FAIT (never the generic `status:error`). This is the concrete meaning of "per-invocation broker closure closed after use" (C1): the lease row is terminal, or fenced with the reaper pending, whenever the closure returns.

**F-01 / F-02 — PENDING-RUNTIME.** Run `api/tests/api/cowork-exposure.spec.ts`, `cowork-device-leases.spec.ts:241-277`, and the broker suite on a migrated Postgres/API stack (`ENV=test-cowork-connector`); inspect the live status check and partial index of `api/drizzle/0041_cowork_device_identity_lease.sql:29-47` before flipping to CLOSED.

### 2.4 Acceptance tests

Existing (keep green): `packages/cowork-desktop/tests/remote-lease-runner.spec.ts:70,89-134,136,168,208,242-305`; `api/tests/api/cowork-device-leases.spec.ts:218,241,262-277,280,343`; `api/tests/unit/cowork-broker.test.ts:55-72` (timeout/offline/denial/mismatch/replay/stop/malformed → PAS-FAIT).

Required additions (build leg):
- `remote-lease-runner.spec.ts`: after a 200 start claim with a chunked provider, Stop / server cancellation / expiry → at most one chunk after abort, `/result` posted only after `settled`, exactly one PAS-FAIT; the provider's chunk timing test proves the ≤ 250 ms bound with a fake clock.
- `windows-provider.spec.ts` + `foreground-surface.spec.ts`: `type`/`scroll` route through `targetedInput` with `kind` `type`/`scroll`; drift injected between chunks → remaining chunks refused, PAS-FAIT; without the primitive → `CapabilityUnavailableError`, zero `nut` loads.
- `api/tests/unit/cowork-broker.test.ts`: fault injection immediately after issue, during audit, during wait, during revoke → row terminal or fenced, PAS-FAIT returned, `lease_result` emitted once; `wait()` outcomes (a)/(b)/(c) of SOL-01 with the correct `settled` label; late device PAS-FAIT after (c) recorded as `lease_settled_late` and never FAIT.
- New `api/tests/unit/chat-stop-cowork.test.ts`: controller `/stop` with a held consent → lease `revoked`, provider never entered; with an `executing` row → fence recorded, job finalized only after the broker returned.
- `api/tests/api/cowork-device-leases.spec.ts`: reaper terminalizes a fenced `executing` row after the bound; device deletion then succeeds.

### 2.5 UAT-ONLY (owner, isolated VM, spec §8 script `spec/SPEC_EVOL_COWORK_CONNECTOR_HOST_MVP.md:80`)

Steps (6) deny, (7) Stop a pending action and prove no later execution, (8) offline/stale/unowned/expired/replayed; plus: Stop during a long `type` shows at most a fraction of the text and the transcript reports PAS-FAIT; controller Stop from A stops B; no input reaches any window other than the measured Notepad.

## 3. Journalisation / audit redaction

### 3.1 Invariants

- **J1 Ids only.** Audit, lease rows exposed to any consumer, presence, and result metadata carry ids and closed enums — never pixels, typed text, coordinates as free text, URLs, window titles, secrets, bearer tokens (OQ-9 ratified; `spec/SPEC_EVOL_COWORK_CONNECTOR_HOST_MVP.md:27`).
- **J2 Posture per flow, not per lane** (rule 1): the server is producer of audit/lease/presence (NEVER-EMIT by construction) and consumer of device-produced results and of model-produced arguments (NEVER-TRANSMIT-BEYOND-THE-ADAPTER).
- **J3 Closed schema, positive allowlist, no escape hatch** (rules 3, 5): every emitted object is constructed field by field; there is no spread, no `raw`, no passthrough mode.
- **J4 Excluded ≠ unknown** (rule 4): a known-excluded field is dropped silently; an unknown field is dropped AND alerted with its PATH, never its value.
- **J5 The UI never filters** (rule 2): redaction happens at the adapter/projection; Cowork A renders VIEWs.
- **J6 Never trust a producer's redaction claim** (rule 7): a device-supplied "redacted"/"isolated" flag or a client `metadata` bag has no authority; the server enforces.
- **J7 Isolation is held by the consumer** (rule 8): device proof + ownership + runtime guard, never the device's self-scoping; the public MCP route structurally cannot reach the Cowork adapter (rule 9; `…/cowork-mvp-oq179/findings.md:30`).
- **J8 I2:** each journal line states measured vs asserted where it matters (`settled: attested|unverified|not_started`, §2.3).

### 3.2 Flow inventory and posture

| flow | producer → consumer | posture | admitted payload | anchor |
|---|---|---|---|---|
| F-A audit line | server → operator log | NEVER-EMIT | `kind, toolCallId, capability, leaseId?, targetDeviceId?, outcome?` (+ proposed `reason`, `settled`) | `api/src/services/cowork/redacted-audit.ts:1-20`; sink `connector-host/cowork.ts:153-155` |
| F-B connector result | server → invoking session S (model/UI A) | consumer projection, closed | `input_action`: `{status:'FAIT', result:{ok, action, actionDigest}}`; `screen_capture`: `{status:'FAIT', result:{ok, screen:0, width, height, image}}`; else `{code:'cowork_not_done', message:'PAS-FAIT'}` | `connector-host/cowork.ts:97,104-105`; `device-lease-service.ts:59-87` |
| F-C device delivery frame | server → device B only (device-proof) | closed projection | `{leaseId, nonce, expiresAt, scope:{capability, serverEnvelope, action}}` | `routes/api/streams.ts:175-187`; poll `chrome-extension.ts:300-305` |
| F-D device terminal ingestion | device B → server | consumer, closed + digest-bound + signed | input: `{ok, action, actionDigest}`; capture: `{ok, screen, width, height, image}`; PAS-FAIT: no result | `device-lease-service.ts:71-87,393-435` |
| F-E consent receipt / prompt | device-local | never leaves B | receipt `{id, toolName, leaseId, actionDigest}` never sent to the server | `consent/types.ts:31-41` |
| F-F controller chat SSE | server → session S owner | chat lane; carries the model-authored tool call and F-B result only | — | `chat-service.ts`, out of this spec's redaction scope except by F-B |

The delivery frame F-C is the only server surface where the literal action (coordinates, `text`) is admitted, because B renders the consent prompt from it (`remote/lease-runner.ts:42-55,158-175`; N-01 fix requires showing the measured window and the action). The capture image is admitted only to F-B (the hands loop needs eyes; SOL-07).

### 3.3 Mechanism (as built) and gaps

- Audit projection is a literal object with six allowlisted keys (`redacted-audit.ts:11-20`); lease `action` is documented "never emitted to audit" (`device-lease-service.ts:22`); the device posts "only a signed, bounded terminal outcome; never pixels or typed content" for input (`:393`, keys closed at `:79`); manifest declares the three event kinds and `piiClass:'high'` (`connector-host/cowork.ts:43`); every result carries `redactionClass:'high'` (`:34,97,104-105,165,168`). Existing test: `api/tests/unit/cowork-redacted-audit.test.ts:6-11`. CLOSED for F-A shape.
- **J-1 (OUTSTANDING):** F-C serializes `lease.scope` verbatim (`streams.ts:184`), so the frame also carries `scope.invocation` (`principalId, workspaceId, sessionId, …`), and after completion could carry `result`/`resultDigest`/`cancellationRequestedAt` (`device-lease-service.ts:24-29`). The device needs none of these; the envelope preimage is `{leaseId, capability, targetDeviceId, nonce, expiry}` (`lease-envelope.ts:6-12`), so the projection cannot break verification. Target: `sseCoworkLeaseEvent` and the poll route build `{leaseId, nonce, expiresAt, scope:{capability, serverEnvelope, action}}` field by field; any other `scope` key → dropped + alert `{kind:'schema_violation', leaseId, path:'scope.<key>'}`.
- **J-2 (OUTSTANDING):** `validCaptureResult` (`device-lease-service.ts:59-69`) validates required keys but does not close the key set (contrast `validInputResult` `:79`). A device-attached `metadata` (or any extra key) passes, is persisted into `scope.result` (`:420`), and is returned to the caller (`:451-452`; `connector-host/cowork.ts:104`). This is the "sub-field of an admitted type" trap (rule 6). Target: capture result key set closed to exactly `{ok, screen, width, height, image}` on both sides (`packages/cowork-desktop/src/tools/screen-capture.ts` produces exactly that); an extra key is a malformed result → `not_issuable` → PAS-FAIT + alert with path `result.<key>`. Because the device signature binds `resultDigest`, "drop and keep" is not an option here; reject is the fail-closed choice.
- **J-4 (proposed):** `revokeLease` discards its `reason` (`device-lease-service.ts:459`) and the audit event has no reason. Add a closed enum `reason` to `CoworkAuditEvent` and `settled` (§2.3): `reason ∈ {timeout, offline, denied, mismatch, replay, malformed, stop_local, stop_controller, expired, surface_guard, invalid_signature, not_issuable, exposure_revoked, device_deleted, quiescence_unconfirmed, fault}`. Never free text; the caller-facing result stays binary FAIT/PAS-FAIT (I5 MVP).
- **J-5 (DEFERRED):** the connector-host audit port is a no-op (`connector-host/cowork.ts:158`) and the sink is the process logger (`:153-155`). Acceptable for the isolated-VM MVP (ratification OQ-9 requires redaction, not durability); a durable journal is hardening.

### 3.4 Closed schemas (positive allowlists)

```
F-A audit line   := { kind ∈ {lease_issued, lease_result, lease_denied, lease_settled_late, schema_violation},
                      toolCallId, capability ∈ {screen_capture, input_action},
                      leaseId?, targetDeviceId?, outcome? ∈ {FAIT, PAS-FAIT},
                      reason? ∈ <closed enum §3.3>, settled? ∈ {attested, unverified, not_started}, path? }
F-B result       := input:   { status:'FAIT', result:{ ok:true, action ∈ {click,type,scroll}, actionDigest } }
                    capture: { status:'FAIT', result:{ ok:true, screen:0, width, height, image:<png data URI ≤ 4 MiB> } }
                    else     { ok:false, error:{ code:'cowork_not_done', message:'PAS-FAIT', retriable:false } }
F-C delivery     := { leaseId, nonce, expiresAt, scope:{ capability, serverEnvelope, action:<canonical action> } }
F-D ingestion    := input:   { ok:true, action, actionDigest }   (exact keys)
                    capture: { ok:true, screen:0, width, height, image }   (exact keys)
                    PAS-FAIT: result absent
```

`path` in `schema_violation` is the dotted field path only; the value is never logged.

### 3.5 Planted-marker acceptance test (negative invariant + positive controls)

Rationale (rule 10): a negative-only redaction test is satisfiable by emptiness; every "absent" assertion below is paired with a "present in the admitted place" control and a frame-count control. Runs against a real API + migrated Postgres (`ENV=test-cowork-connector`), so it is PENDING-RUNTIME until the stack runs; the unit-level halves (projection functions, validators) run in Vitest without the stack.

Setup: provision + enroll device B (`api/tests/utils/cowork-device.ts`), grant exposure, human-select B for session S; open B's device-proof SSE, a second device C stream (other owner), and session S2's chat stream; inject the audit sink through `createCoworkConnectorHost({ audit })` and capture the API logger output for the whole scenario.

Markers:
- `M_TEXT = 'WITNESS-TEXT-<random>'` as `input_action.text` of a `type` action issued through the mount.
- `M_SCOPE = 'WITNESS-SCOPE-<random>'` written directly into the persisted row as `scope.metadata.note` (simulating tomorrow's leaked field) and as `scope.invocation.sessionId` (an excluded-but-known field).
- `M_CAPTURE = 'FAKE-SECRET-<random>'` posted by B inside a signed capture result as `metadata.secret`, alongside a well-formed control capture without it.
- Benign positive marker: the `leaseId` and `toolCallId` ids; the PNG control image with a known digest.

Assertions:
1. Audit: no line contains `M_TEXT`, `M_SCOPE`, or `M_CAPTURE`; each line's key set equals the F-A allowlist; every line contains `leaseId` (positive); emitted line count == expected count for the scenario (`lease_issued` + `lease_result` per lease, one `lease_denied` for the denied branch, one `schema_violation` for the capture-with-metadata branch).
2. API log capture: none of the three markers anywhere (covers `logger.info` sinks and any request logging).
3. F-C frame for B (SSE and poll): exactly one frame per lease; `scope.action.text === M_TEXT` (positive control — admitted); `scope.metadata`, `scope.invocation`, `scope.result`, `scope.cancellationRequestedAt` absent; a `schema_violation` audit line with `path:'scope.metadata'` was emitted; frame key set equals the F-C allowlist.
4. Device C stream and the cross-owner stream: zero frames (extends `cowork-device-delivery.spec.ts:37,59`).
5. F-B result for `type`: `{status:'FAIT', result:{ok, action:'type', actionDigest}}` exactly; no `M_TEXT`.
6. F-B result for the capture-with-metadata: PAS-FAIT (`cowork_not_done`); the lease row's `scope.result` is absent; `M_CAPTURE` absent from row, audit, result, logs; `schema_violation` with `path:'result.metadata'`. Positive control: the well-formed capture returns FAIT with the image whose digest equals the control digest and `width/height > 0`.
7. Session S2 chat stream: none of the markers. Session S's own stream may contain `M_TEXT` inside the model-authored tool call (its author's own transcript; not a redaction surface) and the F-B result only.
8. Unit halves: `redactCoworkAudit({...event, extra: M_SCOPE})` returns exactly the allowlist keys (extends `cowork-redacted-audit.test.ts:10`); `validCaptureResult` rejects any extra key; the F-C projection drops unknown keys and reports their path.

### 3.6 Status

CLOSED: F-A shape, F-D input shape, SOL-07 result carriage, N-02 capture narrowing, structural absence of the adapter from the public MCP route. OUTSTANDING (build leg): J-1, J-2, J-3 (this test), J-4 (proposed). DEFERRED: J-5. UAT-ONLY: the packaged VM build's stdout contains no raw-sensitive audit during the §8 script (`BRANCH.md:194` "raw-sensitive audit" fails UAT).

## 4. Handoff summary

- Build leg targets (in dependency order): R3-02 lifecycle guard → SOL-01 chunked abortable actuation + settlement-aware finalization + reaper → N-01 HWND-targeted `type`/`scroll` (deny if not achievable) → R3-01 controller Stop threading → J-1 delivery projection → J-2 closed capture keys → J-4 audit `reason`/`settled` → J-3 planted-marker suite → P-x delete `key()`. Each item lists its tests in §1.4, §2.4, §3.5.
- Redteam leg: re-attack SOL-01 (hold a long `type` across Stop/timeout/expiry after a 200 start), N-01 (focus switch between chunks), R3-01/R3-02 (controller Stop with held consent; fault injection after issue), J-1/J-2 (sub-field markers), and confirm the ledger in §0.1 before any CLEAR-FOR-DEMO claim.
- PENDING-RUNTIME: F-01, F-02, and the §3.5 integration halves — require the migrated Postgres/API stack.
- UAT-ONLY (owner on the isolated VM): DPAPI restart/copy behaviour; Microsoft-signed Notepad probe; HWND-addressed click/type/scroll delivery on the provisioned Notepad build; zero input after Stop on hardware; capture pixels/primary display; consent prompt presentation; no raw-sensitive stdout.
