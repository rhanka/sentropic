# E11 tuple preparation and receiving handoff

This is preparation for plan E11, not final E2 acceptance. **gr-conductor owns final manifest generation.** The tooling emits `e2-host-tuple/v1` with `status: PENDING` and refuses `--require-final`. It cannot publish or record an ACK. The author does not change package versions, producer archives, artifacts sources or existing locks.

## Candidate observation

The current #803 `E11 inputs` supersede the historical dev.4 hashes in the [Opus r3 inventory](/home/antoinefa/src/sentropic/.h2a/reviews/pr803_opus_r3.md). Its 21 categories remain the input inventory. The preparation freezes E10 snapshot `afd283ec8054abb4bb16dd74428bb51bea136fcc`, qualified source `cf1e537a8810a49d50d442169474f3b893103e6f`, tree `8b14cca07a28aeaf644bd05b718120a9b29c9321`. The preparation recipe mechanically verifies no packed-source drift between those commits, then archives committed sources rather than the live worktree.

| Candidate | Version | Archive SHA-256 |
| --- | --- | --- |
| Engram | 0.22.0 | `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10` |
| cluster-mesh | 0.24.0-dev.5 | `11a8fe858d1abecde50e003c191a8600db4880f4382c8ce3ffa2bb44c09df8e4` |

Both SHA-512 integrities and package identities are checked against `candidates.mjs` and the retained receipt/consumer lock. A file-list hash alone is insufficient. All five profiles retain `declared`; equivalence retains `not-covered`. No E9/E10 coverage is inferred from CI success.

## Reproduction

Run from the E11 worktree. The prepare target reads the local retained artifacts, review, reservation, E10 consumer closure and GitHub PR/CI metadata. It requires the pinned git objects and retained E10 files. It performs no install. The subsequent targets use the exact Node 24 image, no network, no dependency installation, no service stack and no exposed ports.

```sh
rtk make -f Makefile -f tools/engram-e11/e11.mk memory-e11-prepare ENV=test-mem-e11
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f tools/engram-e11/e11.mk memory-e11-test ENV=test-mem-e11
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make down ENV=test-mem-e11
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f tools/engram-e11/e11.mk memory-e11-generate ENV=test-mem-e11
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make down ENV=test-mem-e11
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f tools/engram-e11/e11.mk memory-e11-check ENV=test-mem-e11
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make down ENV=test-mem-e11
```

Output: `tmp/engram-e11/e2-host-tuple.v1.json`; stdout reports its exact SHA-256 and every PENDING reason. Retain the complete input directory alongside the tuple before cleaning the worktree. Its paths are relative and every referenced file has a byte count and SHA-256. Archive SHA-512 integrity and selected member hashes bind installed runtime/types, C6 inventory/declarations and migration SQL. The workspace lock and retained consumer lock are hashed independently. Canonical output sorts object keys, preserves arrays and ends with one LF; there is no timestamp or host path in the tuple.

The checker rebuilds all observations and byte hashes, compares the complete canonical tuple and rejects edited statuses, missing inputs, changed files, wrong archive identity or mismatched installed files. `memory-e11-check E11_CHECK_FLAGS=--require-final ENV=test-mem-e11` must fail during preparation. The candidate configuration is deliberately frozen; new producer/mesh bytes require an explicit configuration update and new qualification, not silently replacing files under the same tuple.

The test target exercises missing/tampered files, escaping paths, integrity substitution, manual profile promotion, premature final acceptance and reproducibility against the actual retained candidates. These are local E11 checks; the existing repository CI does not execute this make fragment or the installed qualification lane.

## Input inventory and expected changes

`PENDING` means acceptance is still open, including slots whose bytes may remain unchanged but must be re-attested on the successor tuple. `VERIFIED-CANDIDATE` means the current observation was bound; it grants no release acceptance.

| # | Slot | Preparation state / reason |
| --- | --- | --- |
| 1 | Installed receipt | PENDING: regenerate after final producer/mesh rerun |
| 2 | Backend package/source/head/tree | PENDING: intentHash carriage changes source and qualified identity |
| 3 | Engram archive/version/integrity | PENDING: owner merge of rhanka/engram#410 and exact 0.21.3 published bytes |
| 4 | Mesh archive/version/integrity | PENDING: successor pack-only dev carrying producer intentHash |
| 5 | P3 manifest | VERIFIED-CANDIDATE: frozen bytes, no artifacts edit |
| 6 | Consumer package | PENDING: new exact archive references |
| 7 | Consumer/workspace locks | PENDING: successor retained locks, npm ci only |
| 8 | Lane script | PENDING: successor assertions/receipt metadata |
| 9 | Lane type probe | PENDING: compile against producer intentHash declarations |
| 10 | Lane recipe | PENDING: successor version assertions; retained-lock install |
| 11 | Campaign log | PENDING: new installed qualification |
| 12 | Campaign status | PENDING: new exit=0/cleanup=0 |
| 13 | pg 8.22.0 identity | VERIFIED-CANDIDATE: installed package.json hash plus lock integrity |
| 14 | Node 24/PostgreSQL images/runtime | PENDING: re-attest exact images/runtime on successor |
| 15 | Contract/C6/migrations/history | PENDING: final standalone C6 1.0.0 bytes and agreement |
| 16 | Five profile identities/statuses | PENDING: declared/not-covered is not qualified evidence |
| 17 | Host glue / host tables | VERIFIED-CANDIDATE: no glue, full tuple coverage |
| 18 | Adaptation | PENDING: replace host intentHash formula, recheck lossless K7 |
| 19 | Refusals/operations/runtime/type closure | PENDING: repeat against final bytes |
| 20 | Lot 6 disposition | VERIFIED-CANDIDATE: verbatim #803 section; missing source, option (a) |
| 21 | CI | PENDING: exact final E10/E11 heads and completed/success |

The C6 source inventory announces `contracts/engram-memory-neutral-contract-v1.d.ts`, version 1.0.0, but that member is absent from dev.5. The tuple records the actual emitted `dist/engram-memory/neutral-contract.d.ts` hash separately and leaves `finalBytesSha256: null`. Neither that candidate hash nor the semantic `contractDigest` substitutes for the final standalone declaration bytes.

## Receiving checklist — future finalization only

- [ ] Stabilize #803 rerun and Engram owner merge/publication of 0.21.3. Confirm the exact version rather than inferring precedence from today's 0.22.0 candidate. Obtain registry metadata, archive SHA-256/SHA-512 integrity, source/tag/provenance and producer intentHash contract.
- [ ] Produce the new mesh pack-only dev with unchanged producer-supplied intentHash carriage. Qualify actual byte carriage, K7 created/completed receipts and original replay through installed Engram. Retain the successor source, archive, receipt, scripts/probe/recipe, refusal/hydration evidence and closures.
- [ ] Resolve E9's five-profile qualification gap on the same shipped handle and exact tuple, with Engram read/write and separate host maintenance authority. Preserve profile name/version/digest identities and real statuses; require qualified evidence, never relabel the current receipt.
- [ ] Freeze C6 asset `engram-memory-neutral-contract@1.0.0`, final standalone declaration path and exact byte SHA-256. Verify packaged bytes, standalone declaration closure, producer agreement, unchanged semantic identity and full migration/history identities.
- [ ] Read and hash the current [RESERVATION.md](/home/antoinefa/src/sentropic/.tmp/engram-e2-host-tuple/RESERVATION.md). Recheck registry occupancy and release ownership: **0.24.0 is reserved**. If occupied, obtain a new authorized reservation before changing qualified package/lock bytes. Development candidates are never published.
- [ ] Under conductor authority, prepare the exact stable reserved-version archive and retained install locks before final qualification. Any version, lock, C6 or archive change invalidates affected evidence and requires regeneration/rerun; do not stamp versions after qualification.
- [ ] Install in a fresh consumer outside repository resolution with `npm ci --ignore-scripts --no-audit --no-fund` using the retained lock and exact local archives. Compare lock hashes before/after; no `npm install --package-lock-only` or lock re-resolution. Retain root/consumer locks and all runtime/type closure byte hashes. Recheck Node 24/PostgreSQL images, driver identity, migrations and reopen hostHistory independently.
- [ ] **gr-conductor generates the final manifest**, retains every referenced artifact, and checks its exact SHA-256. Convert to final acceptance only with a reviewed final specification and stable qualified inputs; this preparation generator intentionally cannot emit FINAL.
- [ ] Obtain explicit **producer C9 ACK** naming final tuple SHA-256, both package versions/integrities, C6 1.0.0 final-byte SHA-256, source identity and qualification receipt. Sending a tuple is not an ACK.
- [ ] Obtain independent **Sentropic/L5 receiving ACK** naming the identical tuple SHA-256, installed lock/closure hashes and receiving verification. Record owner, time and evidence reference; distinguish received, checked and accepted states.
- [ ] Prepare the **final main PR** from the integration branch with all acceptance evidence. Merge upstream changes only; never rebase. Require completed/success CI on its exact head. A later commit requires new exact-head CI and affected qualification; retain ACK freshness against the final tuple.
- [ ] After release-owner authorization and acceptance, merge through the final main PR and use only the repository CI publication path (`make publish-cluster-mesh`, trusted OIDC, package tag `cluster-mesh@0.24.0` or an explicitly renewed reservation). Never publish manually or publish a dev candidate.
- [ ] **Verify published bytes**: download the exact registry versions and dist metadata through the approved make lane; recompute SHA-256/SHA-512 integrity, compare archive/member bytes, C6 final declaration, source/tag/provenance and retained locks with the accepted tuple. Clean-install those published bytes and verify closure. Any mismatch blocks receiving completion and invalidates the associated acceptance.
- [ ] Retain publication run/tag, registry metadata, byte-verification receipt and both ACK references with the final tuple. If publication changed any tuple identity, gr-conductor regenerates it and both parties ACK that same new hash. Tear down only the owned test environment with `make down`.
