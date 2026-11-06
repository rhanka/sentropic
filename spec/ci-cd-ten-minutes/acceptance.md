# BR-84 measured acceptance — OPEN

The ten-minute claim is **not accepted**. All timings are real GitHub API
observations or explicitly marked incomplete; budgets are not measurements.
The wagon starts at train `01429a910` and is rebased onto main `165ce5b93`,
the merge of [#930](https://github.com/rhanka/sentropic/pull/930).

## Baseline

The retained input contains 33 exact attempt-1 captures, including failures,
cancellation and two active executions. Fourteen successful baseline executions
have complete job-result membership. Cache/case profiles, test identities,
production artifact tuples and provider cost remain unqualified; those samples
do not establish the planned acceptance campaign.

| Baseline cohort | n | Median | p90 | p95 | Maximum |
| --- | ---: | --- | --- | --- | --- |
| PR | 9 | 19m29s | 22m22s | 22m22s | 22m22s |
| main | 5 | 17m29s | 19m02s | 19m02s | 19m02s |

Latest #930 PR: [42300540682/1](https://github.com/rhanka/sentropic/actions/runs/42300540682),
source `01429a91085e53602ec572d40045cecdeccff452`. Workflow wall 1,342s;
successful qualification 1,326s; workflow gap to 600s **742s**.

| Critical-path job | Job ID | Execution | Ready queue | Scheduling including handoff/admission |
| --- | --- | ---: | ---: | ---: |
| changes | 128177235531 | 19s | 2s | 53s |
| build-api-tool-image | 128177401215 | 320s | 2s | 3s |
| test-api-unit-integration (unit) | 128179794335 | 567s | 3s | 3s |
| ci-capacity-receipts | 128184083796 | 21s | 17s | 18s |
| ci-gate | 128184376147 | 18s | 303s | 304s |

The observed qualification path contains 945s execution and 381s cumulative
scheduling. Parallel jobs are not added. API static was 682s (job 128177400086),
artifacts 554s (128177401105), API image 234s (128177400972). API static logs
show repeated preparation; the unit lane serialized a 233.53s/30-file app host
qualification before a 203.55s/186-file unit run. Toolbox cache export alone
took 113.7s inside its 320s complete readiness span.

## First after execution

[42306459107/1](https://github.com/rhanka/sentropic/actions/runs/42306459107)
is a manual qualification of `791150e53ec795e9fd02c955e1f19228d5b156e1`,
not a PR sample or qualification of the final wagon head. At the retained
23:02:22Z snapshot its wall was **at least 1,326s**, gap **at least 726s**.
The complete wall/qualification endpoints remain unmeasured at that snapshot.

| Job | Before execution | After execution | After job | After queue |
| --- | ---: | ---: | --- | ---: |
| API static | 682s | 138s | 128203530985 | 84s |
| UI static | 268s | 206s | 128197111512 | 588s |
| Toolbox | 320s | 321s | 128197111713 | 639s |
| Artifacts, formerly serialized | 554s | package 417s / dossier 365s | 128197111576 / 128197111561 | 375s / 443s |

These are individual observed spans, not additive savings or an isolated cache
experiment. Full head-to-head acceptance remains open. The first dispatch also
exposed missing `VERIFY_BASE` on manual events (consumer job 128200274468);
the verifier now receives the default-branch base and its real local invocation
passes without weakening selection. This failure remains in the input.

Main [42304697239/1](https://github.com/rhanka/sentropic/actions/runs/42304697239),
source `165ce5b932206bcd89e6374f5b80d970cd1d19b6`, was still active at
23:02:24Z: wall at least 2,171s, gap at least 1,571s. Its measured maximum
job queue was 1,492s. The repository runner inventory reports zero self-hosted
runners; hosted account quota/reserved capacity is not established by that API.

## Qualification and remaining work

- Complete API/IdP compiler and API linter programs use the exact toolbox;
  UI checks and IdP web typecheck/build share their preparation.
- Unit files run in two shards, endpoints in eight, and the unchanged app host
  selection in two isolated shards. Both app shards retain content checks.
  Artifacts and dossier qualification run on separate required matrix members.
- Expected-result/DAG fixtures reject missing members; no assertions, tests,
  retry limits, security checks or production identity checks are removed.
- The portable dossier uses the retained private DS generator and theme, one
  measured dependency model, controls inside the canvas, expanded members/steps,
  real source links and explicit missing data. Exported HTML is a build artifact.
- Local qualification: 36 metrics, 8 performance, 28 expected-result, 8 DAG,
  11 lock-install tests; TypeScript/Svelte, ESLint, portable build, 2 path tests
  and 23 browser controls pass. Production image/test stacks run in CI.
- Owner: **CI maintainers / train conductor**. Establish hosted admission and
  sufficient reserved ready capacity; prove aggregate critical-path scheduling
  ≤60s under concurrent PR/main traffic. Do not infer quota from a study constant.
- Complete the final-head CI and consolidated train review, then collect ≥30
  qualified after full-product executions across every planned case/cache/traffic
  profile, including actual PR and main events and fresh selected publications.
  Preserve exact test/artifact tuples, retries, all breaches and daily live results.
- Rollback/claim withdrawal: acceptance stays OPEN and
  `make ci-performance-report REQUIRE_PROOF=1 ENV=test-ci-ten-minute-proof`
  rejects this evidence. Reverting workflow and its Make recipes together restores
  scheduling without deleting captures or weakening complete-result checks.

Reproduce with `make ci-performance-report ENV=test-ci-ten-minute-proof`;
machine output adds `CI_PROOF_JSON=1`. Capture and retain via
`ci-performance-capture`, `ci-performance-receipt`, `ci-performance-retain`.
The designated conductor imports this plan/evidence into Track; this wagon does
not write the shared event log. No PR is opened.
