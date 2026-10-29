# App cluster-mesh W0 records

**Status: reconciled 29 October; W0 not accepted.** W0-close.a supplies B01/B02/B04 and B06's control **0020** reservation. W0-close.b comes from [#756](https://github.com/rhanka/sentropic/pull/756) on main; current W0-close.d tuple/qualification comes from [#796](https://github.com/rhanka/sentropic/pull/796) on integration, linked in [baseline.md](baseline.md). The local 18/26 October d files remain historical. **W0-close.c / B03 local recovery DONE per owner decision:** [live production dump restored locally](../../runbooks/app-cm-baseline-restore/receipts/restore-local-20261029T084403Z.md) in `test-app-w0c`; schema, 91 table counts and authority state match, then environment/volume/dump removed. This does not validate the S3 backup object or runtime revoked-reader enforcement. K8s-target/bucket prerequisites are withdrawn for c. B08 final-head reconciliation remains open; [authorization.md](authorization.md) retains acceptance and production gates, and [owner decisions](owner-decisions.md) retain F3/F4 decisions.

| Record | Purpose |
|---|---|
| [baseline.md](baseline.md) | Pinned source/owner GO, runtime unknowns, observed public endpoints, domains and legacy content sources |
| [endpoint-config-2026-10-26.md](endpoint-config-2026-10-26.md) | Current live routing/pods, public endpoint hashes, ConfigMap/template/container-environment hashes, metadata-only Secret revisions |
| [package-authority-2026-10-26.md](package-authority-2026-10-26.md) | Current package-journal absence and full cutover/author/generation/lease inventory; no positive fence inferred |
| [legacy-inventory-2026-10-26.md](legacy-inventory-2026-10-26.md) | Current anonymized scoped inventory, 14 object checksums/private ACLs and explicit leave-in-place decisions, including 4 excluded unscoped chat messages |
| [published-tuple-2026-10-26.json](published-tuple-2026-10-26.json) | Historical 26 October 0.2.0/0.22.1 tuple; superseded for d by the #796 references in baseline.md |
| [published-fit-2026-10-26.json](published-fit-2026-10-26.json) | Passing strict published install, whole installed resolved tree, actual Comments/gateway load/shared topology and exact four-tool profile |
| [owner-decisions.md](owner-decisions.md) | Verbatim Q1–Q4 answers superseding the original staffing/window and signer/key choices |
| [cluster-readings.md](cluster-readings.md) | Dated inactive-cluster metadata, hashes, actual RBAC denials and exact missing serving-cluster/DB/object access |
| [tenant-readings-2026-10-21.md](tenant-readings-2026-10-21.md) | Owner-authorized tenant GETs: prod/preprod/remote digests, pod/controller identities, content-role absence and config names/resourceVersions; B02/B03 pending |
| [recovery-readings.md](recovery-readings.md) | Existing CI SQL restore metadata, offline archive/frontier/count observations and their limits |
| [published-tuple.json](published-tuple.json) | Preserved historical 18 October selectors/lock hashes; current d authority is linked in baseline.md |
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

The existing qualification Compose service pins Node 24; historical selectors remain defaults. The 26 October probe uses `W0_HOST_PROBE=published-fit-probe.mjs` and the historical package arguments in [host-fit.md](host-fit.md); its strict fit passed with a 175-package install and cleanup. Reproduce current d through the linked #796 qualification receipt. Generated output stays under ignored `tmp/app-cm-w0-probe`; original public vectors stay unchanged. Fresh installs can resolve newer transitives; retained lock/tree hashes identify their dated observations. W2/W3 still qualify the whole app workspace/image.

`w0-record-check` preserves the original source/vector verification at `published-tuple.json.sourceSha`; it does not qualify the integrated workspace or replace the new published-fit receipt. W2.b owns final source/lock reconciliation; W3 verifies the actual pruned image. No W0-authored package/lock/deployment change is made here.
