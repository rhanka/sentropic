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
bytecode; this evidence establishes unstable output, not which of those mechanisms
causes it. Owner: desktop-package maintainer, assignment pending. The remaining
bounded work is a reproducible desktop closure, verified
by equal output digests on repeated identical inputs and actual Windows runtime
qualification, then complete warm/cold UI reruns without removing assertions.

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
