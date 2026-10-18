# App cluster-mesh W0 records

**Status: prepared, not accepted.** The published tuple and implementation contracts are frozen; production/preprod running digests, live authorities/frontiers, historical-data disposition, named operators/windows, trusted acceptance signer and independent R acceptance remain pending. [authorization.md](authorization.md) names B01–B08, responsible roles, resolution windows and observable gates. Do not dispatch on this draft as if those receipts existed.

| Record | Purpose |
|---|---|
| [baseline.md](baseline.md) | Pinned source/owner GO, runtime unknowns, observed public endpoints, domains and legacy content sources |
| [published-tuple.json](published-tuple.json) | Exact published selectors/integrities, all nine selected cluster peers, source lock/config hashes and explicit null live digests |
| [host-fit.md](host-fit.md) | W2 host-owned registry, unchanged URLs/resource semantics, prototype boundary and acceptance files |
| [catalog-context.md](catalog-context.md) | W4 authoritative request/turn context, current uncached tenant resolver, all affected signatures/callers and auth tests |
| [promotion-contract.md](promotion-contract.md) | P canonical signing/verifier pin, public trust source contract, manifest and native Environment gates |
| [verifier-vectors.json](verifier-vectors.json) | Public fixture vectors; no release-authorized key or production acceptance |
| [reservations.md](reservations.md) | Control 0017, isolated port triples, T1/T2/T3/T4/TG/T5 order, file writers, EX1/EX2 handoffs and forecast |
| [authorization.md](authorization.md) | Owner/operator/signer/review dependencies and per-action authorization register |

## Verification and reproduction

Executed checks: registry GET selectors/integrities; published-package fixture compilation of 15 artifact tools; one Hono invoke and one resource read at the current URL; 1 positive/3 negative h2a signature vectors; verification of frozen vector bytes, canonical manifest hash, verifier implementation hashes, source hashes and local record links. Scope C2 passed before every commit; each commit is at most 150 changed lines. No application API/UI/E2E/security suite was run for this records-only branch, and these checks do not qualify real storage, identity, connector effects or deployment.

Reproduce from the repository root using the committed Docker-only helper (no production credentials or service ports):

```sh
rtk make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-host-fit ENV=test-app-cm-w0
rtk make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-record-check ENV=test-app-cm-w0
```

The helper pins the observed Node 24 image digest, installs exact selectors with scripts disabled in a disposable container, and writes output only under ignored `tmp/app-cm-w0-probe`. Generated vector keys are ephemeral fixtures; committed vectors stay unchanged. The probe's full transitive install-lock hash identifies the original collection; a fresh install can resolve newer dependencies within upstream ranges. Future release qualification must freeze its own complete lock and physical image tree. The source-hash check intentionally fails if the pinned baseline sources have changed.
