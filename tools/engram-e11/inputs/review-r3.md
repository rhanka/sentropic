## Final E11 input list (exact)

| # | Input | Path | sha256 / identity |
| --- | --- | --- | --- |
| 1 | Receipt | `packages/cluster-mesh/tests/engram-memory/installed-receipt.json` (at `6580c5f83`) | `50f4731c754b3fb74cd93434e42427ebc0978fd49f6134a95c88e9f5f10ce431` |
| 2 | Qualified source head / tree | `bf87c772a0432201248a5b3831a72a92becc7531` / `3fa277e406b28987394907ba4681df50f0781901` | PR head `6580c5f839cef2b250d1bda6548a216d032f7c91` (no packed or lane-input change) |
| 3 | Engram tarball `0.22.0` | `/home/antoinefa/src/sentropic/.tmp/engram-e2-host-tuple/e10-artifacts/sentropic-engram-0.22.0.tgz` (source `/home/antoinefa/src/graphify-wt-mcpl4/.graphify/scratch/l4-r4-artifacts/sentropic-engram-0.22.0.tgz`) | `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10`; `sha512-/TV03olHbzG+3haTC5j5YJ282egCrXak1yQE0I8DHF1kAQDwsKUe1QlMwibvBCEmPGdWeTgSHT4fF8lZJTH8cw==` |
| 4 | cluster-mesh candidate (bound by bytes; label `0.24.0-dev.4`) | `/home/antoinefa/src/sentropic/.tmp/engram-e2-host-tuple/e10-artifacts/sentropic-cluster-mesh-0.24.0-dev.4.tgz` | `f7d03a4675adaa23d0baca9012fc86127d13bd57b8f136c0cfc802a7d0e6acd3`; `sha512-bgXVGgk6C8+TPHXfqMvg7bm9Y9xgzqevzRFh4hJSrEWneqNN57YAY34NnLZU0qphhpPrRhra8z7vT9ZyXAyETQ==`; file list `cd30501f29c188e15434e435287cc198c359cc9c8b14ae2efe2a34f62b9f7898` |
| 5 | P3 manifest | `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` | `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730` |
| 6 | Consumer package.json | `packages/cluster-mesh/tests/engram-memory/installed-consumer-package.json` | `f42d84617bba4c410f025ab0c7a2edcfb924c04b235e88da2380a1fd30130dc8` |
| 7 | Consumer lock (`npm ci` only) | `packages/cluster-mesh/tests/engram-memory/installed-consumer-package-lock.json` | `98209af43f6952def63538d4d36e21780d53bbc0253dc14d7c8a3a6b6e896ecc` |
| 8 | Lane script | `packages/cluster-mesh/tests/engram-memory/installed-memory.mjs` | `0f69e77179234cf5e00724fb7910f5bac3fb03948b8969147ca1c5593a2e8cac` |
| 9 | Lane type probe | `packages/cluster-mesh/tests/engram-memory/installed-memory-types.ts` | `b9251dae44e9db19f3e44d9d9e2c5570ca0aff0f04baa473150b4ba5a3fd815f` |
| 10 | Lane recipe | `packages/cluster-mesh/tests/engram-memory/qualification.mk` | `a7a8f4dc9a671e8fe5d8c2e8217a50df4b13324ba771acceae4903b7dc5c7caa` |
| 11 | Campaign log (local, retain before worktree cleanup) | `/home/antoinefa/src/sentropic/tmp/worktrees/mem-e10-fin/tmp/installed-memory-e10/campaign.log` | `90132dc223944ee29584b7aa2356da7b58a18ef7e6d2d5f46f7b6372dc045f97` |
| 12 | Campaign status (local) | `/home/antoinefa/src/sentropic/tmp/worktrees/mem-e10-fin/tmp/installed-memory-e10/campaign.status` | `eb30050778841df44c7a4fe88d59a640dc9620a1429382b8afccda8cb2b493b3` (`exit=0`, `cleanup=0`) |
| 13 | Driver | `pg` `8.22.0` | artifactDigest `bab5faf4410151a463078fffa326d10979150bfc330f0a29bd08948378ed3421` |
| 14 | Engines | qualification image / PostgreSQL image | `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6` / `sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b` (server `17.11`, floor `17.0.0`); Node `v24.21.0` linux/x64, npm `11.19.0`, `typescript` `5.4.5`, `@types/node` `22.20.1` |
| 15 | Contract | receipt `contractDigest` | `sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28`; five `requiredProfiles`; 10 migration ids and checksums and `hostHistory` as in the receipt |
| 16 | Profile statuses (verbatim, never promoted) | receipt `declaredProfileClaims`, `fiveProfileEquivalence` | five `declared`; `not-covered` (Stage B blocked, E9 #790, 23 cases) |
| 17 | Host glue | none | `hostGlue` absent, `tupleCoverage` `full`; host tables `host_history`, `host_memory_identity` |
| 18 | Adaptation properties | `src/engram-memory/wire-adaptation.ts` in tarball #4 | K7 `receipt_digest` re-joined from the pending control; `intentHash` recomputed with Engram's formula (P1-B disposition reference) |
| 19 | Refusals / operations / closures | receipt `refusals`, `operations`, `runtimeClosure`, `typeClosure` | 7 typed refusals; epochs `1` to `2`; restart `duplicate_exact`, 2 processes; closures under `/consumer/` |
| 20 | Lot 6 (#709) | PR body section | `missing source`, conductor option (a), 2026-10-28 |
| 21 | CI | run `40648066606` | `pull_request` `completed/success` on `6580c5f83`; it does not cover the installed lane |

Historical tarballs, not E11 inputs:
- `sentropic-cluster-mesh-0.24.0-dev.1.tgz`, sha256 `4799bcc39944b7d487cf1f4b6d5b628a5c4556a068918a5ffb36db54348bd8cc`
- `sentropic-cluster-mesh-0.24.0-dev.2.tgz`, sha256 `bced27e380962f5792cc3af734db20c46750bd0a892c29d7cc83ac6d2f31997f`

VERDICT: CHANGES
