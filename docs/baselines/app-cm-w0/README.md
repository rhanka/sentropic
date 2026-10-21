# App cluster-mesh W0 records

**Status: prepared, not accepted.** The [verbatim owner answers](owner-decisions.md) settle F3/F4 owner decisions: owner holds all human roles with agent execution, no staffed windows/temporal slot bookings are required because there are no users, owner signs acceptance, and a dedicated identity/key will be enrolled in a later authorized action. W0 acceptance still needs F1/B01–B03 deployment/recovery evidence, F2/B04 current content inventory/disposition, B06 nonlocal migration-0017 reconciliation and B08 independent final-head review. [authorization.md](authorization.md) separates those blockers from later enrollment, infrastructure and promotion gates. Technical rollback remains required.

| Record | Purpose |
|---|---|
| [baseline.md](baseline.md) | Pinned source/owner GO, runtime unknowns, observed public endpoints, domains and legacy content sources |
| [owner-decisions.md](owner-decisions.md) | Verbatim Q1–Q4 answers superseding the original staffing/window and signer/key choices |
| [cluster-readings.md](cluster-readings.md) | Dated inactive-cluster metadata, hashes, actual RBAC denials and exact missing serving-cluster/DB/object access |
| [tenant-readings-2026-10-21.md](tenant-readings-2026-10-21.md) | Owner-authorized tenant GETs: prod/preprod/remote digests, pod/controller identities, content-role absence and config names/resourceVersions; B02/B03 pending |
| [recovery-readings.md](recovery-readings.md) | Existing CI SQL restore metadata, offline archive/frontier/count observations and their limits |
| [published-tuple.json](published-tuple.json) | Exact published selectors/integrities, all nine selected cluster peers, source lock/config hashes and explicit null live digests |
| [host-fit.md](host-fit.md) | W2 host-owned registry, unchanged URLs/resource semantics, prototype boundary and acceptance files |
| [catalog-context.md](catalog-context.md) | W4 authoritative request/turn context, current uncached tenant resolver, all affected signatures/callers and auth tests |
| [promotion-contract.md](promotion-contract.md) | P canonical signing/verifier pin, public trust source contract, manifest and native Environment gates |
| [verifier-vectors.json](verifier-vectors.json) | Public fixture vectors; no release-authorized key or production acceptance |
| [reservations.md](reservations.md) | Control 0017, isolated port triples, T1/T2/T3/T4/TG/T5 order, file writers, EX1/EX2 handoffs and forecast |
| [authorization.md](authorization.md) | Owner/operator/signer/review dependencies and per-action authorization register |

## Verification and reproduction

Executed checks: registry GET selectors/integrities; published-package fixture compilation of 15 artifact tools; one Hono invoke and one resource read at the current URL; 1 positive/3 negative h2a signature vectors; verification of frozen vector bytes, canonical manifest hash, verifier implementation hashes, source hashes and local record links. Scope C2 passed before every commit; W0-authored record commits are at most 150 changed lines, with the requested upstream merge's inherited diff recorded under BR142-EX2. No application API/UI/E2E/security suite was run for this records-only branch, and these checks do not qualify real storage, identity, connector effects or deployment.

Reproduce from the repository root using the committed Docker-only helper (no production credentials or service ports):

```sh
rtk make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-host-fit ENV=test-app-cm-w0
rtk make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-record-check ENV=test-app-cm-w0
```

The helper pins the observed Node 24 image digest, installs exact selectors with scripts disabled in a disposable container, and writes output only under ignored `tmp/app-cm-w0-probe`. Generated vector keys are ephemeral fixtures; committed vectors stay unchanged. The probe's full transitive install-lock hash identifies the original collection; a fresh install can resolve newer dependencies within upstream ranges. Future release qualification must freeze its own complete lock and physical image tree.

After the owner-requested main integration, root `package-lock.json` includes upstream artifacts 0.1.2 changes. `w0-record-check` exports the original source files from the exact `published-tuple.json.sourceSha` into ignored `baseline-source`, asserts that pin matches, and checks their frozen hashes while validating the current W0 vectors and record links. It does not qualify the integrated main lock or a replacement published tuple. W1 must reconcile its consumed release and full lock before downstream qualification; the dated 0.1.1 observation is retained unchanged.
