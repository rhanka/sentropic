# E11 E2 tuple and receiving handoff

E11b closes the two candidate input gaps from #818: the standalone C6 declaration and all 23 installed Stage B behaviors. Source snapshot `2d9d5da97669199091700e138de638ca28b559c9` has the identical packed source as the passing dev.7 campaign at `d1726c309`. Plan E11, line 120, requires the E10 host tuple. The L4 MCP 0.22.0 candidate remains separate L5 work; historical P3 evidence does not make it an E2 input.

| Input | Exact identity |
| --- | --- |
| Engram | Published `0.21.3`, gitHead `8b93ba6b834f83fddbcf76091054efea2e188cf1` |
| Engram SHA-256 | `32d47df1880cf5c43b0f16145f75aebeda5fd341d8b1317f3b89acc428bbd05b` |
| Engram integrity | `sha512-eGoBIutpeISKgN4HOS3NSIj7K6rMtT6Y/FbBvoXMykLu0wbaKEaO1pjCLDxVFfdA6Zlj9zg2v2Ft7DIr5Vf7aw==` |
| cluster-mesh | Pack-only `0.24.0-dev.7`, original pack source `d1726c3092895d105eb1b56fe3357228b634760e` |
| Mesh SHA-256 | `7aeb92cfb97ef013ee0d6d50162f5b8dedebd51a44af2018c2e24ada2395e271` |
| Mesh integrity | `sha512-riNCegTubf6lYa/WWJbdN6rWV0hztGPDmn+PemY1nSYjQIOI4ve2nMUXNo5PiAoZRhKEHvsyDoNF0ktJk3Ah2g==` |
| Standalone C6 declaration | `contracts/engram-memory-neutral-contract-v1.d.ts`, SHA-256 `5a8c13c51eb00b350fae0b271d5357f54bdb01c930d607f679372bebff773229` |
| Neutral contract | `1.0.0`, `memory-binding-v1`, 4,012 JCS bytes in `neutral-contract-1.0.0.jcs.json` |
| Contract bytes SHA-256 | `55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759` |
| Domain-separated digest | `sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee` |
| Node image | `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6` |

The generator binds all 21 inventory categories, source, archives, unchanged lane copies, consumer/workspace locks, migrations, host history and runtime/type closure. All input slots are VERIFIED-CANDIDATE; all five profile qualifications are QUALIFIED. See `DRY-RUN.md` for the local tuple hash. Overall status stays PENDING for the six release/ACK gates; the checker rejects changed bytes, skipped/missing/repeated Stage B cases, a different installed archive, manual promotion and `--require-final`.

Run with `rtk make -f Makefile -f tools/engram-e11/e11.mk TARGET ENV=test-mem-e11b`. Wrap Docker targets in `rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make ...` and clean with locked `make down ENV=test-mem-e11b`. First run the `stage-b` E2 lane; then use `memory-e11-prepare`, one-time `memory-e11-lock`, `memory-e11-installed`, `memory-e11-snapshot`, `memory-e11-generate`, `memory-e11-test`, `memory-e11-check`, `memory-e11-retain`. Generation/check use no network. Retained bundle: `.tmp/engram-e2-host-tuple/e11b-current/`; the exact dev.7 tarball and SHA-256 also go to `e10-artifacts/`.

The initial lock is created once. Subsequent installation removes consumer node_modules, runs `npm ci --ignore-scripts --no-audit --no-fund` and compares the lock before/after. The current E10 scripts are copied byte-for-byte. Its proof covers capture/completion/admission/read, two-process reopen, original replay, typed refusals and K7 hydration faults; Stage B is a separate installed campaign over the identical tarball. Checked-in old E10 receipts/locks remain historical evidence. CI runs both campaigns and the E11 tests/checker, retaining its own tuple because campaign logs/locks may differ; it does not replace the owner's named local tuple.

## Receiving checklist

- [x] Merge integration into #818, never rebase; preserve E11 scope and all environment selectors.
- [x] Resolve Engram 0.21.3 publication, exact SRI/SHA-256, intentHash producer carriage and neutral contract byte/digest pair.
- [x] Retain dev.7 archive bound by SHA-256 and source; exclude the L4 0.22.0 candidate from E2.
- [x] Qualify all five profiles on the exact installed tuple: 23/23 behaviors plus inventory pass, zero skipped/todo; preserve the original semantic name/version/digest identities.
- [x] Package and independently compile the standalone C6 declaration; bind its own SHA-256 in slot 15. Producer agreement remains the explicit C9 gate below.
- [ ] Generate the stable reserved-version archive and qualify its exact locks/bytes before release acceptance. `0.24.0` remains the reservation; development candidates are never published. Recheck occupancy and ownership before changing identities.
- [ ] Integration → main PR: conductor integrates #818 and prepares the final PR, with completed/success CI on its exact head and all qualification gaps resolved.
- [ ] CI-only publication: release owner uses the repository trusted-publisher workflow for `cluster-mesh@0.24.0` under the reservation. No publication is authorized by this E11 task.
- [ ] Published-byte recheck: retrieve exact registry bytes/metadata; compare SHA-256/SRI, contract, migrations, source/tag/provenance and clean installed closure. Any changed identity requires a new tuple and affected qualification.
- [ ] Producer C9 ACK: explicitly name the same tuple hash, versions/integrities, declaration hash, source and installed receipt; acknowledge supersession `dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28` → `dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee` under unchanged neutral contract `1.0.0` (additive intentHash, #821).
- [ ] Receiving ACK: independent Sentropic/L5 receiver explicitly names that identical tuple hash and checked installed locks/closure. Delivery, CI and producer ACK do not imply receiving acceptance.
