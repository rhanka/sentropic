# W0-close.d refreshed tuple — 27 October 2026

## Receiving contract

The [current tuple](published-tuple.json) replaces the 18/26 October selections for W4.a receiving integration. It freezes artifacts 0.2.4, cluster-mesh 0.22.4, llm-mesh 0.28.1 and llm-gateway 0.21.3. Comments 0.3.1, platform 0.4.0, auth-hono 0.17.0 and mcp-auth 0.2.2 are explicitly installed too. SDK 1.32.1, Hono 4.13.0, JOSE 5.10.0, pg 8.22.0 and S3 SDK 3.1095.0 are the published-consumer external pins.

Workspace-source mode remains selected. The original W2.b/#702/UP-T merge `2c3bf7750c0d9e13372bb573cc4fb5fc0b4a86cc` is followed by integration `ca3239295` (W1.a/b/d, W2.a/b, W4.a) and published artifacts 0.2.4 source `60affbaf6fb3ea99fcb4c885c615140d2a34c9f2`, preserving this PR's branch plan. The tuple's `sourceSha` binds the subsequent registry/lock reconciliation; `sourceInputs` hashes each qualified root/API/package input. The event-log blob remains identical to integration; no Track store was authored or rewritten.

API retains `file:../packages/artifacts`; mesh resolves the same physical workspace package, now 0.2.4. W1.c must consume its exported activation adapter through this workspace relationship. Independently pinning a registry copy in the API would break the frozen source mode. This is W2.b's owner-authorized lock continuation; no package release or package source modification was authored here.

APP-P1 selects exactly `artifacts_ensure`, `artifacts_publish`, `artifacts_list`, `artifacts_get`, with invocation scope **`mcp:tools:invoke`**. Profile digest remains `0de19f966eacb5b63142b525611a6210a0d4aaeefbdaad92dfb3b6227575b6ef`; the manifest digest becomes **`020aacfec500d754b76c90d3ad4a05097e0f996b8b9282145ca458917ea6fb27`**. Internal reader/maintenance ports and unselected-operation refusals remain as frozen in [host-fit](host-fit.md).

## Executed evidence

- [Published fit](published-fit-2026-10-27.json): strict exact-version install with zero source links; actual Comments/gateway loads; one cluster-mesh and shared llm-mesh; API/mesh physical artifacts path equality; selected builtin compilation without invoking host ports. **No upstream cluster-mesh bump is needed.**
- [Payload receipt](payload-equivalence-2026-10-27.json): npm metadata and downloaded archive SHA-512 SRI checked; archive SHA-256; complete normalized path/byte SHA-256 maps for both published and clean-built source payloads, including manifests/exports/declarations/SQL/examples.
- [Complete workspace resolution](workspace-resolved-2026-10-27.json): all **1699** root lock entries, full installed development tree and full installed runtime tree. Strict `npm ci --strict-peer-deps --ignore-scripts` succeeds; `npm ls --omit=dev --all --json` succeeds; root/API lock bytes remain unchanged. Tools: Node 24.21.0, npm 11.19.0, lock-pinned TypeScript 5.4.5. Native install scripts are excluded from this package/registry probe; W3 retains image qualification.
- [Registry results](registry-results-2026-10-27.json): the retained original red run has **19 failures / 2 passes**, reproducing `App artifacts registry requires the pinned APP-P1 manifest`. On 0.2.4, **23/23 pass**: exact public tools/scopes, denial gates, physical Node resolution without aliases, production-settings bundle, and refusal of the superseded 0.2.1 and 0.2.3 compatibility receipts. Transport and registry share one frozen digest; compatibility remains exact, with no old/new acceptance list.

Full-development `npm ls --all` retains three diagnostics: @vitest/ui 4.1.5, esbuild 0.19.12 and packages/skills @types/node 20.11.30. Their complete dependency paths are in the receipt. They do not invalidate the strict install or runtime tree; this lot does not claim a clean development `npm ls` exit. No peer override or timeout increase was introduced.

## Payload equivalence limits

All 124 artifacts payload paths and all llm-mesh paths match exactly, including the public PostgreSQL activation adapter, host conformance vectors and `sql/0001_activation.sql`. The artifacts archive SRI is also checked against the owner's published 0.2.4 integrity. The mesh/gateway JavaScript, manifests, exports, SQL, examples, maps and all other declarations match exactly.

Two generated declaration files differ only in ordering of string-literal union members: mesh `dist/storage/root-facade.d.ts` (`utf8 | base64`) and gateway `dist/request-receipts.d.ts` (terminal-settlement ordering). The receipt preserves each raw declaration and each raw SHA-256. The comparator permits only those exact paths and proves equality after sorting members of string-literal unions; every other byte must match. No exported type member or runtime behavior changes. Full raw-byte equivalence is therefore **not claimed** for mesh/gateway; this bounded type-equivalence exception is visible for receiving review, never discarded as package metadata.

The compiled profile, selected manifest and builtin are independently exercised from installed published bytes and the clean-built physical workspace. The whole workspace receipt is a package-resolution proof; the pruned canonical API/IdP/content image and image digest remain W3, with integrated authority/browser/production acceptance in W3/W5. Activation remains default-closed. Historical baseline, deployment and acceptance receipts are retained.

## Reproduction

Use `tmp/worktrees/app-w0d-refresh`; every runtime command takes the shared Docker lock. The existing pinned `docker-compose.immo-861.yml` qualification service runs without listeners, database, buckets or production credentials.

1. Run `make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-host-fit W0_HOST_PROBE=refresh-fit-probe.mjs W0_PROBE_PACKAGES='<exact pins above>' ENV=test-app-w0d`, prefixed by `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`.
2. Run the same locked make invocation with `-f docs/baselines/app-cm-w0/refresh.mk w0-refresh-workspace ENV=test-app-w0d`. It copies only source inputs into disposable storage, strict-installs, builds the package graph, packs the four leaves and runs both registry suites. `W0_REFRESH_EXPECT=red` reproduces the old-pin refusal at test commit `24dffd855` (before the lock/registry correction).
3. Run the same locked refresh make invocation with `w0-refresh-payload ENV=test-app-w0d`; it redownloads the exact archives, checks SRI and compares complete payloads.
4. `w0-refresh-record` serializes the complete evidence and tuple at the qualified source head. Machine receipts use compact JSON to preserve full trees and logs without truncated excerpts.
5. After each runtime step, run the same locked refresh invocation with `down ENV=test-app-w0d`; finish with `w0-refresh-ps ENV=test-app-w0d` and require an empty result. Do not touch another environment.
