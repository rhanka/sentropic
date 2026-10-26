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
the unverified 24-worker hypothesis or an account quota. Two slots are the
declared release allowance; the per-run DAG must demand at most 15 slots.
This is a repository dispatch bound, not a provisioned runner reservation:
other runs/repos can still consume shared hosted capacity. Concurrent-run
admission must compare the combined measured peak against that lower bound;
it cannot be accepted from this static per-run check alone.

`make ci-capacity-policy` computes the maximum weighted antichain of the
actual workflow dependencies (matrix weights respect `max-parallel`). It
fails above 15 slots. The expected manifest also retains those dependencies
so queue waits can be summed along identified observed critical paths.

## BR-77 policy and live qualification

The active policy staggers package validation in two dependency lanes,
ordinary npm publication in one lane, and API/E2E matrices at widths 2/2.
The existing mesh → gateway → cluster train, bootstrap, publication guards,
Mistral routing and E2 integration qualification are preserved. Chained
validators override automatic dependency-skip propagation; publishers also
refuse upstream failure/cancellation. Complete selected-result enforcement
remains mandatory. The PR and main full-selection DAG bounds both read 15.

| Receipt | Identified observation | Acceptance |
| --- | --- | --- |
| New-base baseline | Main `40341027258`, attempt 1, source `440599d04e91bb33e3874588f067c6a90bffd1b3`: 89 rows, 68 measured, 21 skipped; peak 15; 211.15 runner-minutes; execution queue p50 111s, max 882s. | Jobs API baseline, not the bounded policy's result. |
| Baseline endpoints | Qualification 2288s; selected images 2128s; preproduction 2254s; cluster publication 1879s from workflow creation. Classification job `121635441567` 18s; gate `121657161589` 14s. | Classification/verdict budgets breached; no fresh npm-publication claim. |
| Superseded PR | `40352448337`, attempt 1, head `0a1eb32ea873a48b71833d163537719dae1e2bb1`, automatically cancelled when rollback head was pushed; 57 identified cancelled rows. Gate `121681630885` failed as required. Classification `121675860608` 21s; gate 19s. | Cancellation observed; 15s/5s budgets breached. |
| Conservative rollback | Head `474e023163fd1be0b2f0ac7f33442c2d97dc561c`, run `40353670942`, attempt 1: one package validation lane, API/E2E 1/1; static bounds PR 13 / main 14. Classification `121682062979` 20s. | Live dispatch observed; classification breached. Restore the qualified bounded policy afterwards. |
| Concurrent release | Main `40341027258`, attempt 2, same source: completed successfully through both PR supersessions. 89 rows / 68 executions / 21 skipped; peak 12; 210.45 runner-minutes; execution queues p50 383s / max 860s. | All four selected endpoints continuous. Classification `121676338012` 19s; gate `121701213010` 19s; critical-path scheduling 1559s: all three budgets breached. |
| Concurrent endpoints | Main attempt 2: qualification 2750s; selected images 2359s; preproduction 2534s; selected packages 2477s. Longest qualification-path wait: `smoke-idp-screens` job `121684322205`, 860s. | Completed measured delivery, not a ten-minute result or a fresh npm-publication sample. |

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
