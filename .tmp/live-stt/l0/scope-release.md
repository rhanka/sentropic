# L0 scope, ledger and release ownership

Frozen integration base and moving-repository caveats: [baseline](baseline.md). This is a reservation of responsibilities, not source edits or permission to publish. This PR's executable plan is BRANCH.md. The approved spec's requirement to create all later executable branch plans at L0 is **not fulfilled**; the explicit disposition below replaces the earlier unrecorded postponement.

## Explicit L0 deviations — PR #753 review P2-2

These are recorded delivery deferrals from approved r3, not evidence that its L0 obligations passed. No spec rewrite or new path authorization is implied. Sol owns collecting the later receipts; the owner/reviewer can assess this bounded disposition without treating a candidate inventory or scope table as executable/qualified evidence.

| Deviation / required L0 deliverable | Reason it cannot be delivered within this L0 PR | Target lot and accountable lane | Mandatory entry criterion / closure receipt |
|---|---|---|---|
| L0-D01 — spec §11: executable branch plans from `plan/BRANCH_TEMPLATE.md` | This documentation branch allows only `BRANCH.md` and `.tmp/live-stt/l0/**`; `plan/**` and later source trees are forbidden. Future accepted integration tuples and external maintainer acknowledgements are also pending. The frozen scope table below is not a set of branch plans. | **L1 branch-init**, then **every subsequent lot's branch-init**, including Lp0/Lp1; each table row's Sol/Muse author, coordinated by Sol and the relevant repository/build owner. | Before any source edit, create that lot's worktree `BRANCH.md` from the repository template at its accepted head. Record exact Allowed/Forbidden/Conditional paths, lots/tasks, file-level tests, Make targets, test ENV/ports, UAT, version/consumer-lock changes and release/dependency gates. Run mechanical harness branch/scope checks. Closure is the plan path + source SHA + check receipt for each lot; L1's plan alone does not close all later plans. |
| L0-D02 — spec §8.1: permitted toolchain pin and Koffi/ONNX prefetched-or-safe-skip evidence | No approved per-platform image/VM digest or complete native provenance/SDK bundle was supplied. L0 performs no provisioning, installation or build; inventing exact admitted pins or claiming a static installer branch proves offline installation would fabricate qualification. | **L3 build-owner preparation, before L3/L4 implementation**; Muse + build/security maintainer, coordinated by Sol. L3b/L6 and later native lots inherit or extend the admitted tuple. | **G-NATIVE entry**, before engine/device code depends on the bundle: immutable image/VM digest, exact Node/TypeScript/CMake/compiler/SDK/Koffi/ONNX versions, platform/ABI, artifact digests/origins/licenses/SBOM and bounded jobs. Attach clean network-denied install/build/run receipts, process/egress evidence excluding interpreters/node-gyp, plus the two installer proofs below. Missing receipt blocks the affected lot, not just its eventual release. |

L0-D01 preserves default forbidden `Makefile`, compose, `.cursor/rules/**` and unrelated trees. Each lot explicitly allows its frozen source/test paths only: L8 must list `api/src/services/llm-metering/{budget-admission,route-settlement}.ts` and `api/src/routes/namespaces/gw.ts` if changed; L16/L17c list their `api/**` composition paths; L17 lists actual `ui/**` ChatComposer/app wiring and E2E paths. Listing package paths alone is insufficient. Build/CI additions require a named `BRLIVE-<lot>-EXn` with exact paths, reason, impact, rollback and build-owner approval **before** editing forbidden/conditional paths; no such exception is granted by this L0 document.

L0-D02 installer receipts must cover **Koffi 2.15.6**: exact matching prebuild URL/digest/platform/ABI and its local selection, or a pinned interpreter-free CMake build; prove no download or fallback child process during clean offline installation and successful native load. If scripts are skipped, verify the equivalent supplied artifact and load path. **ONNX Runtime 1.24.3**: exercise `ONNXRUNTIME_NODE_INSTALL=skip` under denied networking, verify bundled CPU library digests and successful native load plus representative inference; exclude CUDA/NuGet fetches. Static ONNX source hashes and Koffi's `--prebuild` flag in [dependencies](dependencies.md) close neither proof. Unknown/failed results keep G-NATIVE open; no weaker platform or runtime claim is substituted.

## Integrator and shared-file reservation

**Sol** is the single speech integration owner for mesh/gateway/cluster-mesh shared barrels, capability/model catalogues, package manifests and root locks. **Muse** prepares disjoint engine/client changes and release evidence; shared-file patches serialize through Sol. The h2a source integrator owns h2a exports/manifests/lock updates; no concurrent writer edits that lock. Release authority remains the existing protected CI/OIDC lane, accountable **rhanka**; neither agent identity supplies credentials or additional capacity. Exact external executing maintainer acknowledgements remain pending under the gate register.

All new paths below are relative to `packages/` unless prefixed `api/`, `ui/` or `h2a/`. All test paths are proposed; existing seams must be reconciled again at lot entry. Makefile/compose/CI additions need a named scoped exception and build-owner approval; source engine repositories remain read-only. Do not broaden a branch to repair unrelated runtime or infrastructure gaps.

| Lot / engineering owner | Frozen proposed file scope and file-level verification |
|---|---|
| L1 / Sol | `llm-mesh/src/speech/{contracts,capabilities}.ts`, catalogue/exports; `llm-mesh/tests/speech-contract.test.ts` |
| L1c / Sol | `cluster-mesh/src/speech/{config,projection}.ts`, existing config/catalogue seam; `cluster-mesh/tests/{speech-config,speech-projection}.spec.ts` |
| L2 / Sol | `live-speech/src/core/{session,interrupt,playback,usage-receipts}.ts`; `live-speech/tests/{interrupt,playback,ordering,usage-receipts}.test.ts` |
| L3, L3b / Muse | `live-speech/src/node/{local-stt,whisper-cpp}.ts`, worker seam; tests `local-stt`, `window-reconciliation`, `local-engine-registry`; native/model receipts |
| L4 / Muse | `live-speech/src/node/{capture,device,terminal-control}.ts`; capture/device/terminal-control tests and headset receipts |
| Lp0 / Muse | Initial mesh speech, live-speech core and cluster config exports/package metadata; pack/types/install/integrity receipts, then exact h2a locks |
| L5 / Sol | `h2a/packages/h2a-runtime/src/voice/{codex-control,session-owner,tool-gate}.ts`, launch/event/proxy seams and `test/fixtures/voice-tools.ts`; Codex/race/tool-gate tests |
| L6a / Muse | `live-speech/src/node/{tts-registry,voice-loop,playback}.ts`; local-TTS/voice-loop tests; synthesized-unplayed character bound and native/license receipts |
| L6b / Muse | h2a voice launch/attach + published consumer locks/config projection; `h2a/packages/h2a/test/voice-cli.test.js` |
| L7 / Sol | `h2a/packages/h2a/test/voice-barge-in.acceptance.test.js`, rig/calibration/attempt/effect/quota/usage receipts; no unreserved inference |
| L8 / Sol | `llm-gateway/src/speech/{admission,usage,settlement}.ts`, existing host ledger adapter with ledger owner; speech-metering/admission tests |
| L9 / Muse | `llm-mesh/src/speech/openai-transcription.ts`; `llm-mesh/tests/speech-openai-transcription.test.ts` |
| L13 / Muse | `llm-mesh/src/speech/mistral-transcription.ts`, TTS registry binding; `llm-mesh/tests/speech-mistral.test.ts` |
| Lp1 / Muse | Completed M1 engine/registry/gateway package metadata and exact h2a locks; packed native resources, registry integrity, clean installed tuple |
| L10, L11 / Muse | Mesh `speech/{openai-realtime,openai-live}.ts`; corresponding schema/cancel/truncation/delegation/usage tests |
| L12 / Sol | Mesh `speech/gemini-live.ts`; interrupted/tool-cancel/late-response/history/reconnect/usage tests |
| L14a, L14b / Sol | h2a `voice/{claude-control,claude-session-owner,muse-control}.ts` or qualified reuse; exact native hook/terminal/pairing/descendant tests |
| L15 / Muse | `cli/src/{registry,verb-registry,voice}.ts`, existing federation; CLI dispatch/attach/consent/stop tests |
| L16 / Sol | `api/src/services/live-speech/{relay,composition}.ts`, existing host namespace/config composition; auth/replica/revoke/worker-loss tests |
| L17 / Muse | `live-speech/src/browser/**` model workers/worklets, `chat-ui/**`, ChatComposer/app voice wiring; manifest/no-egress/voice-control/session/accessibility/E2E tests |
| L17b / Muse | `live-speech/src/{node,browser}/companion-*.ts`, pairing UX; companion bridge and hostile-origin/expiry/revoke/disconnect E2E tests |
| L17c / Sol | `api/src/services/live-speech/worker-composition.ts`, existing resource projection; worker placement/admission/isolation/lease/cancel tests |
| L18 / Sol | `flow/src/{job-runner,dispatch,transitions}.ts`, host queue/cancel adapter; workflow worker ACK/CAS/retry/successor/restart tests |
| L18c / Sol | `chat-core` runtime/steer/dispatch, `chat-server`, same host queue adapter; durable intent/push abort/pairing/no-resurrection tests; serialize with L18 |
| L19 / Muse | Cowork runner/consent bindings; no-next-click/key-release/stale-result tests, L21a Windows packaging/device receipts |
| L20 / Sol | Existing cluster source/session/effect attachment seam; source/controller generation/replay/unknown-ACK/SSH-mic remote tests |
| L21a, L21b / Muse | Windows/macOS registry/capture/STT/TTS packaging; separate OS install/device/cancel/native receipts; L21a precedes L19 |
| L22 / Sol | Runbooks and full integrated release/consumer/privacy/metering/fault/placement matrix; workflow/h2a/cowork acceptance and independent findings reconciliation |

## Existing ledger fit and bounded L8 work

Use `BudgetAdmissionPort` plus host `api/src/services/llm-metering/budget-admission.ts` and `route-settlement.ts`, composed by `api/src/routes/namespaces/gw.ts`. The host DB owns `control.budgets`, holds, dispatch markers and `control.cost_ledger`; pricing/storage stay outside mesh. Admission locks overlapping monthly buckets in order; financial settlement is transactional/idempotent. `cost-ledger-sink.ts` is observation-only and must not double-charge financial settlement. The personal recording sink is not an alternative ledger.

L8 must qualify duration/audio-token/character units, attempt and adjustment keys, unknown usage retention, restart-safe holds and atomic aggregate **UTC-day + campaign** caps across providers/accounts/models, not just the existing monthly token bucket. Native agent counted units remain in the custody allocator, separate from speech dollars. Bind the current ledger's adjustment contract with its owner; if new general ledger primitives are necessary, estimate that shared dependency separately. Retain L8 8–12 h conditionally; do not recreate a second billing store.

## Release and adoption receipts

| Package / live registry observation | Source manifest at integration base | Action owner and boundary |
|---|---|---|
| `@sentropic/llm-mesh@0.27.1` published | 0.27.1 | Sol integrates speech contract/adapters; Muse prepares Lp0/Lp1 release; normal semver + CI/OIDC owner gates |
| `@sentropic/llm-gateway@0.21.0` published | 0.21.0 | Sol + ledger owner integrate speech accounting; release maintainer publishes admitted exports, h2a integrator pins them |
| `@sentropic/cluster-mesh@0.22.0` latest at read | 0.22.1 from merged #729; exact registry 0.22.1 returned HTTP 404 | A merge is not publication. Refresh registry before L1c/Lp0; no source-link substitution |
| `@sentropic/live-speech` | New package, no registration/publication performed | rhanka's package release lane registers package/trusted publisher once; Muse prepares; live-speech package name still proposed |
| h2a runtime remote 0.98.7 manifest | cluster 0.16.0 / gateway 0.20.0 / mesh 0.26.0 | h2a integrator must select published compatible exact tuple and regenerate consumer lock; no adoption inferred from source presence |

Observed registry integrities:

```text
llm-mesh@0.27.1 sha512-P2AUFtAQDabYOTFfU5LDlK93h16zuIY8elAsvIIzzVgrmvkgfKtSqkGeLe1RVjqKweviULMKPBB0URdp10Gd4A==
llm-gateway@0.21.0 sha512-ONXwRrT4fbSG9a8wGvJoloJrW0BZnjLSAxD9lO/GTueLjMRVfTfd6DGQNxMxX23Nb1jxGswYJ2sD6IC74X9kpA==
cluster-mesh@0.22.0 sha512-xy+3lnR6mwu7R8asatuUbXunuVmaAg2BWnEgGVHaI79BGNXZhQ7npvNWRoO5XnWzQZY67i0JxQ0gaQKjsXGVYQ==
```

Lp0 gates L5; Lp1 gates L6b. Each receipt records protected source SHA, immutable npm version/integrity, exported types/subpaths/native resources, clean installed consumer smoke, exact h2a manifest/lock SHA and qualification scope. Later lots repeat it. Publication, integration, qualification and deployment are four distinct states; L0 performs none of them. Production rollout requires its existing host promotion authority and is not part of this draft PR.

## Estimate disposition

Retain r3 M1 105–155 agent hours and full 206–315 (247–410 with engineering reserve), conditional on the gates. Retain its conservative 136–205 elapsed full schedule by choice: L17 starts after L18c. L17 finishes 117–175 h, L17b 123–185 h. These hours exclude publication queues, allocator/provider/ledger/license/native/host waits and any acoustic operator time. Capacity-adjusted calendar bounds are in [capacity-study.md](capacity-study.md), not engineering-hour estimates.
