# App cluster-mesh W0 records

**Status: evidence extended 26 October; not accepted.** W0-close.a/d supplies B01 endpoint/config hashes, B02 package/authority state, B04 current scoped legacy inventory/disposition and B06's verified-free control **0020** reservation, replacing app 0017 while preserving #677's 0012–0019. **B03 checkpoint/isolated recovery and B08 independent final-head review remain open**; restore b/c was not performed. UP-T's missing published durable activation implementation/receipt gates W1.c separately. [authorization.md](authorization.md) distinguishes those from later runtime, enrollment, infrastructure and promotion gates. The [verbatim owner answers](owner-decisions.md) still settle F3/F4 human-role/key choices.

| Record | Purpose |
|---|---|
| [baseline.md](baseline.md) | Pinned source/owner GO, runtime unknowns, observed public endpoints, domains and legacy content sources |
| [endpoint-config-2026-10-26.md](endpoint-config-2026-10-26.md) | Current live routing/pods, public endpoint hashes, ConfigMap/template/container-environment hashes, metadata-only Secret revisions |
| [package-authority-2026-10-26.md](package-authority-2026-10-26.md) | Current package-journal absence and full cutover/author/generation/lease inventory; no positive fence inferred |
| [legacy-inventory-2026-10-26.md](legacy-inventory-2026-10-26.md) | Current anonymized scoped inventory, 14 object checksums/private ACLs and explicit leave-in-place decisions, including 4 excluded unscoped chat messages |
| [published-tuple-2026-10-26.json](published-tuple-2026-10-26.json) | Current published 0.2.0/0.22.1 tuple, workspace-source base/full-lock reference, package members, APP-P1 digest and W2 lock turn |
| [published-fit-2026-10-26.json](published-fit-2026-10-26.json) | Passing strict published install, whole installed resolved tree, actual Comments/gateway load/shared topology and exact four-tool profile |
| [owner-decisions.md](owner-decisions.md) | Verbatim Q1–Q4 answers superseding the original staffing/window and signer/key choices |
| [cluster-readings.md](cluster-readings.md) | Dated inactive-cluster metadata, hashes, actual RBAC denials and exact missing serving-cluster/DB/object access |
| [tenant-readings-2026-10-21.md](tenant-readings-2026-10-21.md) | Owner-authorized tenant GETs: prod/preprod/remote digests, pod/controller identities, content-role absence and config names/resourceVersions; B02/B03 pending |
| [recovery-readings.md](recovery-readings.md) | Existing CI SQL restore metadata, offline archive/frontier/count observations and their limits |
| [published-tuple-2026-10-18.json](published-tuple-2026-10-18.json) | Preserved historical 18 October selectors/lock hashes |
| [published-tuple.json](published-tuple.json) | Refreshed 27 October workspace-source tuple, APP-P1 digest and complete resolution |
| [host-fit.md](host-fit.md) | W2 host-owned registry, unchanged URLs/resource semantics, prototype boundary and acceptance files |
| [catalog-context.md](catalog-context.md) | W4 authoritative request/turn context, current uncached tenant resolver, all affected signatures/callers and auth tests |
| [promotion-contract.md](promotion-contract.md) | P canonical signing/verifier pin, public trust source contract, manifest and native Environment gates |
| [verifier-vectors.json](verifier-vectors.json) | Public fixture vectors; no release-authorized key or production acceptance |
| [reservations.md](reservations.md) | Verified-free control 0020, 747-ref/263-worktree scan, exact branch bases, W2 lock writer, port triples and historical train/forecast |
| [authorization.md](authorization.md) | Owner/operator/signer/review dependencies and per-action authorization register |

## Verification and reproduction

Executed checks: registry GET selectors/integrities; published-package fixture compilation of 15 artifact tools; one Hono invoke and one resource read at the current URL; 1 positive/3 negative h2a signature vectors; verification of frozen vector bytes, canonical manifest hash, verifier implementation hashes, source hashes and local record links. Scope C2 passed before every commit; W0-authored record commits are at most 150 changed lines, with the requested upstream merge's inherited diff recorded under BR142-EX2. No application API/UI/E2E/security suite was run for this records-only branch, and these checks do not qualify real storage, identity, connector effects or deployment.

Historical probes can be reproduced from the worktree root using the committed Compose helper. Every container/test command holds the shared lock and each step is followed by matching cleanup; no production credentials or listeners:

```sh
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-host-fit ENV=test-app-w0
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f docs/baselines/app-cm-w0/probe.mk down ENV=test-app-w0
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-record-check ENV=test-app-w0
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f docs/baselines/app-cm-w0/probe.mk down ENV=test-app-w0
```

The existing qualification Compose service pins Node 24; historical selectors remain defaults. For the current tuple, use `W0_HOST_PROBE=published-fit-probe.mjs` and the exact package arguments in [host-fit.md](host-fit.md). The strict fit passed with a 175-package install and cleanup. Generated output stays under ignored `tmp/app-cm-w0-probe`; original public vectors stay unchanged. Fresh installs can resolve newer transitives; retained current/historical lock/tree hashes identify their observations. W2/W3 still qualify the whole app workspace/image.

`w0-record-check` preserves every original source/vector assertion against `published-tuple-2026-10-18.json`. It also checks the refreshed `published-tuple.json` against `tuple-vectors-2026-10-27.json`, regenerated by `w0-refresh-record`: exact receipt hashes, frozen-source inputs, complete current lock, package versions and APP-P1 profile/manifest. Historical signature fixtures remain unchanged. This check does not replace transport/MCP/API startup qualification or W3's pruned-image proof.
