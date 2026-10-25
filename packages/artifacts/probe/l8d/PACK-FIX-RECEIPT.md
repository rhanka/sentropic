# L8d package defect correction

Status: both reported package defects pass verification. This supplements the original L8d receipt.

## Change and baseline

- Base: origin/feat/immo-861-integration; merge commit `238ab2959` retains L8d history without rebasing.
- The two promoted regressions reproduced ERESOLVE and TS2307 against the baseline archives: 0 passed, 2 failed, zero TODOs/skips.
- Mesh now admits exactly `0.19.2 || >=0.22.0 <0.28.0`; root lock peer metadata matches.
- Artifacts includes `src/contracts.ts`, required by the frozen profile declaration. All frozen files and L3 source signatures remain byte-identical to the integration base.
- Registry latest observed on 2026-10-25: artifacts 0.1.4; mesh 0.21.2. Reserved candidate versions 0.2.0/0.22.0 are retained. No src files changed; enforce-package-bump and CI remain unchanged.
- Candidate dist was reused only after recursive byte comparison of artifacts/mesh source and frozen directories against the integration worktree.

## Corrected archives

| Package | Version | SHA-256 |
| --- | --- | --- |
| artifacts | 0.2.0 | `03de9bfeecb2e601a3290b26a61ecedd801f858eb8864cba561d57dc4091658e` |
| cluster-mesh | 0.22.0 | `85952a1dd1ac8b5e880f3be2b5c9baef31f9e64d85654b288f37a4ea34f27c27` |
| mcp-platform | 0.4.0 | `67c9ab88ae51087a21a596facfc8330dea4c43128878c261a4136b6d458885e5` |
| mcp-auth | 0.2.2 | `3aa546601a3ad444bae0058c6c21038ec1d12e905e27df1abb628eadc867d926` |

Tuple digest: `5676553af842ec5be32bf9bb7cc0fc403e767754859c141cf80747867fae2848`. Pack verifies SHA-512 SRI against archive bytes.

## Verification

- Strict full-Radar lock regeneration and npm ci passed, 764 packages; lock SHA-256 `450fc4635c9738280b074bc84b04eadaef724983e3a7f77c83f94dd39cd6a321`.
- Clean minimal tuple npm install and npm ci passed under strict peers; public runtime (four tools, OAuth resolution, no source links) and strict NodeNext declaration compilation passed. Lock SHA-256: `948dddfaa5d8a4ee0ad9a98bef18f228b8f09b0c54a9a0e817e2bffa38ade0a8`.
- Promoted package regressions: 2 passed; receipt adversarial regressions: 16 passed. Zero failures, TODOs or skips.
- Final matching Compose down passed; the dedicated project network was removed.
- Reusing the disposable baseline consumer lock after repacking failed EINTEGRITY as expected for changed archives at the same filenames; removed only tmp/l8d/consumer before the clean rerun.
- Docker test/pack steps use the shared lock and dedicated Compose ENV; matching down follows each step. The initial general scope-check target unexpectedly launched its raw Docker build; it completed, and subsequent scope checks use the host-only lane target.

Run each Docker step as `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f packages/artifacts/probe/l8d/qualification.mk <targets> ENV=test-861-pack-l8dfix`, followed by the same invocation with `down`. Targets used: `pack`, `install`, `smoke known-failures test`. The read-only `pin-radar` and `scope-check` targets need no Docker lock.

The original eight-suite/four-shard qualification and image/published-byte gates remain separate; this receipt covers the two reported packaging defects.
