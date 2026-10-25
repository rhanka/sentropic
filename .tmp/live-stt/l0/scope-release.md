# L0 scope, ledger and release ownership

Frozen integration base and moving-repository caveats: [baseline](baseline.md). This is a reservation of responsibilities for future branch plans, not source edits or permission to publish. This PR's executable plan is BRANCH.md; each later lot instantiates the repository template after mechanically checking its branch and accepted dependency tuple.

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
