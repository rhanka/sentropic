# Q1 cluster-mesh fixture rebind

- Failed check: `validate-cluster-mesh`, PR #834, job
  [123314702961](https://github.com/rhanka/sentropic/actions/runs/40829771749/job/123314702961).
- Full job log retrieved with `gh api repos/rhanka/sentropic/actions/jobs/123314702961/logs`.
- Root cause: the required llm-mesh bump to 0.32.2 left the independently
  authored cluster-mesh train literal and frozen selected consumer at 0.32.1.
- Local reproduction on the original source snapshot: 3 failed, 1,225 passed,
  138 skipped. The failures match CI exactly:
  `integrations/gateway-surface.spec.ts`, `integrations/llm-surface.spec.ts`,
  and `packaging/prepare-artifacts.spec.ts`.
- Repair: rebind the train literal, selected manifest, and selected lock to
  0.32.2. Keep exact version assertions, registry URL, SHA-512 integrity,
  historical/skew fixtures, and all production admission gates intact.
- Built with `make build-llm-mesh`; packed and inspected with
  `make pack-publishable-manifest PACKAGE=llm-mesh PACK_DESTINATION=tmp/q1-rebind`.
  A temporary Make target updated only the selected lock's llm-mesh entry
  and direct dependency from those archive bytes; no dependency resolution drift.
- Guarded archive SHA-256:
  `e20337b261f4e2ebb41625126e8f7ec8b67bfcffa58a66f2b561b66c51d9ee23`.
- Selected lock SHA-512:
  `sha512-lglyUWQUyEGyzFXwmp/he1j0w2G5aBSpQZR8OmDt9j9fWEGP0bz9oYo79avk6T/Tlnw5khBQDU8OJXRMPwpUNw==`.
- Docker operations serialized with `flock` on
  `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`;
  `ENV=test-decision-q1` is the last Make argument.
- No further provider calls; original live receipts and attempt caps preserved.
- Validation: `make test-cluster-mesh scope-check API_PORT=8802 UI_PORT=5202
  MAILDEV_UI_PORT=1102 ENV=test-decision-q1` passed: 142 files, 1,228 tests,
  138 expected skips (unchanged from the failing command), harness C2 passed.
- Cleanup: `make down API_PORT=8802 UI_PORT=5202 MAILDEV_UI_PORT=1102
  ENV=test-decision-q1` completed successfully under the same flock.
