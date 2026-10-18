---
status: completed
agent-sig: 7f3a9c2e1b
role: CODER
pr: https://github.com/rhanka/sentropic/pull/689
review-round: 1
review: pr689_astra.md
reviewed-head: 749b08901254278b142f53e04dadb1ccc53ba55c
---

# PR 689 review treatment

Finding 1 (P2), complete identity validation before insufficient-scope challenges:
**accepted and fixed**. No findings were rejected or deferred.

The provider checked ingress scopes before the composition checked exact single
audience, required subject/expiry, conflicting client claims and configured ACR.
The fix verifies the token without scope requirements, completes those identity
and assurance checks, then uses the provider's `McpAuthError` with missing scopes.
The existing provider challenge formatter retains canonical `resource_metadata`.
Valid identities missing `immo:read` still receive 403 `insufficient_scope`.

Five parameterized regressions cover the review's multiple audiences, missing
subject, missing expiry, conflicting clients and missing assurance. Each runs
with and without the required scope, checks 401 `invalid_token`, the expected
description and canonical metadata, and refuses a scope remedy. The positive
missing-scope control checks 403, `insufficient_scope`, scope and metadata.

All local commands use API 9495, UI 5695, Maildev 1595 and `ENV=test-oauth-o1`.

| Check | Result |
| --- | --- |
| Harness branch; fetch and rebase onto origin/main | PASS; already up to date; no unpushed Muse commits |
| Registry check after rebase | Candidate 0.20.0 exceeds published 0.19.1 |
| `make ps-all` and port ownership | No owned services; assigned ports unused by running containers |
| Test-first composition regression | RED: 5 failed (403 instead of 401), 7 passed before source fix |
| Composition regression after source fix | GREEN: 12 passed |
| Astra independent probes | GREEN: 2 passed; all five combined defects now return 401 |
| Scoped MCP OAuth, typecheck and lint | GREEN: 21 passed; nine packed tests intentionally run separately |
| Full packed matrix | GREEN: 86 passed / 16 files, including all nine OAuth consumer tests |
| Harness scope | PASS C2 |

Packed cluster-mesh 0.20.0 SHA-256:
`d84d56908d6ae1845e44f38ac0807170fc2cdc2bc211b8003b3c0d62e8db70a0`.

Commands: `make test-cluster-mesh SCOPE=tests/mcp-oauth-composition.spec.ts`
(RED then GREEN); `make -f Makefile -f .h2a/reviews/pr689_astra_probes.mk
review-pr689-astra`; `make typecheck-cluster-mesh lint-cluster-mesh
test-cluster-mesh SCOPE=mcp-oauth`. Each command appends the ports and environment
listed above. Full packed gate: `make -f packages/cluster-mesh/packaging.mk
test-lazy-package` with the same arguments.

The previous packaging correction is already in the reviewed head: the installed
NodeNext/Bundler full-library compiler tests have a local 30-second budget.
The current successful CI log was read with `gh run view 39170521943 --job
117802453387 --log`; it includes the nine OAuth packed-consumer tests and the
candidate install qualification. The older failed run's jobs endpoint returned
HTTP 502 on both retrieval attempts. No compiler check or runtime assertion was
removed, and no E2E timeout was changed.

Only challenge ordering changes. Accepted R4 optional-client ingress, exact
originating-client exchange restrictions, sessions and provider APIs remain as
reviewed. Operational IdP/Radar/restore receipts retain their existing owners.
No merge or publication is authorized or performed.
