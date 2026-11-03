# Feature: Artifact content host — single UUID label (no pinned form)

## Objective
Owner decision (relayed by immo): the `<id>.pinned.<base>` host form disappears. One wildcard per base; the single UUID label `<id>.<base>` is resolved server-side as an artifact (current release) or a release (frozen version). Unknown ids get a uniform 404. `parseContentHost` returns `{ kind: 'id', id }` for exactly one UUID label and nothing else.

## Scope / Guardrails
- Scope limited to `packages/artifacts`, `apps/artifact-content`, the artifacts API services/tests and the APP-P1 pin refresh.
- Make-only workflow, Docker-first, single Docker lock taken per command (`.tmp/packets/DOCKER-LOCK.md` via `flock`), `ENV=test-artifacts-host` always LAST, `make down ENV=test-artifacts-host` after.
- Tests on `ENV=test-artifacts-host` only, never `ENV=dev`.
- No `[skip ci]` in any commit; no legacy fallback — the old pinned form is removed, not kept alongside.
- English for code, comments, commits, docs.
- BRLOCK-EX1 acknowledgment (the lockfile-lane guard requires it on branches whose scope touches locks/container installs): the inherited CI-maintainers exemption under `.security/ci-lockfile-policy.json` stays owned and unexpired, review_by=2026-11-30T00:00:00Z; no renewal or scope expansion.
- Commits via `make commit MSG="..."` only, ≤150 lines, selective staging, `make scope-check` before every commit.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/**`
  - `apps/artifact-content/**`
  - `api/src/services/artifacts/reader-activation.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/artifacts-reader-activation.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `package-lock.json`
  - `api/package-lock.json`
  - `BRANCH.md`
  - `docs/runbooks/app-artifact-content-infrastructure.md` (BR01-EX4, docs-only review-r1 fix)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
  - `.github/**`
  - `spec/**`
  - `docs/**` (outside `packages/artifacts/**`)
  - `ui/**`, `e2e/**`, `api/drizzle/**`
  - every other deploy file (only the four BR01-EX1 conditional files above are exempted)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/overlays/preprod/artifact-content-ingress.yaml` (BR01-EX1)
  - `deploy/k8s/overlays/prod/artifact-content-ingress.yaml` (BR01-EX1)
  - `deploy/ci/artifact-content/routing.selftest.mjs` (BR01-EX1)
  - `deploy/ci/artifact-content/bundle.selftest.mjs` (BR01-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR01-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR01-EX3)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (BR01-EX3)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR01-EX1 (scope exception, `deploy/**`): paths `deploy/k8s/overlays/{preprod,prod}/artifact-content-ingress.yaml`, `deploy/ci/artifact-content/routing.selftest.mjs`, `deploy/ci/artifact-content/bundle.selftest.mjs`. Justification: the owner decision mandates ONE wildcard per base and no routing for `<id>.pinned.<base>`; the ingress currently installs a second `*.pinned.<base>` wildcard (TLS host + rule) in both tiers, and the CI selftests assert that two-wildcard shape plus the old `{kind:'stable'|'pinned'}` parse contract, so they would fail against the new parser. Impact: pinned-form hosts stop being routed at the edge (the content app already 404s them server-side); immo handles 301 redirects for its old hosts on its side. Rollback: revert the four files; no data, schema or API change.
- BR01-EX2 (lock pin): `make lock-root` refreshed the root lock's artifacts entry only (version 0.2.5→0.2.7 and the artifacts peer range `>=0.3.0 <0.5.0`→`>=0.4.1 <0.5.0`); the unrelated pre-existing staleness on main (mcp-platform 0.4.0→0.4.1, mcp-broker's `^0.4.0`→`^0.4.1`) was deliberately reverted so the root-lock diff carries only this branch's change — that also keeps the L5 P1 lock fingerprint (`tools/memory-mcp-l5`) byte-identical to main, so `memory-l5-verify` stays green without regenerating the P1 manifest. `make lock-api` ran clean on the test stack but npm `--package-lock-only` does not refresh `file:` link versions, so the single `"../packages/artifacts"` version line in `api/package-lock.json` was synced 0.2.5→0.2.7 directly — the same targeted one-line sync #878 did as BRP0B-EX1. No dependency graph change; rollback with the version fix.
- BR01-EX3 (cluster-mesh packaging fixture re-pin): the `validate-cluster-mesh` lanes run `tests/packaging/prepare-artifacts.spec.ts`, which requires the `selected` fixture to pin the workspace candidate version exactly (artifacts 0.2.7, not 0.2.6). Re-pinned `fixtures/selected/package.json` + `package-lock.json` (root dep, entry version/resolved/integrity) and the hardcoded archive integrity in `artifacts-tuple.spec.ts`. The integrity is the sha512 of the candidate tarball packed from this head via `make ci-package-candidate` (`sentropic-artifacts-0.2.7.tgz`, sha256 a523b9f687a1a191e1226585f6e716d99dd9c9649032d7c9d8e4fd822be29f8f), the same bytes CI's `package-candidates` job packs for the sibling receipts. All other fixture pins already match the workspace tuple, so only the artifacts entry changes. Rollback: revert the three files to the 0.2.6 pin.
- BR01-EX4 (scope exception, `docs/**`): path `docs/runbooks/app-artifact-content-infrastructure.md` only. Justification: review r1 (`.h2a/reviews/content-host_large4_r1.md`) found the runbook still documents the removed `*.pinned.<base>` wildcard as part of the live contract (DNS/TLS receipts table, "both SANs", "pinned depth"); the owner decision mandates ONE wildcard per base, so the runbook must match the shipped ingress overlays and the single-label parser. Impact: docs-only — no code, manifest, lock or spec touched; point-in-time records (`spec/**`, W0 baseline, governance study/kit) keep their historical pinned mentions. Rollback: revert the runbook file.
- pinnedUrl rename decision: renamed to `versionUrl` in the publicationUrls hook, summary, versions, source-read outputs and the result schema. The converged contract allows it: no consumer outside `packages/artifacts` references `pinnedUrl`/`stableUrl` (verified by grep over ui/contracts/e2e/api/cluster-mesh), and every in-package consumer is updated atomically in this branch. Recorded in CHANGELOG 0.2.7.
- Version: 0.2.7 (main 0.2.6, npm published 0.2.6). PR #890 (0.2.7) was still open at branch time; if it lands first, rebase on origin/main and bump to 0.2.8 (Post-Rebase Gate: package.json version > npm published version).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one package change with in-repo consumers; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/artifacts-content-host` on branch `feat/artifacts-content-host-single-label` from `origin/main`; `harness check branch` PASS.
  - [x] `BRANCH.md` created from `plan/BRANCH_TEMPLATE.md`.
  - [x] ENV mapping: `ENV=test-artifacts-host` for all make test/build commands, always last.
- [x] **Lot 1 — Tests first (RED)**
  - [x] `packages/artifacts/tests/content-routing.test.ts`: one UUID label → `{ kind: 'id', id }`; `<uuid>.pinned.<base>`, two labels, foreign base, non-UUID → undefined.
  - [x] `packages/artifacts/tests/content.e2e.test.ts`: stable id serves current release; release id serves frozen release; unknown id → uniform 404 (same body for unknown artifact vs unknown release, both store lookups run); old pinned form / two labels / foreign base do not route (404).
  - [x] `apps/artifact-content/tests/host.test.ts` + `runtime.test.ts`: single-label origins, activate binding by channel vs id, republish consent only on artifact-resolved id.
  - [x] `api/tests/api/artifacts-reader-activation.test.ts`: approvedOrigin/consumeForContentOrigin on `{ kind: 'id', id }`.
  - [x] URL-field tests: summary/versions/source-read/http parity fixtures use `versionUrl` with `https://<releaseId>.<base>/` values.
- [x] **Lot 2 — Implementation (GREEN)**
  - [x] `src/content/routing.ts`: `ContentOrigin = { kind: 'id'; id: string }`; only one UUID label routes.
  - [x] `src/content/handler.ts`: server-side artifact-or-release resolution through `publication.getCurrent`/`getRelease` (both always queried → uniform 404 timing class), channel derived from resolution, digest verification + deny rules kept.
  - [x] `src/http.ts:66` publicationUrls hook → `{ stableUrl, versionUrl }`; summary/versions/source-read/result-schema updated.
  - [x] `apps/artifact-content/src/host.ts` + `api/src/services/artifacts/reader-activation.ts` consumers.
  - [x] `packages/artifacts/README.md` routing bullets.
  - [x] Lot gate: `flock <lock> make test-artifacts SCOPE=... ENV=test-artifacts-host`, then full `make test-artifacts ENV=test-artifacts-host`; `make down ENV=test-artifacts-host`.
- [x] **Lot 2b — Edge manifests & CI selftests (BR01-EX1)**
  - [x] Drop the `*.pinned.<base>` wildcard (TLS host + rule) from prod and preprod artifact-content ingresses.
  - [x] `deploy/ci/artifact-content/routing.selftest.mjs`: assert `{ kind: 'id', id }` for one UUID label; pinned form and two labels denied.
  - [x] `deploy/ci/artifact-content/bundle.selftest.mjs`: single wildcard per base; TLS deny-case label renamed.
  - [x] `flock <lock> make test-artifact-content-manifests ENV=test-artifacts-host`.
- [x] **Lot 3 — Version bump, pins, APP-P1**
  - [x] `packages/artifacts/package.json` 0.2.7 + `ARTIFACTS_PROVIDER_VERSION` + CHANGELOG entry.
  - [x] `flock <lock> make lock-root ENV=test-artifacts-host`, `flock <lock> make lock-api ENV=test-artifacts-host` (workspace pins).
  - [x] Recompute APP-P1 manifest digest; update `api/src/services/mcp/cluster-registry.ts`, `app-mcp-registry.test.ts`, `app-mcp-installed.test.ts`.
  - [x] Re-verify version > `npm view @sentropic/artifacts version` (Post-Rebase Gate).
- [x] **Lot 4 — Final validation & PR**
  - [x] `make scope-check`; `make commit` per lot; push branch (crash safety).
  - [x] READY PR #893 (body from BRANCH.md, base main, not draft).
  - [x] CI run 1 = 41532326921 on head `155f6ca5c`: FAILURE, but all change-relevant lanes green (`validate-artifacts`, `typecheck-lint-api`, all `test-api-unit-integration`, all `test-e2e`, `smoke-idp-screens`, `enforce-package-bump`). Four root causes, all outside the artifacts code and fixed in the follow-up commit: (a) `validate-publishable-manifests` — lockfile-lane guard needs the BRLOCK-EX1 `review_by=2026-11-30T00:00:00Z` acknowledgment in BRANCH.md (added in Scope / Guardrails); (b) `validate-cluster-mesh` (source installed major, lazy stateful install) — `prepare-artifacts.spec.ts` requires the `selected` fixture to pin the 0.2.7 candidate (BR01-EX3 re-pin with the packed-candidate integrity); (c) `memory-l5-qualification` — the root-lock refresh had also synced main's pre-existing mcp-platform staleness, changing the P1 lock fingerprint (BR01-EX2: reverted, fingerprint re-verified equal to the committed manifest `2e050e2f…`); (d) `ci-gate` aggregate of the above.
  - [x] CI run 2 = 41537081159 on fix head `9a07ee7ce`: **SUCCESS** (105 jobs, 71 success, 0 failures; all run-1 failure lanes green: `validate-publishable-manifests`, `validate-cluster-mesh` x3, `memory-l5-qualification`, plus `ci-gate`, `validate-artifacts`, `typecheck-lint-api`, `package-candidates`). PR #893 head = `9a07ee7ce`, READY, not merged.
  - [x] Report to `.tmp/rv/artifacts-content-host.md`. Do not merge.
- [x] **Lot 5 — Docs fix (BR01-EX4, review r1)**: rewrite `docs/runbooks/app-artifact-content-infrastructure.md` to the single-label contract (one wildcard per base; the UUID label resolves to an artifact or a release; uniform 404 for unknown ids; pinned form removed); sweep repo docs for `.pinned.` mentions (only point-in-time records keep theirs: `spec/**`, W0 baseline, governance study/kit); `make scope-check` PASS; commit + push so PR #893 CI fires; `.tmp/rv/artifacts-content-host.md` "Fix review r1" appended. Do not merge.
