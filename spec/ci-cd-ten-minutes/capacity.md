# CI/CD capacity — measured inventory (BR-76)

## BR-77 inventory — 2026-10-26

Base: `440599d04e91bb33e3874588f067c6a90bffd1b3`; BR-76 #705
merged at `bc4a4a80a732b629da75027a9eb07c7c77cf522a`.
API receipts collected by the branch author using the existing authenticated
GitHub CLI (no credentials retained):

| Route | Observed result | Interpretation |
| --- | --- | --- |
| `GET /user` | login `rhanka`, `plan: null` | Account quota unavailable. |
| `GET /repos/rhanka/sentropic/actions/runners` | `total_count: 0`, `runners: []` | No self-hosted reservation to allocate. |
| `GET /users/rhanka/settings/billing/usage` | HTTP 404; endpoint requires `user` scope | Billed minutes, registry and transfer costs remain to-measure. |
| `GET /repos/rhanka/sentropic/branches/main` | base SHA above | #760 is still open at inventory time; no unmerged changes are imported. |

The finite policy uses the BR-76 **observed lower bound of 17 slots**, not
the unverified 24-worker hypothesis or an account quota. Fifteen shared
job concurrency groups cover common work; the existing npm train and API
image publication groups account for the other two slots.
This is a repository dispatch bound, not a provisioned runner reservation:
other runs/repos can still consume shared hosted capacity. Concurrent-run
admission must compare the combined measured peak against that lower bound;
it cannot be accepted from this static per-run check alone.

`make ci-capacity-policy` bounds the weighted antichain by the number of
distinct execution mutexes (matrix indices share the common pool). It
rejects PR demand above 15, main demand above 17, validator dependency
chains, and unsafe pool queues. The expected manifest retains dependencies
so queue waits can be summed along identified observed critical paths.

## BR-77 policy and live qualification

The active policy keeps 23 independent package validators ready after
`changes`, sharing six execution mutexes. Every common job uses one of
15 repository-wide slots; API/E2E use their reference widths 15/5 and
matrix indices share those slots. These reference widths are not a newly
measured optimum. Ordinary publishers depend on their own validators;
the existing oauth → mcp-auth and mesh → gateway → cluster registry
dependencies remain. Every common-pool mutex sets `queue: max` and
`cancel-in-progress: false`: waiting jobs are retained, without `needs`
chains or the default replacement of pending jobs. The two existing release
mutexes remain separate. Other workflows/repositories remain outside this bound.

Static admission is not timing acceptance. Use `CI_REQUIRE_CAPACITY_PROOF=1`
and `CI_POLICY_RUN_FILES='<pr>/capture.json <main>/capture.json'` with
`make ci-capacity-policy`. Both identified runs must complete successfully,
carry the exact workflow policy digest retained before dispatch, and finish
within the 2288s baseline. Historical captures without that attestation
remain measurable but cannot qualify the new policy; mismatches fail closed.
One must be a PR, the other a push on main. Cancelled runs, incomplete
captures, old-policy main runs and branch dry-runs never qualify this proof.
The prior 13/10-deep chains are rejected: run `40368572524` was still
unfinished at 81 minutes. No final-policy timing acceptance is claimed yet.

The completed replacement PR run `40402395319` is a negative timing receipt:
source `1b5ef536885cf1f8533e88fc54dc40dbbf8c7223`, attempt 1,
2026-10-26T21:12:34Z to 2026-10-27T02:16:18Z, success with 62 executions
and 27 skips. Wall-clock is **18224s**, qualification endpoint 18223s,
aggregate critical-path scheduling **17227s**, queue p50 3040s / max 7640s,
and own execution peak 5. Classification 26s and verdict 19s also breach
their budgets. The strict proof command rejects this attested, fresh receipt.
The path is changes → build-ui → E2E group-c → receipts → gate; validator
chains are gone, yet queueing still defeats the goal. This policy remains
unqualified. A new successful PR and actual main run must each meet 2288s.

Concurrent traffic snapshot at 2026-10-26T23:58:02Z retained 25 unfinished
runs and 19 executing jobs, including two on these qualifications and 17
elsewhere. The previous-policy main run `40390149749` completed successfully
in 9728s; it is context, never a final-policy main receipt. Main observed at
2026-10-27T02:04Z (`365e8b313f1c4c627c87db4f6761847a1e6a5ae7`) lacks this policy.

Dispatch this branch with `capacity_publish_dry_run=true` to exercise all
21 actual package publication jobs and their dependency guards. Each runs
`make ci-capacity-publish-dry-run PACKAGE=<slug> ENV=test-ci-capacity`,
which executes the existing real guarded pack and logs a run/SHA/package
receipt. Registry writers and registry post-publication qualification steps
are disabled only in that mode. This proves branch publication wiring after
completion; it is not a main release receipt.

On dry-run `40408883195`, cowork-desktop job `121963393513` completed its
guarded pack after the missing-context correction, with the npm writer skipped.
Its archive guard passed in CI/WARN mode (SHA-256
`2f32a5346e3f87d3f02f81662197e5b5b1d226d0f8b1d1ed72f4b78f49ac2613`).
The full chain subsequently completed as recorded below.

### Completed branch publication qualification

Run `40408883195`, attempt 1, source `1b5ef536885cf1f8533e88fc54dc40dbbf8c7223`,
completed successfully from 2026-10-26T21:59:20Z to 2026-10-27T03:49:06Z:
82 executions / 7 skips, **20986s wall-clock**, package endpoint 19557s.
All 21 expected publishers completed their actual guarded packs; their
identified JSON receipts, archive guards, dry-run steps and skipped registry
writers/post-publication checks were individually verified from job logs.
The existing mesh → gateway → cluster and oauth → mcp-auth barriers ran.
This qualifies branch publication wiring only. It is not a main release or
a timing pass: classification 24s, verdict 15s and scheduling 19975s all breach
their budgets; queue p50 is 3725s / max 13700s. The strict two-receipt command
rejects this run and PR `40402395319`; both are fresh and attested, neither
meets 2288s, and no actual final-policy main receipt exists.

The final conflict-resolution rebase onto main
`55431a99c73ae72bcf9404c8de5b1c8375f9e39b` preserves the workflow bytes used
by these receipts. Scoped checks passed again: 35 metrics, 21 expected-results
and 90 publication tests. The receipts retain source `1b5ef5368`; later reader
and documentation commits do not turn the failed timing proof into acceptance.

| Guarded package archive | Job | Archive SHA-256 |
| --- | --- | --- |
| `@sentropic/artifacts@0.2.1` | [121971804916](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121971804916) | `fb2887d206bcaf7d5e4d85ad14173ffd3cce700e239dabf540150383c7bfe28f` |
| `@sentropic/auth-client@0.2.0` | [121941592859](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121941592859) | `d3e3e335b987c6a963ae394836a330210c332b9fb8ff291eb65c1bfce77cce4c` |
| `@sentropic/auth-hono@0.17.0` | [121941650645](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121941650645) | `6ed1e0353c846dbb494837aa339c096587ceba65a9220a3ed555ebe641cb5db7` |
| `@sentropic/auth-ui@0.7.7` | [121971902312](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121971902312) | `de60dd0319fbabed2d71f4083f435135112bc8f05f6d367abd48869d862aadf1` |
| `@sentropic/chat-core@0.1.7` | [121954141074](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121954141074) | `359c4db67acf62933930cd84013f4dbb59f20854fb5c6db6dbd1b64545244a5a` |
| `@sentropic/chat-server@0.4.0` | [121911004270](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121911004270) | `9d6f7d5e76c477a827e8adba9ae30780b2a2f4d529b1aa45864e3a2cf6de6e92` |
| `@sentropic/chat-ui@0.34.1` | [121939426498](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121939426498) | `939a18dd701d3f8b506a2316ccf4447eecb91c6598b5a95754fe07903b6932fb` |
| `@sentropic/cited-source-viewer@0.2.0` | [121963262445](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121963262445) | `7fb68934503927075c40d0da6c6ad2d55f4cae16325c6bcc9f17a703600fc679` |
| `@sentropic/cluster-mesh@0.22.4` | [121987915280](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121987915280) | `c483e033f8bdc48a1504b3bf0f135564dbd1a727ba0f7519ff762c496c2f4cf0` |
| `@sentropic/comments@0.3.1` | [121939854960](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121939854960) | `9e40d172e1e7757e617e13b78b3f112af3abe6bf0476f06258b71378e5783769` |
| `@sentropic/contracts@0.3.0` | [121972633449](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121972633449) | `da9bf950887256c8095a8982b5d98808f26b34b170039bd49561ecfc1daf6371` |
| `@sentropic/cowork-bridge@0.1.1` | [121926225197](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121926225197) | `2a3ce479abf6c2b740d9ff30eec262a0f15dfba4e560d3c6dfc6ae4f3225c7c8` |
| `@sentropic/cowork-desktop@0.2.0` | [121963393513](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121963393513) | `2f32a5346e3f87d3f02f81662197e5b5b1d226d0f8b1d1ed72f4b78f49ac2613` |
| `@sentropic/events@0.2.1` | [121952054807](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121952054807) | `3dedd1bff6ba911460d0b04843681b31b902fe5aaadc2287fc8e4cb043194d22` |
| `@sentropic/flow@0.2.0` | [121963540197](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121963540197) | `14f0ccc9f9d2370a22b5a52c202192aeb426d8b3f7253de9ded031842bec6c8e` |
| `@sentropic/harness@0.4.0` | [121972258266](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121972258266) | `206267e1701694c7a2f9933a528c4938464f578c84f82c983e4825b764868a5d` |
| `@sentropic/llm-gateway@0.21.3` | [121985278488](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121985278488) | `2ca56c61c0d341e7d2bfdc8b99fe5ca29342d47371fc8c60ff8d770903103c74` |
| `@sentropic/llm-mesh@0.28.1` | [121976490055](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121976490055) | `c4b724f19c4ba35e9a7b7eaff5f3812e1a2513df898552e03fe74a95b871779d` |
| `@sentropic/mcp-auth@0.2.2` | [121967865997](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121967865997) | `3aa546601a3ad444bae0058c6c21038ec1d12e905e27df1abb628eadc867d926` |
| `@sentropic/mcp-platform@0.4.0` | [121957810793](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121957810793) | `67c9ab88ae51087a21a596facfc8330dea4c43128878c261a4136b6d458885e5` |
| `@sentropic/oauth-verify@0.1.0` | [121952524928](https://github.com/rhanka/sentropic/actions/runs/40408883195/job/121952524928) | `91dcee3a51fafec57c34e5a5f771d9b7362e3f16a0132a4d5f90056ac0f90dad` |

### Baselines and historical comparisons

| Receipt | Identified observation | Acceptance |
| --- | --- | --- |
| New-base baseline | Main `40341027258`, attempt 1, source `440599d04e91bb33e3874588f067c6a90bffd1b3`: 89 rows, 68 measured, 21 skipped; peak 15; 211.15 runner-minutes; execution queue p50 111s, max 882s. | Jobs API baseline, not the bounded policy's result. |
| Baseline endpoints | Qualification 2288s; selected images 2128s; preproduction 2254s; cluster publication 1879s from workflow creation. Classification job `121635441567` 18s; gate `121657161589` 14s. | Classification/verdict budgets breached; no fresh npm-publication claim. |
| Superseded PR | `40352448337`, attempt 1, head `0a1eb32ea873a48b71833d163537719dae1e2bb1`, automatically cancelled when rollback head was pushed; 57 identified cancelled rows. Gate `121681630885` failed as required. Classification `121675860608` 21s; gate 19s. | Cancellation observed; 15s/5s budgets breached. |
| Conservative rollback | Head `474e023163fd1be0b2f0ac7f33442c2d97dc561c`, run `40353670942`, attempt 1: one package validation lane, API/E2E 1/1; cancelled before completion. Classification `121682062979` 20s. | Drill not accepted; passing metrics job `121682975411` is insufficient. Require a completed drill and record its run ID before ticking. |
| Concurrent release | Main `40341027258`, attempt 2, same source: completed successfully through both PR supersessions. 89 rows / 68 executions / 21 skipped; peak 12; 210.45 runner-minutes; execution queues p50 383s / max 860s. | All four selected endpoints continuous. Classification `121676338012` 19s; gate `121701213010` 19s; critical-path scheduling 1559s: all three budgets breached. |
| Concurrent endpoints | Main attempt 2: qualification 2750s; selected images 2359s; preproduction 2534s; selected packages 2477s. Longest qualification-path wait: `smoke-idp-screens` job `121684322205`, 860s. | Completed measured delivery, not a ten-minute result or a fresh npm-publication sample. |
| New-base release | Main `40356941217`, source `22d8a9e68b1abae2665fedb528526d2a84c6bc4d`, attempt 2 succeeded after retrying the failed 2.7-GB toolbox download in object-registry job `121708995656`; retry job `121742300480` passed. All four selected endpoints continuous; 41 measured rows and 48 skipped. | Classification 17s / verdict 24s breach 15s/5s. Mixed carried-forward execution stamps leave aggregate scheduling to-measure. Package completions before retry creation have null elapsed timing, not a fresh delivery sample. |

The cancelled Jobs API rows include `runner_id: 0` with positive intervals
(for example job `121676271575`, 15:46:09–15:52:57 UTC). These never received
a runner: they retain cancellation identity and raw stamps but contribute
no execution, runner cost, queue sample or peak. Missing/inverted stamps and
pending timestamps likewise receive no invented measurement.

Reproduce a completed receipt through
`make ci-capacity-capture CI_RUN_ID=<id> CI_RUN_ATTEMPT=<attempt> ENV=test-ci-capacity`.
Use `CI_EXPECTED_ATTEMPT` when a rerun carries the original classifier forward.
The target fetches every Jobs API page, the source workflow and retained
pre-dispatch manifest; absent artifacts/identity mismatches fail closed.
It writes BR-76-format `capture.json` and `metrics.json` below
`tmp/ci-capacity/<run>-<attempt>/`. The actual workflow revision remains null
when unavailable; the separately identified source workflow is retained.

Combine current PR, main and obsolete captures with `make ci-run-metrics`
using `RUN_FILE=<current>/capture.json` and
`CI_COMPETING_FILES='<main>/capture.json <obsolete>/capture.json'`.
The combined receipt includes execution-overlap witnesses, measured peak,
admission, superseded cancellation ownership and release continuity.
Main's slots are already counted in that peak, so its reserve is not
subtracted twice. Incomplete runs remain to-measure. Critical-path scheduling
includes workflow admission (workflow creation to root job creation),
dependency-to-dispatch handoff and queue waits; it is not the
maximum single-job queue sample.

The conservative rollback waited 189s before root job creation; main attempt
2 waited 1s. These admission intervals are separate from job-ready queue
samples. Absent job readiness or request stamps remain null, never replaced
by the workflow timestamp. Main's 1559s total includes that 1s admission.

Remaining branch-author acceptance: final-head complete CI/security verdict,
new-base current-main membership and combined admission. Completed main
attempt 2 already proves selected release continuity and measures the
1559s scheduling breach. Quota/billed cost
remain unavailable through the inventoried token. Unmet 15s/5s/60s budgets
remain open; a green correctness verdict does not satisfy them.

## Completed final-policy timing attempt — 2026-10-27

Measurement source: `dd2737fa486985ecfa756261b26ba2323e73289f`, a merge commit
with parents `6c95004384b61aada3f9f48d05b4128400dc87b2` and
`2d6643692389ecbb7e5ac410e7b31a3cfbaa732a` (`origin/main`). The workflow
policy was unchanged. Harness branch/scope checks and 35 metrics + 21
expected-results + 90 publication tests passed before push. Both runs used
attempt 1, completed successfully, and were allowed to finish without a push.

| Receipt | Run | UTC creation → completion | Wall seconds | Qualification scheduling | Qualification execution | Finalization |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| PR | [40460101167](https://github.com/rhanka/sentropic/actions/runs/40460101167) | 06:16:16 → 07:17:17 | **3661** | 2582s | 1078s | 1s |
| Main-like guarded-pack dry-run | [40460107095](https://github.com/rhanka/sentropic/actions/runs/40460107095) | 06:16:20 → 07:21:48 | **3928** | 2965s | 962s | 1s |

Wall time is run creation to final `updated_at`; qualification ends at the
completed `ci-gate`. Scheduling includes admission, dependency handoff and
job creation-to-runner-start waits along that endpoint's identified path.
Execution is the sum of runner spans on that same path; parallel jobs are
not summed into wall time. The Jobs API does not separate mutex admission
from hosted-runner scheduling. First runner starts were 3s/27s after creation.
Both qualification paths are changes → typecheck-lint-api → E2E D →
ci-capacity-receipts → ci-gate. PR membership: 89 rows, 62 executions,
27 skips; dry-run: 89 rows, 82 executions, 7 skips. No missing execution
timestamps or carried-forward executions; both gates succeeded.

| Hotspot | PR job: queue / execution | Dry-run job: queue / execution |
| --- | --- | --- |
| E2E D, shared slot 3 | `122046116611`: 2571s / 357s | `122050390092`: 2119s / 268s |
| E2E B, shared slot 1 | `122046116679`: 2374s / 264s | `122050390297`: 1830s / 232s |
| API typecheck/lint | `122042533052`: 2s / 656s | `122042643129`: 812s / 637s |
| Cluster Mesh validator, slot 1 | `122042534709`: 62s / 782s | `122042642781`: 1376s / 790s |
| API chat-sync/summary/comment-assistant member | `122043986809`: 2255s / 412s | `122045883430`: 2322s / 290s |

Queue p50/max: PR 223s/2571s; dry-run 834s/2322s. Slots 1/3 are also
shared with package validators and API matrix members across both runs.
The measured pair peaked at 15 simultaneous executions (individual peaks
14/8); combined admission against 17 observed slots passes. This accounts
for this pair only. A static width bound does not establish latency.

All 21 dry-run publishers succeeded, each with a successful `Dry-run package
publication` step and skipped registry writers. The package endpoint was
3304s: 3205s scheduling + 99s execution on changes → validate-mcp-auth →
publish-mcp-auth (`122042643284` / `122054658384`). Classification/verdict
were 26s/18s for PR and 18s/18s for dry-run; the 15s/5s budgets still fail.
The scheduling budget uses the maximum selected endpoint: 2582s/3205s.

Retained pre-dispatch manifests: artifacts `12713454598` / `12714271150`,
both attesting policy digest
`26701db9bc29a11f192fccba349d4d95e6d0bfccf792482380e808f32f89466d`.
Their ZIP SHA-256 values matched GitHub's artifact digests on download.
Full run/jobs/workflow/manifest/capture/metrics receipts are retained locally
in `tmp/ci-capacity/40460101167-1/` and `tmp/ci-capacity/40460107095-1/`;
the canonical `make ci-capacity-capture` command above reproduces them.
During collection, the CLI's public API route hit its rate limit; complete
100-row Jobs API pages and artifacts came through the GitHub connector,
then the unchanged capture/metrics readers ran through Make in Docker.

**P1 remains open:** PR exceeds 2288s by 1373s; dry-run exceeds it by 1640s.
`make ci-capacity-policy CI_REQUIRE_CAPACITY_PROOF=1` with these two capture
files rejects both fresh, attested timing receipts. The requested main-like
run is `workflow_dispatch` on the branch; it does not replace the strict
reader's actual-main-push requirement or prove main delivery. No policy
change or acceptance tick follows these measurements; PR #766 stays draft.

## BR-76 retained measurements

Status: measurement record with reconciled receipts (metrics +
expected-results + docs only, per owner split decision 2026-10-19);
account quota, registry cost, contention budgets, and the rollback drill
remain to measure under BR-77 (`plan/71-BRANCH_chore-ci-capacity-policy.md`).
Source base: `81deb7bd78d99bca8d51f67c4f1d4424fb772d75`.
Reference run: Main `39113919235` attempt 1 (84 job rows, 59 measured,
25 skipped; attempts 1+2 hold 168 input rows, 58 carried-forward copies
dropped, 110 retained rows: 60 measured executions, 50 skipped rows).
Receipts below come from `make ci-run-metrics` on the
captured attempt-1 rows reconciled against the Jobs API.

## Observed runner classes

- [x] Every job in the reference run executed on `ubuntu-latest` (GitHub-hosted).
- [ ] Self-hosted runner classes: none observed; to measure if introduced.
- [ ] OS/image variants per lane: to measure at implementation time.

## Account quotas and reservation

- [ ] Concurrent-job quota of the account: unavailable through the current token.
      On 2026-10-19, billing usage returned HTTP 404 and requested the `user`
      scope; authenticated account `rhanka` returned `plan: null`. The repository
      is public and its runner inventory returned zero self-hosted runners.
      An executed peak is a lower bound, not the account quota.
- [ ] Roughly 24 workers is a study hypothesis, not a provisioned fact.
- [x] Measured concurrency peak on the reference run: 17 simultaneous
      executed jobs (half-open intervals, skipped and zero-duration rows
      excluded; the inclusive count that kept them read 18).
- [ ] Reservation policy for release lanes: to measure; no reservation exists yet.

## Scheduling priorities and cancellation ownership

- [x] PR attempts cancel only superseded attempts of the same ref (workflow
      concurrency, `cancel-in-progress` on `pull_request` only).
- [x] Main releases never cancel: `cancel-in-progress: false` on every
      concurrency group, including `api-image-publication` and `npm-publish-train`.
- [x] Cancelled results retain their identified conclusions in the gate verdict;
      unexpected skips block the verdict.
- [ ] Concurrent PR/main receipt: pending BR-77 qualification (moved out of this PR).

## Cost and peak demand

- [x] Runner-minutes on the reference attempt: 148.25 total across measured
      spans (billing export not yet attached; union with attempt 2: 149.1).
- [ ] Registry and transfer cost: to measure.
- [x] Peak demand window: reference run sustained 17-way executed overlap;
      contention behavior under competing PR/main traffic: to measure in Lot 3.

## Queue waits and delivery elapsed (reference attempt 1)

- [x] Ready-to-dispatch wait (job creation to start): 59 execution waits,
      p50 63s, max 972s (study anchor: 877s E2E ready-to-start wait).
      The previous 84 waits / p50 3s included 25 skipped nonexecutions.
      Missing job readiness remains null; workflow creation is never a substitute.
- [x] Workflow creation (2026-10-18T09:04:42Z) to endpoint completion:
      `publish-api-image` 1775s, `deploy-preprod` 1893s,
      `publish-cluster-mesh` 1392s, `publish-llm-mesh` 737s.
- [x] Endpoint gaps stay explicit: the images endpoint is partial because
      `publish-ui-image` was skipped with inverted stamps (started
      09:30:52Z, completed 09:30:51Z); cache identities are all to-measure
      (the Jobs API exposes no cache field; captures may attach `cache`).
- [x] Selected matrix identities observed: 15 `test-api-unit-integration`
      members plus 5 `test-e2e` groups (20 expanded names); step spans
      emitted per API step through `make ci-run-metrics`. Example: run
      `39113919235`, attempt 1, `changes` job `117635669586`, job span 8s,
      checkout step 2s. Run/attempt/job IDs and step numbers accompany spans.

## Round-2 correction evidence

| Finding | Implementation and qualification | Remaining acceptance |
| --- | --- | --- |
| R2-1 / R1-2: disconnected expected results | `changes` retains the actual workflow/matrix manifest before dispatch; the gate invokes the Make evaluator on fresh attempt Jobs API rows plus the full declared needs context. Exact-script tests reject omitted/skipped selected members and unconditional validators; unselected members pass. | Exact pushed-head CI receipt. |
| R2-2 / R1-3: invalid queue distribution | 59 reference execution waits, p50 63s; skipped rows excluded; absent readiness is null. | None for the metric defect. |
| R2-3 / R1-3: absent step output | The Make CLI emits identified job/step spans; the workflow retains raw API and metrics artifacts. The 58s Test CLI fixture and the 8s real changes-job receipt are qualified. | Final gate duration requires a post-run capture. |
| R2-4 / R1-4: finite-capacity acceptance | Open: metrics now retain admission, budget-breach, cancellation-ownership, and release-continuity receipts (30 Docker metrics tests), but no account quota, release reservation, registry cost, concurrent current-main delivery, or rollback drill is proven. | BR-77: the agent inventories quotas/costs itself via the GitHub API, then qualifies the bounded policy with concurrent-run/rollback receipts and budgets. |
| R2-5: skipped delivery endpoints | Skipped rows are explicitly unselected; delivery elapsed stays null for zero/inverted timestamps; mixed execution sets are partial. | None for the metric defect. |

The real reference's 972s queue wait belongs to job `117636581206`
(`test-api-unit-integration` AI member), run `39113919235`, attempt 1.
This exceeds the 60s scheduling budget by itself; it does not qualify the
new policy under declared concurrent traffic. BR-77 retains
responsibility for Lot 2/3; no finite-capacity acceptance is claimed here.

Replaying review run `39186952208`, attempt 1, head
`d1c38a512befa26b9f6f61001a4af924a532c5b7`, through the delivered Make
entry points reconciles 58 required members for the supplied full-validation
selection. Metrics retain 86 rows, 60 executions and 26 skipped rows;
execution queues have p50 74s / max 618s. The two image publishers and
preproduction are explicitly unselected with null delivery elapsed.

Round-3 capacity receipts: `admissionDecision`, `budgetVerdict`,
`cancellationOwnership`, and `releaseContinuity` are qualified (25 Docker
metrics tests) and emitted by `make ci-run-metrics` from optional capture
inputs. Review round 3 reports exact-head run `39200650498`, attempt 1,
breaches to retain: `changes` job `117892738937` queued 383s against the
60s scheduling budget; `ci-gate` job `117904173351` took 12s against the
5s verdict budget; 60 execution queue samples read p50 542s, max 1140s
(`validate-idp-sync` job `117894386049`). Reference peak 17 against the
hypothesized 24 slots with a 2-slot release reserve reads admitted
(headroom 5); slots remain undeclared, so live admission stays to-measure.
Owner quota/reservation/cost inventory, concurrent PR/main qualification,
and the rollback drill remain open under BR-77 (Lot 2/3 moved out of this PR).

## Review-fix record

- [x] Sol round-1 review of head `17e2098e` returned CHANGES with 7 findings;
      the required job `validate-publishable-manifests` failed in run
      `39183279228` attempt 1 (job `117840652994`) on the gate wiring
      invariant. Fixed by aggregating the receipt job into `ci-gate.needs`
      without a gate dependency; wiring qualification is 22/22.

## Budgets under watch (to measure, never claimed)

- [ ] Classification <= 15s; verdict <= 5s; aggregate critical-path
      scheduling <= 60s under declared concurrent traffic.
- [ ] Contention budgets and rollback drill (BR-77): owner is the BR-77
      agent; failures will be recorded here with run/attempt/job IDs.
