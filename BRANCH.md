# Feature: RC2 relay-1 preparation (packed connector + lane-client ports)

## Objective
Land the sentropic side of rc2-native-plan.md §2 items L-1..L-7: a PACKED `SessionRelayEndpointConnectorPortV1` and branded `SessionRelayLaneClientV1` in `@sentropic/cluster-mesh` (types + fail-closed skeleton first, then the engine), the composition contract (host composition vs mesh-internal), fake A / fake L→A behind the public API in tests only, runs of the CHAIN-ESTABLISH-2 / CHAIN-FRAME-TRANSLATION / CHAIN-BIND vectors, capsule pins for Node/TLS/HTTP-2, and stream/close/abort conformance vectors. DEP-FED stays a source-gap: every live route stays DISABLED and fail-closed; no local fill. No h2a wire code.

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` (new `src/sessions/relay-*` modules, `src/index.ts` export wiring, `package.json` exports + version bump, `tests/remote-session/**`) plus the mandatory lockfile/fixture sync of the version bump (BRrc2relay1-EX1).
- Make-only workflow, no direct Docker commands; the single Docker lock `.tmp/packets/DOCKER-LOCK.md` is taken PER COMMAND via `flock <lock> make ...`; never held across reasoning.
- Branch development happens in isolated worktree `tmp/worktrees/rc2-relay1-prep` (branch `feat/rc2-relay1-prep` from `origin/main` 812d1f053); `harness check branch` PASS C1 at init.
- Automated tests run on `ENV=test-rc2-relay1` only, always LAST (`API_PORT=8832 UI_PORT=5218 MAILDEV_UI_PORT=1112`, verified free); never `ENV=dev`; `make down ... ENV=test-rc2-relay1` after every test stack; reuse the pinned `node:24-bookworm-slim` image, no image build; never `make clean-all`; never `[skip ci]`.
- All new text in English. Commits via `make commit MSG="..."` only, ≤150 lines each, specific `git add` only; push often (crash safety). One CI run per final head; PR stays READY (not merged).
- Contract pins (binding, RC2.contract r3, all under /home/antoinefa/src/h2a/tmp/h-cond/rc2-contract/): MANIFEST.sha256 self sha256 `6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715`; manifest JSON `remote-session-contract-manifest.v1.json` sha256 `88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565`; RC2-CONTRACT.md `4a7fc1615148f64f0af168a3d01fb7881d479f6d464b532c9bd78cc0d2d08b89`; CHANGES-r3.md `04cbf4ad38cdac9417c6c17148736852036bc5636e3f8acc47c5190727448456`; changes-r3.json `fa2007c2e742c381c031bfc8b608557defa0650409d88451ed58f797b9d78843`; RC2-R2-SEMANTICS.md `6786e52e78d1e6afc9f06755e610a609e3ca77c5d1fb249feeb2f977b84f8331`. Verified before use (`sha256sum` recomputed in this lane). Lineage only: r2 MANIFEST `133e23f5…`, r1 MANIFEST `dfb25899…`; neither ACK transfers to r3. `CONTRACT PARTIAL` stays.
- Pinned vector digests used by the relay specs (r3, recomputed here): port-SessionRelayEndpointConnectorPortV1-connect `971a01f435f1def25c1059fcc56f325036edfdbe4eff5a2563228db319427feb`; port-SessionRelayLaneClientV1-request `bf4a60508ccbc869dfddedf89c30211e01316ba54ebbf1bd168a6212e13c0fbd`; port-SessionRelayLaneClientV1-stream `02f56eaee4107ae3aa7609ad985531d276e9c4468ceb9f0168e815a813da2fba`; port-SessionRelayLaneClientV1-close `0c2dd98198a54e31683377645578c7f101d5d0cefdfdba324bd2c5df68c5751f`.
- Source-gaps stay fail-closed (typed refusal, never invented bytes): DEP-FED/SG-FED (H2-I, F1/F2, F15, SessionTransitGrantV1) → all live routes incl. direct B→A disabled, `relay_grant_unavailable`; DEP-AUTH-A/A2.0b; DEP-AUTH-B/M0; SG-R15; SG-NATIVE (RC0ImportedRecord reject-all slot); DEP-RESIDENCE/RCP.
- No cross-repo source imports; tests pin vector SHA-256 digests instead of reading the h2a repo at test time. Fakes live in `tests/` only and refuse missing authorities (no always-allow double).
- Package bump rule: `packages/cluster-mesh/package.json` 0.26.0-dev.6 → 0.26.0-dev.7 (> published `npm view @sentropic/cluster-mesh version` = 0.25.0), with lockfile + packaging-fixture sync.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/email-code-hmac/**` (new: `custody.mjs`, `materialize.mjs`, `custody.selftest.mjs`)
  - `docs/secrets.md`
  - `docs/runbooks/email-code-hmac-cred-cycle.md` (new runbook + living registry)
  - `deploy/k8s/README.md` (one pointer entry in the secret-bundle section)
  - `BRANCH.md`
  - `packages/cluster-mesh/src/sessions/relay-*.ts` (new modules only; existing sessions files untouched)
  - `packages/cluster-mesh/src/sessions/relay.ts` (packed public entry)
  - `packages/cluster-mesh/src/index.ts` (export wiring only, if needed)
  - `packages/cluster-mesh/package.json` (exports subpath + version bump)
  - `packages/cluster-mesh/tests/remote-session/**` (new relay specs + test-only fakes)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`
  - `packages/*/src/**` except `packages/cluster-mesh/src/**`
  - `.github/workflows/**`
  - `.track/**`, `.tmp/**`, `.env`, root `package.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`, `api/package-lock.json`, `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`, `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` — only under BRrc2relay1-EX1
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge`: BRrc2relay1-EX1 — reason: rules/workflow.md Package Publication mandates a version bump + lockfile sync for any `packages/cluster-mesh/src/**` change (same sync as 45e961c8e: root + api lockfiles and the selected packaging fixture); impact: version-string-only diffs; rollback: revert the bump commit.
- [x] `acknowledge`: r3 pins recomputed in this lane before first commit (MANIFEST self 6245d3ae…, JSON 88823475… match the conductor pins); the four port-vector digests match the r3 manifest `ports[].methods[].vectorSha256` entries.
- [x] `acknowledge`: `harness check branch --current-branch feat/rc2-relay1-prep --expected-branch feat/rc2-relay1-prep` → PASS C1 (sentropic), run in the worktree against the freshly built `packages/harness/dist/bin/harness.js`.
- [x] `acknowledge`: plan/contract unsettled points — none found; L-1..L-7 and contract §8/annex B/runtimeComposition settle every point this branch implements. DEP-FED live-route disablement is the expected state, not a blocker.

## AI Flaky tests
- [x] No AI-dependent tests in scope; all relay specs are deterministic local fixtures/fakes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one preparation lot set on a single branch; no sub-workstreams; one final scoped test cycle and one CI run on the final head.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT — package-only change, no UI/API behavior change; test-campaign gates only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, .tmp/packets/COMMON-RULES.md, plan/BRANCH_TEMPLATE.md, plan-remote-ctl-v1.6-draft.md (relay-1 rows), rc2-native-plan.md §2 L-1..L-7, RC2.contract r3 §2/§4–§8 + manifest ports/routes/runtimeComposition + vectors.
  - [x] Worktree `tmp/worktrees/rc2-relay1-prep`, branch `feat/rc2-relay1-prep` from `origin/main` 812d1f053; `.env` copied from root; `harness check branch` PASS C1.
  - [x] Verify r3 pins (sha256 recomputed) and write this `BRANCH.md`; first commit pins r3.
  - [x] Environment mapping: `ENV=test-rc2-relay1` always LAST; ports `API_PORT=8832 UI_PORT=5218 MAILDEV_UI_PORT=1112` (free on host).
- [ ] **Lot 1 — Packed port types + fail-closed skeleton (L-1 first half)**
  - [ ] Tests first (red): `tests/remote-session/relay-ports.spec.ts` — port vector shapes (positive ACCEPT_SHAPE / negative REJECT_SCHEMA), fail-closed connect without mesh wiring → `{status:'refused', error:{code:'relay_grant_unavailable'}}` and no client, brand check (clientRef string cannot instantiate `SessionRelayLaneClientV1`), TypeError-only for invalid JS API use, typed refusals never throw.
  - [ ] Green: `src/sessions/relay-types.ts` (packed types + brand + route matrix), `src/sessions/relay.ts` (public entry + `createSessionRelayEndpointConnectorPort`), `src/sessions/relay-wiring.ts` (internal mesh-wiring seam, NOT in exports map), skeleton connector/lane client, `package.json` export `./sessions/relay` + version bump 0.26.0-dev.7 with BRrc2relay1-EX1 lockfile/fixture sync.
  - [ ] Lot gate (all under `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, one command at a time, ENV LAST):
    - [ ] `make typecheck-cluster-mesh API_PORT=8832 UI_PORT=5218 MAILDEV_UI_PORT=1112 ENV=test-rc2-relay1`
    - [ ] `make test-cluster-mesh SCOPE=tests/remote-session/relay-ports.spec.ts API_PORT=8832 UI_PORT=5218 MAILDEV_UI_PORT=1112 ENV=test-rc2-relay1`
    - [ ] `make build-cluster-mesh ... ENV=test-rc2-relay1` + `make pack-cluster-mesh ... ENV=test-rc2-relay1` (packed export present in archive)
    - [ ] `make down API_PORT=8832 UI_PORT=5218 MAILDEV_UI_PORT=1112 ENV=test-rc2-relay1`
    - [ ] `make scope-check ENV=test-rc2-relay1` PASS C2; `make commit`; push.
- [ ] **Lot 2 — Composition contract + chain engine + fakes (L-2, L-3, L-4)**
  - [ ] Tests first (red): `tests/remote-session/relay-chain.spec.ts` (CHAIN-ESTABLISH-2 path/pairing cases, CHAIN-FRAME-TRANSLATION re-frame + credit cases from chain-wire-coordinates, CHAIN-BIND framing/exporter cases; vector SHA-256 pins) and `tests/remote-session/relay-fakes.spec.ts` (fake A + fake L→A behind the public API: prepare → upgrade/Open/Opened → Bind/Bound → lane request/stream; fakes refuse missing authorities).
  - [ ] Green: `src/sessions/relay-composition.ts` (host-composition vs mesh-internal split, documented), `src/sessions/relay-chain.ts` (path check, CAS pairing, frame translation, credit, bind framing/JCS/exporter context), `src/sessions/relay-engine.ts` (connector engine driving the chain through the wiring seam), test-only fakes under `tests/remote-session/relay-fakes.ts`.
  - [ ] Lot gate: typecheck + scoped `make test-cluster-mesh SCOPE=tests/remote-session/relay-chain.spec.ts ...` and `...relay-fakes.spec.ts ...` + `make down` + scope-check + commit + push.
- [ ] **Lot 3 — Lane client engine + conformance vectors + capsule pins (L-5, L-6)**
  - [ ] Tests first (red): `tests/remote-session/relay-conformance.spec.ts` (L-6: cold open on first next, single consumer, ≤8 events / 131072 bytes then relay_backpressure, one typed error then done, return() cancels only its request, abort → relay_unavailable, close idempotent + outcome-neutral) and `tests/remote-session/relay-capsule.spec.ts` (L-5: Node 22.22.1/24.18.0 pins + checks digests, ALPN `cluster-mesh.session-relay.inner.v1`, TLS 1.3 only / no 0-RTT / no resumption, enablePush:false, enableConnectProtocol:false, max 8 streams, header list ≤8192, exporter label).
  - [ ] Green: `src/sessions/relay-lane-client.ts` (branded client: request/stream/close with runtimeComposition semantics), `src/sessions/relay-capsule.ts` (pinned option objects + version pins), engine lane transport behind fakes.
  - [ ] Lot gate: typecheck + scoped tests + full `make test-cluster-mesh ENV=test-rc2-relay1` + `make down` + scope-check + commit + push.
- [ ] **Lot 4 — Final validation, PR, CI, report**
  - [ ] Full scoped run: `make test-cluster-mesh API_PORT=8832 UI_PORT=5218 MAILDEV_UI_PORT=1112 ENV=test-rc2-relay1` (whole package suite, no regression), `make typecheck-cluster-mesh`, `make build-cluster-mesh` + `make pack-cluster-mesh`, `make down ... ENV=test-rc2-relay1`.
  - [ ] `make scope-check ENV=test-rc2-relay1` PASS C2; commit; push `feat/rc2-relay1-prep`.
  - [ ] Open READY PR (BRANCH.md as body, English, test plan included); run ONE CI on the final head; do not merge.
  - [ ] Report to `.tmp/rv/rc2-relay1-prep.md` (root checkout path /home/antoinefa/src/sentropic/.tmp/rv/rc2-relay1-prep.md).
