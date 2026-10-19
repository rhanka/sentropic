# CI/CD capacity — measured inventory (BR-76)

Status: initial measurement record; quotas and cost remain to measure.
Source base: `81deb7bd78d99bca8d51f67c4f1d4424fb772d75`.
Reference run: Main `39113919235` attempt 1 (84 job rows, 59 measured, 25 skipped).

## Observed runner classes

- [x] Every job in the reference run executed on `ubuntu-latest` (GitHub-hosted).
- [ ] Self-hosted runner classes: none observed; to measure if introduced.
- [ ] OS/image variants per lane: to measure at implementation time.

## Account quotas and reservation

- [ ] Concurrent-job quota of the account: to measure (no API receipt captured yet).
- [ ] Roughly 24 workers is a study hypothesis, not a provisioned fact.
- [ ] Measured concurrency peak on the reference run: 18 simultaneous measurable jobs.
- [ ] Reservation policy for release lanes: to measure; no reservation exists yet.

## Scheduling priorities and cancellation ownership

- [x] PR attempts cancel only superseded attempts of the same ref (workflow
      concurrency, `cancel-in-progress` on `pull_request` only).
- [x] Main releases never cancel: `cancel-in-progress: false` on every
      concurrency group, including `api-image-publication` and `npm-publish-train`.
- [ ] Concurrent PR/main receipt: pending branch CI on this branch.

## Cost and peak demand

- [ ] Runner-minutes per profile/case: to measure (scripts record spans; billing
      export not yet attached).
- [ ] Registry and transfer cost: to measure.
- [ ] Peak demand window: reference run sustained 18-way overlap; contention
      behavior under competing PR/main traffic: to measure in Lot 3.

## Budgets under watch (to measure, never claimed)

- [ ] Classification <= 15s; verdict <= 5s; aggregate critical-path
      scheduling <= 60s under declared concurrent traffic.
- [ ] Study anchor: 877s E2E ready-to-start wait on the Main example.
