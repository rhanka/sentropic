# SPEC_STUDY — Ten-minute CI/CD, including E2E and delivery

Status: retained study and implementation plan; documentation only, 2026-10-18.
Evidence baseline: `441453966a4dfac12c220f154508d7ab1ee3c237`; documentation base: `9ed96eb83cd77da710f1adeb83a19e425d6c4910`.
Charter: qualify the complete selected CI/CD path within ten minutes, preserving tests, security, artifact identity, and visible delivery outcomes.

## 1. Decision and owner constraints

Retain the fresh nine-step plan: remove repeated preparation, reuse immutable artifacts, execute independent work concurrently, make PR/merge provider journeys deterministic, and qualify real providers daily. The previous acceleration experiment is superseded and supplies no implementation dependency. This PR changes documentation only; none of the proposed timing improvements has been measured as an implemented result.

The owner authorized committing, planning, and merging the documentation once green and reviewed. The author hands off an opened PR and does not merge it. Selected owner quotations remain verbatim:

> « écoute je suis en phase avec le plan proposé pour le CI/CD, je le veux commité / fusionné et planifié en branches stp »

> [Image #14] pour les tests e2e je crois qu'il va falloir commencer a mocker les llm et de mettre les tests vrais llm en mode genre daily au maximum

> le lot 1 d'accélération n'a pas été validé donc tu peux l'éradiquer. je veux un plan frais basé sur mes remaques. et je veux dans le diagramme a chaque étape du plan bien matérialiser les bénéfices de temps et toujours pouvoir cliquer les différents cas concernés.

> « aucun sens du design. les boutons sont à 2 km, t'as pas utilisé notre générateur de diagramme. Mets le bouton (DANS le diagramme) : avant/après, cas, événement, options de groupes »

## 2. Evidence and its limits

The validated source study inspected eight recent runs, with 666 first-attempt job records (460 successful, 202 skipped, four other conclusions), plus historical publisher records. Its 767 fetched records include carried-forward rerun copies; those are not independent executions. The inventory covers 66 job definitions and 84 expanded execution rows. These counts describe that pinned study, not a fresh audit of the documentation base.

| Quantity | Meaning |
| --- | --- |
| Measured job/step | Completion minus start in one identified run, attempt, and job; retain timestamp gaps and combined preparation spans. |
| Observed endpoint | Workflow creation to actual qualification, publication, or readiness; no earlier push timestamp was available. |
| Computed path | Dependency replay from identified examples, without queue time; mixed-source paths are not observed runs. |
| Budget to measure | Proposed future ceiling including setup and transfer; missing durations remain **to measure**, never zero. |

Selected anchors below are seconds. Main denotes [run 39113919235](https://github.com/rhanka/sentropic/actions/runs/39113919235), attempt 1; PR denotes [run 39124873217](https://github.com/rhanka/sentropic/actions/runs/39124873217), attempt 1. Every row preserves its own scope.

| Element | Measured example and job | Budget to measure | Main cause to address |
| --- | --- | --- | --- |
| API static | Main, [117635700362](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700362): 425 | 120 | Repeated workspace/image preparation; final compiler/linter spans below 8/7 seconds including transition. |
| UI static | PR, [117667798085](https://github.com/rhanka/sentropic/actions/runs/39124873217/job/117667798085): 144 | 90 | Development-container preparation; final Svelte check span about 17 seconds. |
| Cluster qualification | Main, [117635700549](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700549): 664 | 210 | Storage bundle 197, packed lazy qualification 159, repeated sibling builds. |
| Manifest qualification | Main, [117635700403](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700403): 125 | 75 plus explicit candidate branch | Packing and guard fixtures; this job does not publish packages. |
| API image | Main, [117635700627](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700627): 224 | 180 warm / 210 cold | Build 176 plus export and transport. |
| Full UI build | PR, [117667798508](https://github.com/rhanka/sentropic/actions/runs/39124873217/job/117667798508): 495 | 180 warm / 210 cold | Extensions, desktop, UI tests, image, and static profile serialized. |
| UI job in API case | Main, [117635700635](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700635): 138 | 120 warm / 150 cold | Different scope from the 495-second PR job; image action 107 seconds. |
| IdP screen smoke | Main, [117637085537](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117637085537): 222 | 150 | Browser action 6; image/tool transfer, loading, startup, and teardown dominate. |
| Browser E2E group A | Main, [117637085633](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117637085633): 255 | 180 per complete shard | Image retrieval and repeated global setup inside the 141-second Make test action. |
| Container scans | PR, [117669569949](https://github.com/rhanka/sentropic/actions/runs/39124873217/job/117669569949): 199 | 90 | Independent API/toolbox/UI scans plus image retrieval and loading. |
| API image publication | Main, [117640722484](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117640722484): 203 | 40 after candidate upload | Download/load 82; fresh layers 93; alias push 22. |
| Preproduction | Main, [117641371250](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117641371250): 116 | 75 | Real API readiness dominates the 101-second deploy action. |

The main example reached CI qualification at 26:13 and preproduction at 31:33, while `publish-artifacts` failed. Whole-workflow success came only after a manual rerun, at 155:31. Its product replay is 1,007 seconds execution plus 886 seconds dispatch/waiting, including an 877-second ready-to-start E2E wait. A green CI gate alone did not prove complete delivery.

Fresh npm publication with registry qualification measured 157 seconds for cluster-mesh ([39111568697, attempt 1, job 117631762729](https://github.com/rhanka/sentropic/actions/runs/39111568697/job/117631762729)) and 160 for MCP Auth ([38867522929, attempt 1, job 116870759442](https://github.com/rhanka/sentropic/actions/runs/38867522929/job/116870759442)). Version-already-present paths cannot stand in for these fresh-publication measurements.

## 3. Retained architecture

1. **Measure and reserve capacity.** Record the expected result set before dispatch and all four delivery endpoints. Cancel superseded PR attempts, preserve current main releases, and prove aggregate critical-path scheduling of at most 60 seconds under concurrent traffic. Approximately 24 workers was a study hypothesis; actual account capacity and cost remain to be checked.
2. **Prepare once, native checks behind Make.** Pin Node/npm and tools, prepare each dependency closure once, then run complete compiler/linter programs independently. API/UI/IdP static budgets are 120/90/90 seconds including cold preparation. Native CI targets are a declared exception to current Docker-first recipes, not permission to run arbitrary host commands or replace production-image checks.
3. **Build and transfer less.** Use persistent BuildKit caches scoped by runtime/tool/profile; remove UI forced cache bypass. Separate stable tooling from source-dependent payloads without removing source from correctness keys. Include candidate upload, export, and transport in the complete image-readiness budget. Verify source, lock, architecture, toolchain, build arguments, and embedded assets before reuse.
4. **Execute independent work together.** Browser, VSCode, IdP, restore, and scans start when their artifacts are ready; static/security results still join the required verdict before promotion. Split independent UI build/test/profile work; the image still waits for extensions/desktop files embedded in `ui/static`. Different Vite build inputs require distinct outputs.
5. **One candidate, independent qualification.** Build sibling closures and candidate tarballs once; share immutable bytes and receipts, never mutable workspaces/databases. Fan out source, PostgreSQL/comments, and installed-consumer checks. Preserve seed → crash → verify ordering, upgrades, lazy peers, public exports, and clean installs. The 210-second cluster budget is `60 + max(60, 90, 90, 30 + 120)`; the common manifest guard is 75 seconds, with candidate work visible on its own branch.
6. **Deterministic journeys, real providers daily.** Put HTTP/SSE fixtures at the external provider boundary while preserving browser/API/auth/database/queue/streaming/tool behavior. Assert requests and outputs; forbid unexpected provider egress and omit real credentials from PR/merge lanes. Deterministic AI failures block. Run one Playwright process and seed/auth setup per balanced shard; retain real login coverage and exact test membership. Replace arbitrary sleeps with observable conditions. Budget each browser/API shard at 180 seconds, VSCode/IdP at 150, including startup and teardown. Daily live qualification preserves provider assertions against an exact tuple, with schedule health, failures, calls, and cost separately visible.
7. **Deliver the tested bytes.** Every proposed publisher waits for the complete required verdict. Promote the exact tested/scanned image digest; candidate layer upload happens earlier inside the image budget. Publish qualified tarballs without repacking; retain registry visibility, provenance, integrity, collisions, and post-publication clean installs. Keep actual new-version mesh → gateway → cluster dependencies, budgeting 195 seconds for that internal train. Deploy changed UI with unchanged API digest when appropriate; keep preproduction readiness and all selected package receipts distinct.
8. **Remove consumer work only with proof.** Start with comments → API, then cluster-mesh → API/IdP/gateway. Qualify candidate bytes before consumer-owned contracts; prove unchanged installed application tuples and Docker input digests before skipping integration/deployment. A semver range or unchanged manifest is insufficient because workspaces and `file:` dependencies resolve source. Breaking, unknown, adopted upgrades, lock/runtime/security changes, or absent evidence select full deterministic integration. Fill validation gaps before allowing affected boundaries onto a fast path; 95% avoidance is an adoption target, not an observed rate.
9. **Prove the maximum and present.** Run the acceptance campaign below, retain every breach, and publish the measured distribution. Maintain one generated interactive graph with controls inside it; a plan click highlights changed nodes and keeps case/event choices usable.

The inspected consumer graph contains 39 library roots plus API, UI, IdP, and gateway hosts: 43 components and 73 deduplicated directed edges. Edges distinguish build/type dependencies, runtime peers, application source coupling, protocols, and embedded assets. Lexical imports do not prove every dynamic edge. Eighteen libraries lacked dedicated validation jobs, the gateway host lacked its own lane, `validate-chat-core` omitted its runtime script, and `ubo-contracts` delegated tests to API integration. Re-inventory at implementation time and count added qualification work.

## 4. Complete path budgets, not measured outcomes

For the selected API-change merge case, the retained **budget to measure** is:

```text
classification 15
  -> parallel: static 120; cluster 210; common guard 75;
               image readiness 180 warm / 210 cold, then tests at most 180
  -> complete verdict 5 -> image promotions 40 -> preproduction readiness 75
  + cumulative critical-path scheduling allowance 60
  = 555 seconds warm / 585 seconds cold
```

The endpoints are PR qualification, selected images published, preproduction ready, and selected package publications qualified. Complete merge elapsed is their maximum, including actual queue/dispatch delays. Daily provider work has its own endpoint and is never counted as zero work or hidden inside merge timing. Package-only paths have no artificial image cold penalty.

The 555/585-second figures apply to the selected API/CD path, not every combination of changed packages. Calculate each selection from the same dependency model used for rendering. A selected fresh package train must wait for the full verdict; it cannot start early merely to fit the headline. Mixed application/package selections need their own maximum and breach accounting. If rollout remains at 116 seconds, the API cold budget becomes 626 seconds and fails the ten-minute target.

The UI merge case includes UI image publication and preproduction while preserving the API digest. The shared `AuthProviderGlyph` case selects auth-ui qualification/publication, UI and embedded IdP consumer checks, both images, and preproduction. Skipping deployment for compatible library-only changes is a future conditional policy, not a description of current main.

Isolated transformation gains are not additive: several steps share preparation savings. Distinguish isolated proposed effect, dependency-wait removal, queue allowance, and the complete nine-step budget. Missing, failed, cancelled, or unexpectedly skipped required results block promotion.

## 5. Branch train index

These are planned branches, not branches already created. File numbers 62–70 preserve the requested document sequence after 61; they are not branch identifiers. This train uses canonical IDs **BR-76 through BR-84**, mapped below. Existing allocations and reservations in [PLAN.md](../PLAN.md) and [track/TRACK.md](../track/TRACK.md), plus BR-75 Muse enrollment in [the gateway routing spec](SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md), remain assigned to their existing work. BR-76–84 were unused in the checkout's tracked Markdown and Track state when this mapping was selected. Each branch starts from main after its predecessor is merged; the explicit chain serializes shared workflow/Makefile ownership. Technical prerequisites remain distinct from merge ordering.

| Order / file sequence | Plan (canonical branch ID) and branch | Dependencies | Budget to measure / acceptance focus |
| --- | --- | --- | --- |
| 1 / 62 | [BR-76](../plan/62-BRANCH_chore-ci-capacity-metrics.md) — `chore/ci-capacity-metrics` | This documentation PR | Complete results; aggregate critical-path queue ≤60s under contention. |
| 2 / 63 | [BR-77](../plan/63-BRANCH_perf-ci-native-checks.md) — `perf/ci-native-checks` | BR-76 | API/UI/IdP static ≤120/90/90s, cold preparation included. |
| 3 / 64 | [BR-78](../plan/64-BRANCH_perf-ci-image-artifacts.md) — `perf/ci-image-artifacts` | BR-77; metrics from BR-76 | Longest complete image branch ≤180s warm / 210s cold; exact digest. |
| 4 / 65 | [BR-79](../plan/65-BRANCH_perf-ci-parallel-dag.md) — `perf/ci-parallel-dag` | BR-78; verdict from BR-76 | Early runtime dispatch; scans ≤90s; all required results preserved. |
| 5 / 66 | [BR-80](../plan/66-BRANCH_perf-ci-package-candidates.md) — `perf/ci-package-candidates` | BR-79 for train order; BR-77 preparation and BR-78 receipts | Cluster ≤210s; common guard ≤75s; original assertions retained. |
| 6 / 67 | [BR-81](../plan/67-BRANCH_test-ci-deterministic-journeys.md) — `test/ci-deterministic-journeys` | BR-80 for train order; BR-79 scheduling and BR-78 images | Browser/API shards ≤180s; no unexpected live calls; daily live results visible. |
| 7 / 68 | [BR-82](../plan/68-BRANCH_perf-cd-tested-artifacts.md) — `perf/cd-tested-artifacts` | BR-78, BR-79, BR-80, BR-81 | Promotions ≤40s; preprod ≤75s; selected fresh npm train ≤195s. |
| 8 / 69 | [BR-83](../plan/69-BRANCH_feat-ci-consumer-contracts.md) — `feat/ci-consumer-contracts` | BR-82; BR-80 candidates and BR-81 blocking integration | Unchanged installed tuple/digest proven before consumer work is omitted. |
| 9 / 70 | [BR-84](../plan/70-BRANCH_test-ci-ten-minute-proof.md) — `test/ci-ten-minute-proof` | BR-76 through BR-83 | ≥30 complete full-product runs; publish distribution and every breach. |

Each file follows [BRANCH_TEMPLATE](../plan/BRANCH_TEMPLATE.md), with exact initial file ownership, tests, scope exceptions, measured acceptance, rollback, and isolated environment/port assignment. New script/fixture names in those plans are implementation deliverables, not claims that files already exist. Before dispatch, the conductor registers the canonical IDs above in the execution `PLAN.md` and imports the plans into Track with those identities under that operation's scope; filename sequence numbers must not become branch IDs. Environments keep their unique branch slugs; port slots use the canonical numeric IDs (76–84) with the workflow formula. This documentation PR does not mutate either shared state.

## 6. Acceptance and rollback

Record immutable source SHA, workflow revision, run/attempt/job IDs, runner class, artifact digests, installed package tuple, cache profile, job/step timestamps, expected/executed test identities, retries, runner-minutes, and provider calls/cost. Separate install, sibling build, image build/export, transfer/load, startup, seed/auth, tests, teardown, registry visibility, rollout, and dispatch spans. Retain combined cells until instrumentation actually measures their subdivision.

The final campaign requires at least 30 complete full-product runs across warm caches, source-cache misses, dependency-lock misses, full cache loss, and competing PR/main traffic. Sample API-only, UI-only, mixed application/package, compatible/additive/breaking library, explicit upgrade, tooling/lock, and relevant infrastructure changes; package-only cases supplement rather than replace full-product samples. Include actual fresh-version publication. Publish sample counts per profile/case, median, p90, p95, maximum, all incomplete/failed attempts, and each threshold breach. A ten-minute timeout is a failed unfinished release, not a successful latency sample.

Negative checks must reject missing/cancelled/skipped results, incomplete matrix membership, wrong SHA/hash, absent required siblings, stale/untrusted caches, unexpected provider traffic, and contract/tuple ambiguity. Preserve served IdP pages and form redirects, real runtime smoke/limits/restore, PostgreSQL crash/upgrade qualification, and registry provenance. A sample maximum establishes the observed campaign result, not a guarantee during unlimited provider/runner/registry outages.

Rollback each transformation independently while preserving result completeness, coverage, and artifact identity. Restore prior scheduling/native/cache recipes when their replacement fails; never keep dual active implementations as a workaround. Disable a failing consumer fast path by returning its boundary to full deterministic integration. Restore the previous qualified immutable deployment tuple when a release fails; npm releases require a new corrective version rather than overwriting published bytes.

## 7. Presentation contract

Use the existing diagram generator and design-system theme for one layered CI/CD graph. Put **before/after, case, event, and grouping controls inside the canvas**, with stable workflow job/step identifiers and viewport. Select internal compatible fix, additive change, breaking/upgrade, API, UI, tooling/lock, and the shared asset case in that graph. Events distinguish PR, merge with CD, and daily live providers. A selected plan step highlights changed jobs and shows its isolated effect; cases remain clickable. Expanded matrices preserve internal dependencies and their critical path, including the 195-second publication train.

The heatmap expands job → step and separates setup/install/build/transfer/execute/publish/queue. Show elapsed or runner-seconds, numeric values, semantic colors, and bins ≤15s, 16–60s, 61–180s, >180s. Missing measurements display **to measure**, with a pattern; proposed values display **budget to measure**. Every sampled job/step over 60 seconds needs an optimization, source, and acceptance reference. Render and compute from the same graph; never sum unrelated example jobs into a measured run or add isolated savings together.

The validated portable dossier is the presentation reference. Its controls check and Sol GO r3 are source-validation records supplied with the handoff; they do not attest review or CI of the new documentation commits. BR-84 owns the later measured evidence and presentation refresh.

## 8. Source provenance and reconciliation

The validated working bundle is `/home/antoinefa/src/sentropic/.tmp/focus-ci-efficiency-kit/`; it is not a repository dependency or a committed performance artifact. This study preserves the retained decisions and stable GitHub evidence links so implementation does not depend solely on that local bundle.

| Source in that bundle | Role |
| --- | --- |
| `ci-optimization-implementation-plan.md` | Retained nine-step plan, titled “Plan frais CI/CD — dix minutes maximum, e2e inclus”; SHA-256 `426bb0663d9a9ca4df2ee9030603f00a93a362a003da80e34c729143a55bc820`. |
| `strategy-v3-astra.md` | Measured study, job/step inventory, dependency graph, and proposed budgets at the evidence baseline. |
| `strategy-v3-reconciliation.md` | Governing corrections: superseded experiment removed; main/PR scopes distinguished; all proposed publishers wait for the verdict; scenario and cache profiles drive one graph. |
| `owner-feedback-v3/OWNER-FEEDBACK-V3.md` | Verbatim requirements and later additions; later owner feedback overrides earlier study recommendations. |
| `dist/ci-cd-sentropic-portable.html` | Validated interactive dossier, including controls inside the diagram and linked plan steps. |

The [pinned workflow](https://github.com/rhanka/sentropic/blob/441453966a4dfac12c220f154508d7ab1ee3c237/.github/workflows/ci.yml) and [Makefile](https://github.com/rhanka/sentropic/blob/441453966a4dfac12c220f154508d7ab1ee3c237/Makefile) govern historical interpretation. Every implementation branch rechecks the then-current files before changing them. The current-main 138-second UI example replaces the earlier 129-second label; the 495-second UI and 199-second scan examples belong to the broad PR. Historical publisher runs remain historical. No unmeasured cold branch, skipped test, or already-published version receives an invented duration or success credit.

## Artifact storage — transport lifetime correction (2026-10-29)

The account audit measured sentropic at 97–99.7% of Actions storage:
7,717 active artifacts / **4,017 GB**, including 3,566 Docker-image artifacts
/ **4,008 GB** and 36 desktop-download artifacts / **2.5 GB**. After BR-78,
the observed partial-day rate projects to roughly **130 GB/day**. These are
audit observations/projections, not measurements of this retention change.
During authoring on 2026-10-29, a fresh paginated read of
`GET repos/rhanka/sentropic/actions/artifacts?per_page=100` found 6,876
artifacts / **2,714,981,013,935 bytes** (2,714.98 decimal GB), including
2,711 allowlisted transport artifacts / **2,708,424,252,935 bytes**. The
branch's first CI run was still queued: this stock decrease cannot be
attributed to this branch. Pagination is a live snapshot, not an atomic
inventory. The repository artifact/log-retention GET still reports 90 days.
Source: `artifacts-audit.md`, 2026-10-29, retained with paginated API and daily
billing data in the supplied `ci-study` audit bundle; the audit's original
local path is `/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-poc-k8s/fc703350-bfba-4a32-97bf-ce7041335aba/scratchpad/ci-study/artifacts-audit.md`.

`fix/ci-artifact-retention` changes only the five transport uploads to
`retention-days: 1`, replacing their inherited 90-day lifetime. The final
`ci-gate` also waits for `delete-transport-artifacts`, which waits for every
consumer through `ci-capacity-receipts`, including image publication and
preproduction deployment, plus independent validators and train verification.
Its sole step paginates the current attempt's jobs
and preserves artifacts if any job failed or was cancelled, allowing selective
reruns within the one-day retention window. Otherwise, it paginates **this run's**
artifacts and deletes only the five exact names below. Only the deletion job receives
`actions: write`; workflow defaults and `ci-gate` stay read-only. Fork
PRs retain one-day expiry because their token is read-only. Cancellation
before cleanup also falls back to expiry. API failures fail the cleanup step;
the existing required-result verdict and all gates remain enforced.

| Transport artifact | Consumers completed before cleanup |
| --- | --- |
| api-image | API test matrix, browser E2E, VSCode E2E, IdP screen smoke, restore smoke, API scan, API image publisher |
| api-tool-image | API test matrix, IdP screen smoke, restore smoke, toolbox scan |
| ui-image | Browser E2E, VSCode E2E, UI scan, UI image publisher |
| e2e-image | Browser E2E, VSCode E2E, IdP screen smoke, browser-image scan |
| desktop-download | Container UI build and static UI build (including Pages upload) |

Every download uses the default current run; no cross-run consumer requires
keeping these five artifacts. `deploy-preprod` checks immutable registry
tags and deploys from the registry; it does not fetch an earlier run's Actions
artifacts. Package publishers use their source/registry flow. Package-candidate,
qualification, security, capacity and Pages artifacts are outside the delete
allowlist. Failed, cancelled and fork runs keep transport artifacts for at most
one day; successful runs delete them after consumers finish.

Stock after deployment is **not yet measured**: changing upload retention does
not shorten existing artifacts' expiry. This branch does not delete historical
stock or change repository-level artifact/log retention. At the observed rate,
one-day fallback bounds new transport stock to about 130 GB; successful cleanup
removes it after consumers finish. Neither figure is a measured account-stock
reduction. Retain exact-head CI and run-artifact API results with the PR before
claiming the cleanup works in GitHub Actions.

Coordination: open PR #829 (BR-80) changes package-candidate wiring in the same
workflow. Preserve its jobs, needs and candidate artifacts; the retention diff
is confined to the five upload inputs, deletion job and final gate. This section is
separate from BR-80's appended implementation receipts to reduce rebase overlap.
Rollback: revert the deletion job, its gate dependency, and the five
retention inputs together; restore no other workflow policy.

## 9. BR-76 implementation receipts

BR-76 added `scripts/ci/ci-run-metrics.mjs` (durations from identified
run/attempt/job timestamps; carried-forward rerun copies deduplicated),
`scripts/ci/ci-expected-results.mjs` (required-result membership verdict),
`spec/ci-cd-ten-minutes/capacity.md` (quota, reservation, cost, and peak
demand inventory), and workflow receipts (PR-only cancellation, a retained
before-dispatch expected manifest, and identified job/step captures). Verified against Main run `39113919235`
attempt 1: 84 captured rows equal the 84 expanded execution rows; max span
664s equals the cluster anchor; executed concurrency peak 17 (half-open
intervals, skipped and zero-duration rows excluded; the inclusive count that
kept them read 18). Reconciled receipts: 59 execution queue waits, p50 63s max
972s, runner-minutes 148.25, delivery elapsed per endpoint (api-image 1775s,
preprod 1893s, cluster-mesh 1392s, llm-mesh 737s; images partial because
`publish-ui-image` was skipped), 20 observed matrix member names, cache
identities to-measure. Attempts 1+2 hold 168 input rows; 58
carried-forward copies dropped, 110 retained rows (60 measured executions,
50 skipped rows). Remaining gaps: account quota, reservation,
registry cost, contention budgets, rollback drill, and concurrent PR/main
behavior.

Round-2 corrections exclude skipped rows from runner queues and delivery
timings, preserve absent readiness as null, and emit per-job/per-step spans
through Make. The live gate reconciles the actual selected matrix set and
unconditional validators with fresh attempt receipts; carried-forward
classification retains its original expected-manifest attempt. Account
inventory access remains unavailable (billing HTTP 404, missing `user`
scope), so finite-capacity and contention acceptance remains open.

## 10. BR-77 capacity-policy implementation

The 2026-10-26 execution packet assigns BR-77 to
`plan/71-BRANCH_chore-ci-capacity-policy.md`, continuing the Lot 2/3 split
from #705. Review r1 removes the 13/10-deep package validation chains:
23 independent validators share six queued execution mutexes. All common
jobs share 15 repository-wide mutexes, with two existing release groups
outside that pool; PR/main demand is bounded by 15/17. API/E2E return to
reference widths 15/5. Timing acceptance requires completed PR and main
runs of the final policy, each <=2288s; static width alone never qualifies.
Account quota and billed cost remain unknown. PR-only cancellation and
all existing completeness/publication barriers remain. Ordinary publishers
regain independence; explicit branch dry-run mode exercises their real packs.

Completed replacement PR `40402395319` succeeded but took 18224s, with
17227s of critical-path scheduling. The strict 2288s proof rejects it;
timing acceptance remains open and no actual main receipt of this policy exists.
Branch dry-run `40408883195` subsequently completed successfully in 20986s:
all 21 real guarded packs and skipped registry writers have verified receipts.
This qualifies publication wiring, while PR/main timing acceptance stays open.

[Capacity receipts](ci-cd-ten-minutes/capacity.md) identify the current-base
baseline, concurrent main rerun, obsolete PR and live conservative rollback.
The old rollback used one validation lane and widths 1/1 without deleting
expected-result or metrics checks, but run 40353670942 was cancelled:
the rollback drill remains unticked until a completed receipt exists.
Classification and verdict breaches remain visible. Completed concurrent
delivery and the 60-second aggregate scheduling budget require post-run
captures, not an inference from green fixtures or a maximum queue sample.

The next branch consumes the retained dependency manifest, bounded DAG,
Make capture/combined-traffic entry points and unresolved timing receipts.
The train index above preserves the original #701 allocation: plan/63 still
calls native checks BR-77 while the owner packet names capacity BR-77 and
the next branch BR-78. The conductor must reconcile that allocation before
launching the successor; this branch does not edit the other branch plans.

## 11. BR-78 image artifacts — qualification in progress

The 2026-10-28 owner packet assigns BR-78 to plan/64 after BR-77 merge
`aa559f58c57d0453239668505ccfeaebe5599a1e`. It requests merge-only updates,
worktree `tmp/worktrees/ci-br78`, and a draft PR; it does not close BR-77's
outstanding strict PR/main timing acceptance.

The actual first main-push run after BR-77 is [40576115790](https://github.com/rhanka/sentropic/actions/runs/40576115790),
attempt 1, source `aa559f58c57d0453239668505ccfeaebe5599a1e`, successful in
1903s (created_at to updated_at). BR-76 capture records 89 jobs, 64 measured
executions / 25 skips, 233.9 runner-minutes, queue p50 94s / maximum 445s.
This main receipt alone does not supply the required same-policy PR proof.

| Baseline job | Job ID | Complete job seconds | Scope |
| --- | --- | --- | --- |
| build-api-image | 122443114522 | 109 | Canonical resolver, runtime checks, export and upload |
| build-api-tool-image | 122443114250 | 262 | Cache miss; build, export, upload and cache save |
| build-ui | 122443114508 | 533 | Full UI, embedded prerequisites, tests and static profile |
| build-e2e | 122443112221 | 30 | Existing registry image; build skipped, not a cold measurement |
| security-container | 122449269994 | 263 | API/toolbox/UI transport and existing scans |
| test-smoke-restore | 122445831064 | 241 | Production image/toolbox transport, backup, restore and smoke |

BR-78 adds independent BuildKit layer scopes, stable npm/esbuild tool layers,
compressed credential-free artifacts and run/source/tree/workflow/profile receipts.
Consumers hash archives before load and compare the loaded Docker image config
SHA-256 afterwards; these are image IDs, not registry manifest digests.
Chrome/VSCode output assertions move into each UI profile's existing build;
the IdP screen assertions use the qualified E2E browser instead of embedding
Chromium in every non-browser API toolbox. ci-gate and publisher barriers remain.

Initial PR [40635754181](https://github.com/rhanka/sentropic/actions/runs/40635754181),
attempt 1, head `13a188569`, was superseded/cancelled: API 260s and E2E 201s
are cancelled partial executions; toolbox/UI lack measured execution spans.
No successful image-readiness sample is credited to that run.
Cold dispatch [40636446215](https://github.com/rhanka/sentropic/actions/runs/40636446215),
attempt 1, head `a4d98dcde`, produced E2E successfully in 151s
(job 122644590256; build/export/compression 127s, upload 5s, queue 42s).
Its manifest-wiring job 122644590282 failed on the prior blanket scripts/ci
filter assertion; BR78-EX4 retains isolation except for the two exact image guards.
Remaining producer/consumer durations, exact-head warm/cold acceptance,
input-invalidation and rollback proof remain **to measure**.

The following measurements qualify the implementation at head `13712a5d2`,
before the later base-digest pins and IdP loopback correction. PR checkout
source is `cb85e39ed2e7b08ae8caa269d0de51597c07ac41` (the PR merge commit),
workflow SHA-256 `33873b096f9a17742370cfe0fa86bc2b044f7ee2d3cd33c4d249bad4cc6dda74`.
Normal run [40640414275](https://github.com/rhanka/sentropic/actions/runs/40640414275),
attempt 1, imported/populated caches; it is **not a fully warm sample**.
Forced cold rebuild [40640411046](https://github.com/rhanka/sentropic/actions/runs/40640411046),
attempt 1, disables external cache import/export and uses --no-cache;
its budget does not include first-population cache uploads.

| Producer | Normal job / seconds | Forced cold job / seconds |
| --- | --- | --- |
| API | 122657597114 / 230 | 122658342949 / 234 |
| Toolbox | 122657597557 / 258 | 122658342919 / 200 |
| UI, complete job | 122657597564 / 398 | 122658342944 / 380 |
| E2E | 122657596849 / 248 | 122658342138 / 149 |

These results **do not meet BR-78 timing acceptance**. Normal E2E spends 76.5s
exporting cache; normal UI still contains 30s desktop, 149s image build, 87s
UI qualification and 100s static profile. The latter two remain blocking;
BR-79 owns their independent scheduling. API-case UI and a fully warm sample
remain to measure; the full UI job is never substituted for the API case.

GitHub artifact sizes at this head: API 217,041,045 bytes versus BR77's
1,869,666,158; toolbox 400,395,762 versus 2,719,976,086; UI 109,800,331 versus
105,605,942; E2E 774,218,936 (no corresponding BR77 artifact: registry reuse).
The fresh API/toolbox stages transport prepared filesystems without hidden
download-cache/deleted dependency layers. Plain archive compression is zstd;
image config digests remain distinct from archive and GitHub ZIP digests.

Verified producer/restore tuple, normal run 40640414275 attempt 1:

| Image | Docker config SHA-256 | Archive SHA-256 |
| --- | --- | --- |
| API | `6cc2575664a3b227518497ec046c00ad39abf43d10285e7417bfee2b24ed78b0` | `23941fd796b4cafb39d458fb7dff0422835f1691e977612a1f07be98dc0c8236` |
| Toolbox | `81651306ddd91ba410783acd35c6d2c5b26d171ea5c790168bbfea4b8a9ec6c2` | `c5c7d558291cdd6be78518cdfa3d18905efbec98abed36f59fa76a1c4b09cfeb` |
| UI | `5eedd2d8e54923167d7ead45a9a32f80d4ebc9c734fc068653e664b67e20766c` | `9548c0676d88ea810357121495f0601ca492b6bca036f1e67775b4244d326e31` |
| E2E | `670ba073a8dc9f2ee8aee3eead69360ed72d284d35b3b92062394e9ec14484e4` | `390d94b9cd7afaddd07d50397c626347f593d69a77c40187a28c82edefe5b565` |

Restore job 122659204773 passes in 158s and verifies the exact API/toolbox
tuple before and after load; container scan 122660115540 passes in 134s.
IdP 122660292811 fails on HTTPS-upgraded subresources under the new browser;
its existing screen assertions keep ci-gate 122663280154 red. The correction
uses the qualified E2E browser in the IdP network namespace at a loopback
test origin, with production CSP/HSTS and startup health waits retained.
That correction requires fresh CI; no IdP acceptance is claimed here.

Rejected experiment: native Docker/containerd producers at head `43ce8700d`
were rolled back when restore 122655378122 and API consumer 122655438883
rejected their loaded identities. No digest check was relaxed. Normal toolbox
340s includes 114.1s cache export. Cold llm-gateway 122651928831 also fails a
120s clean-npm-install timeout; same-head PR validator 122651425217 passes.
All superseded PRs (40635754181, 40636281967, 40636804356, 40637033882,
40637537467, 40637927472, 40638269271) and pending dispatch 40637534902 retain
their cancelled/failed statuses and partial durations in the run records.

At head `9d7c58cab`, [40643738039](https://github.com/rhanka/sentropic/actions/runs/40643738039)
attempt 1 completes successfully in 1313s, including ci-gate 122674614619.
All selected API/UI/browser/VSCode/static/security/restore results pass.
Image jobs are API 287s (122667727218), toolbox 209s (122667727115),
full UI 400s (122667727048), E2E 109s (122667726528). These are identified
cache-enabled executions, not an accepted warm/cold performance campaign.
IdP 122671543007 succeeds in 220s: discovery, served login and consent,
authorization code, id_token iss/aud/nonce/sub and userinfo remain asserted.
Its qualified full Chromium joins the SUT network namespace and uses a CI-only
loopback public origin; production CSP/HSTS, NODE_ENV and health waits remain.

The following coverage addition must qualify on a fresh head: security-container
also waits for build-e2e, verifies its receipt and applies the existing blocking
HIGH/CRITICAL scan/compliance gate to the browser artifact. This preserves the
browser coverage formerly provided by the larger API toolbox. Existing scans,
ci-gate membership and publication/restore barriers remain enforced; no register
exception, scanner threshold, assertion or timeout is relaxed.

### BR-78 continuation: browser remediation and UI timing

The initial browser-covered head `7b62ad02a` fails the existing HIGH/CRITICAL
gate: PR [40646332385](https://github.com/rhanka/sentropic/actions/runs/40646332385)
attempt 1, scan 122678494699, refuses 102 findings. Cold dispatch
[40646328430](https://github.com/rhanka/sentropic/actions/runs/40646328430)
also fails that gate. The earlier green `9d7c58cab` does not qualify this coverage.

| Producer / consumer | 7b62 PR job / seconds | 7b62 cold job / seconds |
| --- | --- | --- |
| API | 122676009845 / 80 | 122676032511 / 246 |
| Toolbox | 122676009646 / 87 | 122676032393 / 233 |
| Full UI | 122676009766 / 421 | 122676032501 / 505 |
| Browser | 122676009049 / 97 | 122676031311 / 164 |
| Container gate | 122678494699 / 183, failure | 122680288141 / 329, failure |
| Restore | 122677167776 / 168 | 122679853836 / 175 |
| ci-gate | 122682967025 / 28, failure | 122688318784 / 18, failure |

Rejected Trixie candidate `57c5d03fe`, run
[40652025952](https://github.com/rhanka/sentropic/actions/runs/40652025952)
attempt 1, fails with 57 OS findings lacking a Debian FixedVersion (scan
122698285457 / 195s); bundled npm is clean. API/tools/UI/browser/restore jobs
122694620184/122694620317/122694620385/122694619748/122696016656 take
87/89/424/343/171s; ci-gate 122701111297 fails in 18s. No exception was added.

The replacement uses pinned Node 24/Alpine 3.24, native Chromium and headless
shell `155.0.8059.84-r0`, and FFmpeg `8.1.3-r0`. It omits unused engines/Xvfb,
flattens the prepared filesystem while retaining apk scanner metadata, and
registers the native executables through the locked Playwright registry.
Build probes assert both engines' DOM title, screenshot and nonempty video.
At `8bfd472f7`, job 122704840141 passes these probes; its browser artifact is
517,331,610 bytes versus 774,218,936 bytes at `7b62ad02a`. First cache export
still takes 178.8s; this is not a fully warm timing sample.

Run [40655027953](https://github.com/rhanka/sentropic/actions/runs/40655027953)
attempt 1 is superseded/cancelled after scan 122708320165 / 175s refuses two
instances of CVE-2026-14456 in inherited libcrypto3/libssl3 3.5.7-r0.
Trivy's fixed version is 3.5.8-r0; the live Alpine index provides 3.5.9-r0,
which the Dockerfile now explicitly requires. API/tools/UI/browser/restore
jobs 122704841279/122704841426/122704841128/122704840141/122706494384 take
78/85/418/310/180s. ci-gate 122710829111 fails in 19s. The patched candidate
requires fresh qualification; no register or severity change accepts either CVE.
Patched producer 122711504732 at `c8d6fd2cc` explicitly upgrades both libraries
to 3.5.9-r0 and passes the two browser probes; its compressed artifact is
517,286,222 bytes. Only a completed exact-head scan/journey run can qualify it.

The unchanged 83-file / 489-test UI suite now executes inside BuildKit with
`--no-cache-filter=ui-tests`, rather than exporting/loading a development
image. Test-step time falls from 87s to 37s (38s on the first candidate).
Both profile builds and their embedded-output assertions remain blocking.
Source COPY excludes API/browser changes and desktop packaging staging files.

Identified cold UI job 122707557109, run
[40656087209](https://github.com/rhanka/sentropic/actions/runs/40656087209)
attempt 1 at `8bfd472f7`, completes in **329s**, versus the earlier 505s.
It includes desktop 28s, production image 113s, fresh tests 36s, static profile
106s, plus setup/save/uploads/cleanup. Browser 122707555892 takes 124s;
API/toolbox 122707557086/122707557180 take 237/231s. These completed producer
measurements do not qualify the old browser's security or meet 210s.

**The full UI timing budget remains unmet.** Even its two cold build steps
alone total 219s, before fresh tests, desktop packaging or transfer. In the
cache-enabled 418s UI job, the builds take 180/133s, including 37.5/59.4s
cache exports; production also spends 51.8s materializing cached dependencies.
Independent scheduling belongs to BR-79; removing either profile/test is forbidden.

There is also a measured warm-cache blocker: runs 40652025952 and 40655027953
use the same main base `ea20bd9c026e9717d911514e763f8911b6981dde` and identical
tracked UI/desktop/package sources, but their published `cowork.exe` SHA-256s
are `647f409155cf930fdd6c326486c1128cb26162ed0f56dd3932e56e069a685568`
and `6a6240346f31a27b962d15b47af1feefc9040a92b444ab1e8efa119007df5445`.
Their metadata SHA-256 is identical:
`fd1ad5eb2b08cef0841a7860b112a9c417c750caf406aef5792ee46cd47f75e3`.
Consequently `COPY ui` misses and both profiles recompile despite unchanged
tracked sources. The packager resolves native dependency ranges and emits pkg
bytecode; this evidence establishes unstable output, not which mechanism causes it.
The final image boundary excludes desktop bytes from the compiler's source COPY
using a digest-pinned Dockerfile 1.19 frontend. A separate static-assets stage
validates present desktop files and copies the fresh bytes into both production
and static outputs after compilation. A build assertion rejects the executable
inside compiler inputs. This preserves existing API-only/local optional-desktop
behavior and the full-UI desktop prerequisite, without changing the Windows
packager/runtime. New complete warm/cold receipts must qualify this isolation;
the measurements above precede it and do not establish 180/210s acceptance.

Superseded continuation runs 40651336571, 40651731668, 40654285195 and
40657002180 remain cancelled. Dispatch 40654322669 is cancelled after browser
job 122701728553 fails in 39s on a removed Playwright internal import; the
locked package's exported coreBundle registry replaces it. Cancelled/unstarted
jobs are not timing passes. Full run/job/step JSON and per-job TSV receipts are
retained under `.tmp/ci-br78/receipts/<run-id>/` in the owner workspace; container
uploads now explicitly retain their hidden `.security` report files.
Final exact-head run/job/step receipts are generated after completion, alongside
the workflow's `ci-capacity-<run-id>-<attempt>` artifact. They identify the actual
head and checkout source separately; a documentation commit never inherits a
green verdict from the prior head.

At `213154c8a`, scan 122724595128 in run 40660088690 succeeds with **zero
HIGH/CRITICAL browser findings**, without a register change. UI 122721657507
takes 366s on the first isolated-asset cache population; all 489 unit tests pass.
Direct archive inspection verifies identical fresh desktop bytes in production
and static output (`7fddf56e1ede19ffc9cb125f871eb2a0c76edfaa42f2537402307028f36e2aab`)
and nonempty Chrome/VSCode downloads in both profiles. The full run is still
blocked by group-e 122724595102: the comment journey requests its seeded folder
under an unrelated workspace and gets 404 before any AI assertion.
BR78-EX5 moves its workspace initialization before application startup; no
assertion, membership, retry or timeout is relaxed. A fresh exact-head full run
must qualify that setup correction and measure reuse of both compiler profiles.

At `8f9cf1d9b`, UI 122735162130 in run 40664255786 completes in 296s:
production 25s (compiled layer cached), fresh tests 68s, static profile 142s,
desktop 28s. The test target lacked an external parent-cache import and reran
npm ci in 28.7s; the subsequent static profile rebuilt in 69.7s and exported
cache for 70.5s. The correction imports the producer's parent UI cache into
the test build while still forcing `ui-tests` execution and exporting no test
result cache. Cold mode imports nothing. Both the comment journey and the
unchanged container gate pass on this head; complete new warm/cold receipts
must verify the cache correction before accepting a timing budget.

Both full runs at GitHub head `8f9cf1d9ba28c0a2ede50f75f1a1956618231df1`
complete successfully (attempt 1). The PR checkout source is
`ab093d0227f20b23cea7b42b089aba7bc492bb1e`; cold dispatch checks out the branch
head. These receipts qualify all selected assertions and the unchanged gates,
including native browser coverage, independently of the unmet timing budget.

| Producer / consumer | PR 40664255786 job / seconds | Cold 40664434461 job / seconds |
| --- | --- | --- |
| API | 122735162037 / 81 | 122736863314 / 229 |
| Toolbox | 122735161913 / 91 | 122736863245 / 244 |
| Full UI | 122735162130 / 296 | 122736863560 / 330 |
| Browser | 122735161374 / 83 | 122736862454 / 145 |
| Container gate | 122741299974 / 165 | 122744107853 / 190 |
| Restore | 122739165320 / 191 | 122743353511 / 196 |
| ci-gate | 122744805201 / 19 | 122748541061 / 19 |

### BR-78 reviewed head and carried acceptance

At head `d072d24ecc4caf30dba18e4476366efd58a4d2bb`, PR run
[40713883861](https://github.com/rhanka/sentropic/actions/runs/40713883861),
attempt 1, is completed/success in 1465s wall-clock. These are cache-enabled
job durations, including job setup, embedded prerequisites, builds and transfers:

| Job | Job ID | Seconds |
| --- | --- | --- |
| API | 122906441972 | 111 |
| Toolbox | 122906442347 | 121 |
| Full UI | 122906441859 | 255 |
| Browser | 122906441182 | 73 |
| Container gate | 122909971487 | 209 |
| Restore | 122909971457 | 196 |
| IdP screens | 122913533033 | 290 |
| VSCode | 122913532961 | 142 |
| E2E a / b / c / d / e | 122909358820 / 122909359737 / 122909358919 / 122909358935 / 122909358946 | 270 / 154 / 303 / 200 / 211 |
| Capacity receipts | 122918555558 | 17 |
| ci-gate | 122919004635 | 18 |

Full UI is **255s versus the 180s warm target**, a 75s breach. No cold run
exists at this reviewed head; the older 330s cold sample at `8f9cf1d9b`
cannot qualify the parent-cache correction. The final pushed head receives a
forced-cold dispatch (`image_cache_mode=cold`, no image cache import/export)
and its own PR qualification. After completion, full run/attempt/job/step JSON,
per-job durations, actual head/checkout provenance and target comparisons are
recorded in `.tmp/ci-br78/receipts/<run-id>/` and the final head/run handoff.

Lots 3 and 5 explicitly carry to a follow-up (CI train owner; number pending):
repeated warm/cold acceptance, API-case UI ≤120/150s, full readiness ≤180/210s,
the scoped rollback drill and exhaustive listed final validation. This PR's
exact final head must still pass CI. Its delivered cache/transport/browser
remediation does not close performance or BR77 acceptance.

Exact apk pins fail closed when Alpine retires a package version; maintainers
must explicitly repin Chromium/headless-shell, FFmpeg and libcrypto3/libssl3,
then repeat browser probes, journeys and the unchanged container gate. The
new runtime/cache action is pinned to the source-verified v3 commit
`3cb05d89e1f492524af3d41a1c98c83bc3025124` at all four call sites.

## 12. BR-79 independent DAG — reviewed-head receipt and carried acceptance

BR-79 starts from merge `c8ec01237ce5f8539a9ac6c1c11c58c947a22078`, on
`perf/ci-parallel-dag` in `tmp/worktrees/ci-parallel-dag`. The owner requires
merge-only updates and local `ENV=test-ci-br79`, with the shared Docker lock.
Draft [PR #826](https://github.com/rhanka/sentropic/pull/826) retains BRANCH.md.
BR-78's carried Lots 3/5 and warm/cold readiness gaps remain open.

Browser and VSCode consume API/UI/browser images; IdP consumes API/toolbox/
browser images; restore consumes API/toolbox images. Their dispatch no longer
waits for lint or SAST/SCA. Those verdicts remain explicit image-promotion
barriers and required final-join members. Desktop packaging, fresh UI tests,
runtime image production and the separate static profile now have independent
jobs. The runtime and static API URLs retain their distinct compilations.

Four container lanes verify and scan API/toolbox/UI/browser candidates at
their own artifact barriers. API/UI SAST and SCA run as four matrix members.
Selection-aware joins reject missing, failed, cancelled, neutral and unexpected
skipped results; the final verdict also checks each actual matrix member.
Native report uploads include hidden files and fail when reports are absent.
Existing scanner/parser/compliance policies and runtime assertions remain.

Local qualification passes 6 DAG, 24 expected-result and 134 publication tests,
the parser negatives, version filters and the inventory of 56 numbered E2E
specs. Capacity shape remains 15 API / 5 browser members without mutexes;
the graph reports demand of 64 PR / 63 main slots, not account admission.
The observed 17-slot lower bound and cumulative scheduling budget are still
unqualified. A green shape test does not close either timing requirement.

Baseline main [40736913130](https://github.com/rhanka/sentropic/actions/runs/40736913130),
attempt 1 at `c8ec01237`, is completed/failure and includes failed comments packaging
(job 122989014482, npm ECONNRESET after 102 tests pass). Initial BR-79 PR run
[40741770463](https://github.com/rhanka/sentropic/actions/runs/40741770463),
attempt 1 at `52206747c7338d082094ff4cb74fb596b30cd360`, is completed/cancelled.
Neither supplies final acceptance. Raw run/attempt/job/step JSON, workflow
digests, per-job TSV and native failure logs are retained in the owner workspace
under `.tmp/ci-br79/receipts/<run-id>/`. Missing spans remain to measure.

Chrome/VSCode stage separation awaits the bounded owner decision for
`ui/Dockerfile` (BR79-EX3); the current implementation still builds both inside
each UI profile and preserves every embedded-output assertion. Scans <=90s,
IdP <=150s, cumulative scheduling <=60s and complete UI readiness remain open;
the reviewed-head CI result is recorded below. The historical 255s full UI / 209s
container / 290s IdP sample at `d072d24ec` is not a new-base acceptance result.

Completed baseline job spans from main run 40736913130 attempt 1 are below.
Cache import/export is enabled; this mixed cache state is not a fully warm
qualification. Runner labels are `ubuntu-latest`; full job/step identities and
timestamps are retained. Workflow SHA-256 is
`e4a90d83c54dfe5d05ee3f0c80f299e1734e09e4ee6f03ab53c41d57a64e0d18`.
The run's failure prevents whole-run success
credit; these completed job spans remain valid measurements.

| Baseline job | Job ID | Complete seconds |
| --- | --- | --- |
| API image | 122989013828 | 397 |
| Toolbox | 122989014212 | 437 |
| Full UI group | 122989014078 | 438 |
| Browser image | 122989012503 | 487 |
| Container gate | 123004751193 | 229 |
| Restore | 123003211852 | 208 |
| IdP screens | 123003212049 | 213 |
| VSCode | 123004751285 | 105 |

Initial-head UI job 123006317177 in PR run 40741770463 passes all 83 files /
489 tests in 188s, including about 122s materializing cached input layers and
35s executing tests. Moving this work off the runtime-image path preserves
its cost; it does not qualify complete UI readiness or the final head.

After receipt: [run 40748328717](https://github.com/rhanka/sentropic/actions/runs/40748328717),
attempt 1, `pull_request`, reviewed head `949d47c8ced0426a010da639ac910229d5699874`,
completed/success: 75 successful jobs, 28 skipped, zero failures. Raw run/attempt/
job/step JSON, all 103 job spans in `jobs.tsv`, exact workflow and readiness JSON
are retained under `.tmp/ci-br79/receipts/40748328717/`. Workflow SHA-256:
`f268d4ea1b4d64137ab93741a26ee78063c5d385b471bb9e88e0807d6e9e8b0a`.
Runner class is `ubuntu-latest`; cache import/export is enabled, actual warm/cold
state unidentified. Measured runner-minutes: 205.8, with no missing executed
spans. These are complete job spans, excluding runner admission.

| After job | Job ID | Execution seconds | Created-to-start seconds |
| --- | --- | --- | --- |
| API image | 123051431931 | 332 | 2315 |
| Toolbox | 123051431960 | 1354 | 2494 |
| Desktop | 123051431933 | 46 | 2444 |
| UI runtime | 123073253521 | 117 | 309 |
| UI static | 123073253248 | 230 | 229 |
| UI tests | 123051431812 | 104 | 2209 |
| Browser image | 123051430438 | 56 | 525 |
| Container API | 123074641143 | 62 | 184 |
| Container toolbox | 123085229482 | 90 | 2 |
| Container UI | 123077045060 | 50 | 16 |
| Container browser | 123056496684 | 89 | 2086 |
| Container join | 123086032495 | 17 | 2 |
| API SAST / SCA | 123051432031 / 123051432004 | 56 / 23 | 2436 / 2433 |
| UI SAST / SCA | 123051432256 / 123051431837 | 34 / 24 | 2591 / 2242 |
| Code join | 123074448295 | 15 | 205 |
| IaC | 123051432003 | 31 | 2180 |
| Restore | 123085229870 | 209 | 3 |
| IdP screens | 123085229315 | 233 | 2 |
| VSCode | 123077044862 | 129 | 2 |
| Browser groups a/b/c/d/e | 123077045022 / 123077044968 / 123077045660 / 123077045124 / 123077045154 | 268 / 216 / 251 / 205 / 199 | 35 / 3 / 37 / 5 / 3 |
| Final gate | 123089502746 | 20 | 2 |

Run creation 18:47:06Z to update 20:43:50Z is 7004s; first job creation
19:26:49Z leaves 4621s. The preceding concurrency-group cancellation accounts
for 2383s before first-job creation. First-wave runner waits reach **2649s**
(`validate-artifacts`, job 123051432139), exceeding the **<=60s cumulative
scheduling budget** alone. API/browser container admission is 184/2086s.
Runtime readiness-to-start is 3–38s for browser groups, 2s for VSCode/IdP and
3s for restore; group c's own creation is 1s after UI readiness. Execution and
admission are separate; a removed DAG edge cannot establish admitted capacity.

**IdP 233s vs <=150s is 83s over budget**, versus the 213s baseline. Container
lanes max 90s meet the individual lane ceiling, but the complete path also has
the 17s join and queue; whole-path <=90s is unqualified. Toolbox execution
1354s includes a 1297s build step versus 437s baseline; no cache-state speedup
is inferred. Split UI spans are not added or substituted for full UI readiness.

CI train author carries BR-79 Lots 2 (EX3), 3 and 5 to **BR-80**: obtain bounded
Dockerfile authorization before extension-stage fan-out, verify embedded output/
profile identity, inspect IdP setup/build/transfer/execute before optimizing,
retain rollback/UAT and broader local campaigns. BR-80's package-lane split
targets package-path cost and runner pressure; it does not establish the IdP
or scheduling ceilings. Measure admission after that split and resolve capacity
with the owner if waits persist. BR-81 supplies deterministic runtime journeys;
BR-84 owns repeated warm/cold whole-train proof and every breach. Exact-head
green CI is still required after review fixes; these carried budgets stay open.

## 13. BR-80 package candidates — implementation and baseline

BR-80 starts at merge `ecca3a0d50526a25e0b76e5955f26f2557c8e0b0` in
`tmp/worktrees/ci-package-candidates`, branch `perf/ci-package-candidates`.
Local qualification uses `ENV=test-ci-br80`, slot 0 ports 9400/5600/1500,
and the machine-wide Docker flock. Main push run `40790421598` remains queued
at the initial capture; an unstarted run supplies no execution measurement.

The completed predecessor receipt is PR run
[40748328717](https://github.com/rhanka/sentropic/actions/runs/40748328717),
attempt 1, head `949d47c8ced0426a010da639ac910229d5699874`, success.
Its workflow SHA-256 is
`f268d4ea1b4d64137ab93741a26ee78063c5d385b471bb9e88e0807d6e9e8b0a`.
Raw attempt/job/step JSON and per-job TSV are retained under
`.tmp/ci-br80/receipts/40748328717/`. Runner class is `ubuntu-latest`;
package-tool cache warmth is unidentified. These are complete job spans,
excluding admission, and are distinct from the older 664/125s study anchors.

| Baseline job | Job ID | Seconds |
| --- | --- | --- |
| Cluster qualification | 123051431364 | 991 |
| Common manifest guard | 123051430739 | 65 |
| LLM mesh | 123051431590 | 71 |
| LLM gateway | 123051431190 | 199 |

Cluster steps include storage/recovery 262s, typecheck 51s, source tests 104s,
stateful installed contracts 89s, build 49s, guarded pack 53s, installed
comments 28s, major upgrade 25s, and lazy qualification 294s. Candidate install
was legitimately skipped in that predecessor's WARN classification; BR-80
requires its selected candidate lane. No skipped duration counts as a pass.

The inherited IdP 233s receipt has checkout/setup 31/11s; API download/load
3/22s, toolbox 16/34s, browser 14/16s; startup 45s, actual screen smoke 5s,
teardown 31s. These identified spans guide a future bounded optimization;
BR-80 does not change IdP code, image profiles, extensions or security policy.
UI 255s/180s, IdP 233s/150s and runner-admission breaches remain open.

The package design builds the topological closure into immutable archives and
an independently hashed preparation archive. Every source lane extracts into
fresh container storage; installed consumers receive only archives. Nine
qualifiers in three bounded jobs preserve source/audits, PostgreSQL, comments, crash ordering,
installed comments, major upgrade, stateful contracts, lazy tuples and clean
entry-point qualification. Actual matrix members and the producer join the
existing fail-closed final verdict. Stateful and gateway auth-subpaths now copy
verified receipt bytes when a bundle is selected; their assertions are unchanged.
Prepared source integrity trusts same-run immutable artifact transport plus tuple
lock/workflow hashes; the preparation has no independent source-tree digest.

### 13.1 First measured result and failed budgets

[Run 40928684313](https://github.com/rhanka/sentropic/actions/runs/40928684313),
attempt 1, `pull_request`, head `0d4bf1ca42d9e7e3fbd5b0492829efc70d2ee8b9`,
workflow SHA-256 `f7ee1d0340f78757039636d8319d1aea1943812c87687bee885a412e28d665ef`,
runner `ubuntu-latest`, package-tool warmth unidentified. Paginated raw jobs/run
are retained in `.tmp/ci-br80/review-r1-jobs.json` and `review-r1-run.json`.
These completed job spans are valid measurements; the run remains queued on
`security-container` 123683980274, so no whole-run success is claimed.

| Completed job | Job ID | Seconds |
| --- | --- | --- |
| Changes | 123640990850 | 19 |
| Candidate producer | 123651400522 | 97 |
| Source | 123663293264 | 149 |
| PostgreSQL / comments / crash | 123663293179 / 123663293239 / 123663293163 | 91 / 81 / 65 |
| Installed / major | 123663293052 / 123663293223 | 59 / 51 |
| Stateful / lazy / clean install | 123663293192 / 123663293268 / 123663293148 | 59 / 121 / 53 |
| Mesh / gateway | 123663292634 / 123663292644 | 71 / 107 |
| Common manifest guard | 123663292699 | 82 |

Execution path: producer 97 + longest qualifier 149 = **246s**, or **265s**
including classification, exceeding **<=210s** by 36–55s. Common guard **82s**
exceeds **<=75s** by 7s and the measured 65s predecessor by 17s. Package-family
runner execution totals 1,186s versus predecessor 1,326s; this is not wall time.
Producer admission is 1,216s; source consumer admission is 1,342s. Changes-end
18:31:48Z to last cluster completion 19:18:32Z is 2,804s including admission.
No queue span, skipped result or partial run is credited toward acceptance.

Disposition: **defer by name to BR-84**, without raising either threshold.
`BR84-BR80-CLUSTER` (owner: CI-train author on BR-84) must optimize and measure
the complete producer/transfer/grouped-qualification path at <=210s, including
the admission breakdown. `BR84-BR80-MANIFEST` (same owner) must investigate the
82s guard and qualify <=75s. Both require identified repeated warm/cold runs,
job/attempt/head/workflow receipts and preserved complete-result assertions.
The three-job reduction below changes the path; its new timing is unmeasured.
Rollback, whole-train timing and exact-head terminal CI remain open.

### 13.2 Capacity and transport composition

Against main `b7e86f5ea0`, reviewed head adds **+9 jobs / +8 concurrent slots**:
PR jobs 73→82, push 98→107, PR/push demand 65/64→73/72; cluster-only PR 11→20,
guard-scripts-only PR 10→22. The earlier “unchanged 73/72” compared only the
policy repair, not main. Corrected CI groups all nine qualifiers into three
jobs capped at three, removes six jobs/slots and preserves isolated namespaces,
every assertion, per-qualifier cleanup and failure aggregation. The #841 cleanup
adds one sequential job: net **+4 jobs / +2 concurrent slots** versus main,
PR/push 77/102 selected jobs and 67/66 slot demand. Against the **40-slot account
cap**, this bounds BR-80's added pressure but does not qualify account admission;
BR-84 owns the remaining measured admission/whole-train budget disposition.

Compose #841's cleanup with the union exemptions `ci-gate`, `ci-capacity-receipts`,
`delete-transport-artifacts`; keep the producer in capacity needs. All six
transport artifacts use one-day retention, including `package-candidates`
(artifact 12923722892, 167,402,696 bytes measured). Delete current-run allowlisted
transport only after successful completed consumers; retain unsuccessful or
incomplete attempts and fork/cancellation/API-error fallback. Evidence reports
are excluded. Wiring/expected-results/DAG contracts qualify this composed tree;
the second PR to land must preserve these resolutions and repeat the suites.
