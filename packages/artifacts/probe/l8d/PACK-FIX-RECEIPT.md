# L8d package defect correction

Status: targeted packaging and 0.19.2 runtime-admission checks pass. Full Radar integration qualification remains open. This supplements the original L8d receipt.

## Change and baseline

- Base: origin/feat/immo-861-integration; merge commit `238ab2959` retains L8d history without rebasing.
- The two promoted regressions reproduced ERESOLVE and TS2307 against the baseline archives: 0 passed, 2 failed, zero TODOs/skips.
- Manifest, root lock metadata and runtime catalog now admit exactly `0.19.2 || >=0.22.0 <0.28.0`; no 0.20/0.21 admission.
- Artifacts includes `src/contracts.ts`, required by the frozen profile declaration. All frozen files and L3 source signatures remain byte-identical to the integration base.
- Registry latest observed on 2026-10-25: artifacts 0.1.4; mesh 0.21.2. Reserved candidate versions 0.2.0/0.22.0 are retained. The catalog source change is declared by BR861-EX2; enforce-package-bump checked against main's merge-base passes (cluster-mesh 0.21.2 -> 0.22.0). CI is unchanged.
- Runtime fix: `3655e4b68`; integration `0bda0f93d` merged without rebase in `3671a3d0e`. Only BRANCH.md conflicted; incoming integrity tests are retained and Track bytes match both parents.
- Cluster-mesh dist was rebuilt from the corrected source before packing. Artifacts dist remains the previously byte-compared candidate; frozen files and artifacts source are unchanged against integration.

## Corrected archives

| Package | Version | SHA-256 |
| --- | --- | --- |
| artifacts | 0.2.0 | `03de9bfeecb2e601a3290b26a61ecedd801f858eb8864cba561d57dc4091658e` |
| cluster-mesh | 0.22.0 | `d01a2c7669b7e18e1597d2407790bd64a865a6fe258b6bd61f7f6fba4a6452ab` |
| mcp-platform | 0.4.0 | `67c9ab88ae51087a21a596facfc8330dea4c43128878c261a4136b6d458885e5` |
| mcp-auth | 0.2.2 | `3aa546601a3ad444bae0058c6c21038ec1d12e905e27df1abb628eadc867d926` |

Tuple digest: `263c6435fb67cfa61bb96bdd93d1b52b17c2b842e61aaed1f852370b6c994160`. Pack verifies SHA-512 SRI against archive bytes.

## Verification

- Before the fix, the new packed probe strictly installed the real npm llm-mesh 0.19.2, then failed on the mesh leaf's automatic topology guard with `incompatible_version` and the old range.
- After rebuilding/repacking, `mesh-0192` passed (1 test, no skips/TODOs): actual npm 0.19.2 mesh/facade static imports, registry loads, provider export identity and strict topology admission. This verifies loading/admission, not model execution or whole-Radar behavior.
- Module suite: 72 passed, including a shared 0.19.2 gateway registry load and strict/automatic topology checks at 0.19.2, 0.22.0 and 0.27.9. Gateway coherence uses synthetic package-tree fixtures; this is not qualification of a published gateway with 0.19.2.
- Catalog/manifest parity and excluded versions are tested through the runtime constant. Post-merge packaging source checks: 52 passed, 45 fixture-dependent tests inactive. The incoming integrity test initially exceeded 5s while running five Node processes in one case; splitting its independent cases preserved every assertion and the original timeout. The complete suite then passed; full installed packaging is not claimed here.
- Clean minimal tuple npm install and npm ci passed under strict peers; public artifacts runtime (four tools, OAuth resolution, no source links) and strict NodeNext declaration compilation passed. Lock SHA-256: `cc9116bcfa6c9457f11445b038410367c04f49b6b2ab1d3840248d8436e784d1`.
- Promoted package regressions: 2 passed; receipt adversarial regressions: 16 passed. Zero failures, TODOs or skips.
- Final matching Compose down passed; the dedicated project network was removed.
- Docker test/build/pack steps use the shared lock and dedicated Compose ENV; matching down follows each step. Scope checks use the host-only lane target.

Run each Docker step as `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f packages/artifacts/probe/l8d/qualification.mk <targets> ENV=test-861-pack-l8dfix`, followed by the same invocation with `down`. Current targets: `pack`, `mesh-0192`, `smoke known-failures test`. `scope-check` needs no Docker lock.

Source tests/build use the existing `test-cluster-mesh` / `build-cluster-mesh` targets under the same lock, with `CM_RUN='docker compose --env-file /dev/null -p test-861-pack-l8dfix -f docker-compose.immo-861.yml run --rm --no-deps' CM_RUN_IMAGE=qualification`, `SCOPE=tests/modules` or `SCOPE=tests/packaging` for tests, and `ENV=test-861-pack-l8dfix` last. Cleanup uses the lane's `down` target above.

## Historical installation evidence

Before the runtime correction, strict full-Radar lock regeneration and npm ci passed (764 packages), lock SHA-256 `450fc4635c9738280b074bc84b04eadaef724983e3a7f77c83f94dd39cd6a321`, for tuple `5676553af842ec5be32bf9bb7cc0fc403e767754859c141cf80747867fae2848`. Those checks did not import llm-mesh-family entries and proved installation only. They have not been rerun for the rebuilt archive above.

Whole-Radar build/runtime behavior, the original eight-suite/four-shard qualification, model execution and image/published-byte gates remain separate.
