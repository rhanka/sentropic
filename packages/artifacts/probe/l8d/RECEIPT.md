# L8d packed-candidate receipt

Status: **FAILED qualification**. No published-tuple or activation claim.

- Tested lane head: `49f9de00c70295b46ae76e057014b3ed9f60aa30`.
- Integration base: `c3b8816710ab338794fc076ee98cf7fa676949ad`; L6 included; later integration merges were already up to date.
- Image: `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`.
- Tuple digest: `30dd046060b37172dc1613037bddf359d209d2846808528be6be09d2fab259be`.
- Full Radar lock SHA-256 (failed regeneration; baseline lock): `6caab914f246e0b7cc2c665724a07ef979ea1fa8edf7d8105a5ff475a6b8092f`.
- Minimal strict consumer lock SHA-256: `946d34631ec13d89b2418c0f62e285fe8bd6110991b7c39d4c0f890155eaf2c6`.
- Build outputs were reused from integration only after matching artifacts/mesh/platform source trees.
- Raw receipt, logs and regenerated minimal lock: `tmp/l8d/` in this lane worktree.

## Archive bytes

| Package | Version | SHA-256 | Origin |
| --- | --- | --- | --- |
| @sentropic/artifacts | 0.2.0 | `243f48d61264095dc95c3201a97dd98f5e848f5f80fe334817f1eed8f38cc410` | ./packages/artifacts |
| @sentropic/cluster-mesh | 0.22.0 | `5637df094c2cf129937119689e0ecdabe80c8d0f6bd50b6d6e7f2639e1994f39` | ./packages/cluster-mesh |
| @sentropic/mcp-platform | 0.4.0 | `67c9ab88ae51087a21a596facfc8330dea4c43128878c261a4136b6d458885e5` | @sentropic/mcp-platform@0.4.0 |
| @sentropic/mcp-auth | 0.2.2 | `3aa546601a3ad444bae0058c6c21038ec1d12e905e27df1abb628eadc867d926` | @sentropic/mcp-auth@0.2.2 |

SHA-512 SRI values are retained in `tmp/l8d/tuple.json` and verified against the actual archive bytes.

## Executed gates

| Gate | Result |
| --- | --- |
| Receipt/archive adversarial regressions | 16 passed, zero skips |
| Known product regressions | 2 executed TODO failures; neither counted as a pass |
| Exact archive identity and integrity | Passed |
| Minimal tuple npm install + npm ci --strict-peer-deps | Passed; all four tuple packages are archive installations |
| Packed runtime in pinned container | Passed; four artifact tools, OAuth resolution, no source links |
| Public declaration compilation | FAILED: L8D-2 |
| Strict full-Radar install | FAILED: L8D-1 |
| Built Radar image | Not covered: pinned image-smoke uses raw Docker, forbidden by machine lock |
| Final receipt acceptance | Must fail; no disabled/empty suite can pass |

## Product defects and acceptance

- **L8D-1, L7 owner:** `packages/cluster-mesh/package.json:185` excludes Radar llm-mesh 0.19.2. Full strict installation and the minimal executable regression fail with ERESOLVE. Acceptance: install the same exact four archives with Radar's 0.19.2 graph using strict peers, without force/legacy options.
- **L8D-2, L6 owner:** `packages/artifacts/l0-freeze/profile-contract.ts:11` imports `../src/contracts.js`, omitted by `packages/artifacts/package.json:162`. The public declaration probe fails TS2307. Acceptance: compile the public commit/outcome imports from clean packed bytes with NodeNext and strict TypeScript.
- Reproductions: `known-failures.test.mjs`; run the `known-failures` Make target. Product files were not edited.
- Consumer delivery gaps: pinned `artifacts-provider-contract.helpers.ts:500` and `:524` still unconditionally raise missing-contract for coordinator construction and Radar r2 composition. The owning consumer must bind the delivered APIs before acceptance execution.

## Eight Radar suites

All are **not covered**, blocked before execution by strict installation. Gate value is 1 in the runner; no test is reported passed or silently skipped.

| Exact path | Test SHA-256 |
| --- | --- |
| `api/tests/integration/artifacts-commit-probe.spec.ts` | `9b0f7e0d374e47b10fb855c13edd832be480f7faf148f1dd94569265300228a2` |
| `api/tests/integration/artifacts-mcp-adapter.spec.ts` | `e5e3b4d15382713182d50eaed504ed1a3574c1b577d8684d6856f5c8f1c8e97e` |
| `api/tests/integration/artifacts-provider-acceptance.spec.ts` | `9cd9ef2836bf1c3abcfe8c4ffd27fe02f459bffd2aef9fb1176e1551a9d0f06e` |
| `api/tests/integration/artifacts-finalization-authorization.spec.ts` | `577dd2e21575b08ee5740280fa7cee12cde7586b85db09f1dfbbe92b023dcf75` |
| `api/tests/integration/artifacts-provider-failures.spec.ts` | `d442a6dfe799812a48674e3a45957f5a6aa862147fc82571002fc10a8b969003` |
| `packages/artifacts-host/src/commit-authorization.test.ts` | `fc5709f1b335de146a35252a7f5dad3f6c70caff731ec383f56110f0d888b4e6` |
| `packages/artifacts-host/src/commit-failures.test.ts` | `77fcfe4baf66a5652e2a79bdfb8b12271c38c84d23069ac3c84171be543da5d3` |
| `packages/artifacts-host/src/mcp-app-adapter.test.ts` | `5462431470cd55e70f68cfcf9796a35a9dcffccdb382076ff4a88801bdcfd978` |

## Radar source pins

- ARTEFACTS integration: `b2b802b57b84dd623588005042ce78ca4eec8fb7`; A1/A2 ancestry checked.
- A1: `f2b6c25cc9458ec285d6d4f620a55dad8c30f909`.
- A2: `b104ae90a28a5581e8eabd15f12acb58558d3396`.
- Acceptance suite and helper overlay: PR #908 `e2e9515ea41baebf5539743f0cfa0dea750d072c` (main merge `2dbde92e9a6c532abe4f9e7bed8ed9a9b381d530`).
- Current-main BASE #910 retires the route called at immo-mcp data-source.ts:316; these pinned inputs do not qualify that current-main adapter.

## Four-shard aggregation

| Lane | Source head | Observed source-test result | Packed-tuple qualification |
| --- | --- | --- | --- |
| L8a | `44fc537b901075453585b38cd8aeb60d9c33c436` | 26 passed, zero pending; raw final Vitest JSON | No tuple identity delivered |
| L8b | `68b1799e5b3dcd2fb768a0f5751623339b725487` | 19 passed; branch receipt | No packed/published receipt claimed |
| L8c | `cb051cb8eab3bed2b3e0cb84800fae852f39da4d` | 33 passed + 6 expected failures; branch receipt | Known failures; no common archive identity |
| L8d | `49f9de00c70295b46ae76e057014b3ed9f60aa30` | 16 passed + 2 known failures | Failed |

L8a raw-results SHA-256: `a8e3f2bd810c0a7bc399ccaa8279e5ff6619b05ac85354d67de7a5538f90ede1`. L8b branch-receipt SHA-256: `019232372a4a1f2cfa4bc99e5db81d8ec8dcdb2be8907a66461653b84f5f45a6`. L8c branch-receipt SHA-256: `709e503a0e3b637284f7c0fae71a4f10a5f3fd04e8e9a7385a2574eb333f4695`.

The evidence is assembled but cannot produce a passing aggregate: source tests are not a common packed-byte receipt. No upstream defect from another shard is recategorized as an L8d discovery.

## Reproduction

Use `make -f packages/artifacts/probe/l8d/qualification.mk <target> ENV=test-861-l8d`. Targets: `pin-radar`, `pack` (requires built candidate dist), `install`, `smoke`, `test`, `known-failures`, `radar`, `receipts`.

Wrap each Docker target with `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`, then run the same locked Make entrypoint with `down` after each step. The pin target reads Radar only and extracts into this lane's disposable workspace. The image gate needs a Compose-based consumer runner before it can be executed under the machine policy.
