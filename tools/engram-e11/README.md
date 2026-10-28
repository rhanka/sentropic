# E11 E2 tuple and receiving handoff

Owner instruction advances PR #818 from preparation to E2 generation on integration `32dd911be19f0874459a1b4e697d7175bb6b433f` (tree `9dcd865487004e28649f3d68c842f328cc4d1952`), after #821/#803. Plan E11, line 120, requires the E10 host tuple. The L4 MCP 0.22.0 candidate belongs to separate L5 work and is excluded. Historical P3 bytes are retained only as lane evidence; they do not bind this E2 tuple to that L4 candidate.

| Input | Exact identity |
| --- | --- |
| Engram | Published `0.21.3`, gitHead `8b93ba6b834f83fddbcf76091054efea2e188cf1` |
| Engram SHA-256 | `32d47df1880cf5c43b0f16145f75aebeda5fd341d8b1317f3b89acc428bbd05b` |
| Engram integrity | `sha512-eGoBIutpeISKgN4HOS3NSIj7K6rMtT6Y/FbBvoXMykLu0wbaKEaO1pjCLDxVFfdA6Zlj9zg2v2Ft7DIr5Vf7aw==` |
| cluster-mesh | Pack-only `0.24.0-dev.6`, source `eb79034df17ed5e2cb2ddcc3288b9b8bbb682120`; packed inputs unchanged at integration |
| Mesh SHA-256 | `ff79088e02574f9e17e16deb52f9380453255ed79f5b69c8b17d156a25233194` |
| Mesh integrity | `sha512-A20DTkaNo++aXw/A+K5Hyg9SHRlX6ZefoWhpXGF1BQnXONThsSLT6yKeWq3QwZb/iIAznLqlW0F0zs7/ENbFFg==` |
| Neutral contract | `1.0.0`, `memory-binding-v1`, 4,012 JCS bytes in `neutral-contract-1.0.0.jcs.json` |
| Contract bytes SHA-256 | `55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759` |
| Domain-separated digest | `sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee` |
| Node image | `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6` |

The generator binds all 21 inventory categories, source, archives, recipe/adaptation, retained consumer/workspace locks, migrations, host history and runtime/type closure. See `DRY-RUN.md` for campaign hashes, the tuple hash and the pending inventory. Status stays PENDING until evidence permits final acceptance. The checker rejects changed bytes, manual profile promotion and `--require-final`.

Run from this worktree with `rtk make -f Makefile -f tools/engram-e11/e11.mk TARGET ENV=test-mem-e11`. Docker targets must be wrapped with `rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make ...`; run locked `make down ENV=test-mem-e11` after each Docker step. Targets: `memory-e11-prepare`, one-time `memory-e11-lock`, `memory-e11-installed`, `memory-e11-snapshot`, `memory-e11-test`, `memory-e11-generate`, `memory-e11-check`, `memory-e11-retain`. Generation/check use no network. Retained bundle: `.tmp/engram-e2-host-tuple/e11-current/`; check it using absolute `E11_INPUT` before the final ENV argument.

The initial E2 lock is created once before qualification. Subsequent installation removes consumer node_modules, runs `npm ci --ignore-scripts --no-audit --no-fund` and compares the retained lock before/after. The explicit staging transform changes only E10 consumer version/archive assertions; original scripts and transformed bytes are retained. No package archive, package source, repository lock or artifacts source is modified. Installed proof covers capture/completion/admission/read, two-process reopen, original replay, typed refusals and K7 hydration faults. It does not run Stage B.

## Receiving checklist

- [x] Merge integration into #818, never rebase; preserve E11 scope and all environment selectors.
- [x] Resolve Engram 0.21.3 publication, exact SRI/SHA-256, intentHash producer carriage and neutral contract byte/digest pair.
- [x] Retain dev.6 archive bound by SHA-256 and source; exclude the L4 0.22.0 candidate from E2.
- [ ] Require five qualified profiles on the exact installed tuple. Integration still marks all 23 Stage B cases blocked on E7-fenced-writers; three also require E7 host reads. E9/host-binding owner must supply a passing zero-skip campaign; preserve all five declared name/version/digest identities meanwhile.
- [ ] Resolve the distinct standalone C6 declaration. Dev.6 announces `contracts/engram-memory-neutral-contract-v1.d.ts` but omits it and states final bytes pending. The producer JCS contract is resolved; its hash does not establish that missing declaration. C6 packaging owner must supply packaged bytes, standalone compilation and agreement.
- [ ] Generate the stable reserved-version archive and qualify its exact locks/bytes before release acceptance. `0.24.0` remains the reservation; development candidates are never published. Recheck occupancy and ownership before changing identities.
- [ ] Integration → main PR: conductor integrates #818 and prepares the final PR, with completed/success CI on its exact head and all qualification gaps resolved.
- [ ] CI-only publication: release owner uses the repository trusted-publisher workflow for `cluster-mesh@0.24.0` under the reservation. No publication is authorized by this E11 task.
- [ ] Published-byte recheck: retrieve exact registry bytes/metadata; compare SHA-256/SRI, contract, migrations, source/tag/provenance and clean installed closure. Any changed identity requires a new tuple and affected qualification.
- [ ] Producer C9 ACK: producer explicitly names the same tuple hash, versions/integrities, contract pair, source and installed receipt.
- [ ] Receiving ACK: independent Sentropic/L5 receiver explicitly names that identical tuple hash and checked installed locks/closure. Delivery, CI and producer ACK do not imply receiving acceptance.
