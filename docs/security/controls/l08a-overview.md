# ACT-L08a same-repo control and deadline (activation amendment r6, row ACT-L08a).
#
# Deliverable: same-repo public control, report writer and deploy-key rulesets,
# pinned control image, off and enable, DeadlineStatusV1 and daily deadline trigger.
# Live credentials, deploy keys, environments and image digests are provisioned
# at qualification time by their section 4.5 owners. This lane ships contracts,
# synthetic fixtures and fail-closed behavior only.

## Modules (`scripts/security/daily/`)

- `canonical-json.mjs`: canonical JSON and lowercase SHA-256 key derivation.
- `job-environment-map.json` / `job-environment-map.mjs`: exhaustive section 4.1
  job-to-single-environment map, twelve reader copies, signing-key placements.
- `control-permit.mjs`: five-second permits, challenge window, placement and
  guardian receipts, single pinned root elevation step.
- `control-clock.mjs`: chronyd and NTS health bounds, 60 and 75 second termination.
- `enable.mjs`: global-off-first enable transactions, off propagation.
- `report-branch-integrity.mjs`: hook-free SSH expected-parent writer, non-force
  push, bounded CAS, ninety-day key rotation.
- `report-format.mjs`: strict DeadlineStatusV1 schema and deterministic renderer.
- `report-transfer.mjs`: anonymous public reads, synthetic-leak quarantine.
- `control-image-pin.mjs`: build, validation and publication receipt chain,
  fail-closed execution pin.
- `control-provisioning.mjs`: section 4.5 L08a rows and loader-kind map.
- `resource-envelope.mjs`: section 7.4 frozen bounds and admission checks.
- `deadline-report.mjs`: 07:30 trigger, first and second shortfalls, fallback issue.
- `acceptance-disposition.mjs`: L08a acceptance enumeration for T6-M1.

## Workflows

- `.github/workflows/security-report-control.yml`: L08a-owned jobs only
  (`deadline-record`, `control-receipt`, `state-intent`, `state-commit`), each in
  `security-report-publish`. Scan-admission, health, review and allocator jobs
  land with ACT-L08b, ACT-L09 and ACT-L03a. The control-image pipeline workflow
  lands with the first reviewed control-image promotion; until then the pin
  refuses every unpinned digest and no control executes.

## Tests

Run `make test-security-daily ENV=test-cyber-L08a`. Every case is synthetic and
credential-free. Live platform proofs (deploy-key pushes, environment grants,
runner topology, issue delivery) stay fenced until qualification and are owned
by the section 4.5 provisioning roles.
