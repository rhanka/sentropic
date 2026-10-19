# CI/CD capacity — measured inventory (BR-76)

Status: measurement record with reconciled receipts; account quota, registry
cost, contention budgets, and the rollback drill remain to measure.
Source base: `81deb7bd78d99bca8d51f67c4f1d4424fb772d75`.
Reference run: Main `39113919235` attempt 1 (84 job rows, 59 measured,
25 skipped; attempts 1+2 deduplicate to 110 executions, 58 carried-forward
copies dropped). Receipts below come from `make ci-run-metrics` on the
captured attempt-1 rows reconciled against the Jobs API.

## Observed runner classes

- [x] Every job in the reference run executed on `ubuntu-latest` (GitHub-hosted).
- [ ] Self-hosted runner classes: none observed; to measure if introduced.
- [ ] OS/image variants per lane: to measure at implementation time.

## Account quotas and reservation

- [ ] Concurrent-job quota of the account: to measure (no API receipt captured yet).
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
- [x] Cancellation ownership is labelled in the gate (`CI gate cancelled`
      annotation) and unexpected skips block the verdict.
- [ ] Concurrent PR/main receipt: pending branch CI on this branch.

## Cost and peak demand

- [x] Runner-minutes on the reference attempt: 148.25 total across measured
      spans (billing export not yet attached; union with attempt 2: 149.1).
- [ ] Registry and transfer cost: to measure.
- [x] Peak demand window: reference run sustained 17-way executed overlap;
      contention behavior under competing PR/main traffic: to measure in Lot 3.

## Queue waits and delivery elapsed (reference attempt 1)

- [x] Ready-to-dispatch wait (job creation to start): 84 measurable waits,
      p50 3s, max 972s (study anchor: 877s E2E ready-to-start wait).
- [x] Workflow creation (2026-10-18T09:04:42Z) to endpoint completion:
      `publish-api-image` 1775s, `deploy-preprod` 1893s,
      `publish-cluster-mesh` 1392s, `publish-llm-mesh` 737s.
- [x] Endpoint gaps stay explicit: the images endpoint is partial because
      `publish-ui-image` was skipped with inverted stamps (started
      09:30:52Z, completed 09:30:51Z); cache identities are all to-measure
      (the Jobs API exposes no cache field; captures may attach `cache`).
- [x] Selected matrix identities observed: 15 `test-api-unit-integration`
      members plus 5 `test-e2e` groups (20 expanded names); step spans
      recorded per API steps.

## Review-fix record

- [x] Sol round-1 review of head `17e2098e` returned CHANGES with 7 findings;
      the required job `validate-publishable-manifests` failed in run
      `39183279228` attempt 1 (job `117840652994`) on the gate wiring
      invariant. Fixed by aggregating the receipt job into `ci-gate.needs`
      without a gate dependency; wiring qualification is 22/22.

## Budgets under watch (to measure, never claimed)

- [ ] Classification <= 15s; verdict <= 5s; aggregate critical-path
      scheduling <= 60s under declared concurrent traffic.
- [ ] Contention budgets and rollback drill (Lot 3): owner is the branch
      author; failures will be recorded here with run/attempt/job IDs.
