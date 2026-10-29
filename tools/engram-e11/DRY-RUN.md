# E11b candidate generation receipt — 2026-10-29 UTC

- Branch: `feat/cluster-mesh-engram-e11b`, base integration `fa900e335`; worktree `tmp/worktrees/mem-e11b`. Merge only; no rebase, merge, publication or ACK.
- Source snapshot: `2d9d5da97669199091700e138de638ca28b559c9`, tree `4f9ef09088d2fd28a451196c23151146bdd6bc64`. Original dev.7 pack source: `d1726c3092895d105eb1b56fe3357228b634760e`; source/assets/package diff is empty.
- Retained tuple: `.tmp/engram-e2-host-tuple/e11b-current/e2-host-tuple.v1.json`.
- Tuple SHA-256: `29c83333e34363c515dec2e92c00129f5a0d411df2a4d1be368c7a4531fc7a0a`.
- All 21 input slots are VERIFIED-CANDIDATE. No input slot is PENDING. Five profile qualifications are QUALIFIED; overall tuple remains PENDING for the six release/ACK gates.
- Engram 0.21.3 SHA-256: `32d47df1880cf5c43b0f16145f75aebeda5fd341d8b1317f3b89acc428bbd05b`.
- Mesh dev.7 SHA-256: `7aeb92cfb97ef013ee0d6d50162f5b8dedebd51a44af2018c2e24ada2395e271`; archive and adjacent SHA-256 file copied to the shared `e10-artifacts/`.
- Standalone C6 declaration SHA-256: `5a8c13c51eb00b350fae0b271d5357f54bdb01c930d607f679372bebff773229`. Included in the archive, checked against compiler output without its source-map comment, and independently compiled in the clean consumer.
- Installed receipt SHA-256: `b1285247c2d09aea062a62f6e43e50fcb50714566b0ad8b57e411dd7d8b110b3`.
- Consumer package SHA-256: `efbc3a4250c5b02efd5f18475c06d258fda85755a111224ed379d740b7a78b65`.
- Consumer lock SHA-256: `39e3ef868fb71444667c6cb7045b10f5eca12b6887b76eb9ff9769e5393de872`.
- Workspace lock SHA-256: `6d39c4459246f5870225d560b43bf744b700b4b6d99206780b2ddc3213f86ff0`.
- E10 campaign log SHA-256: `7141f11a654ed09d385d7b8290a4352381274ecb3fb8ef8e0703df57dd993599`; exit=0, cleanup=0. Fresh retained-lock npm ci, before/after lock comparison, strict declaration compilation, real PostgreSQL capture/completion/admission/read, two-process reopen/replay, seven typed refusals and four K7 hydration-fault cases pass.
- Installed Stage B JSON SHA-256: `911a1d530e0dfe64a5f023e4e25435d999a044d017d4487e400b1692777ad671`. All 23 behaviors plus inventory pass, zero skips/todo; campaign exit=0, cleanup=0. Includes real SIGKILL before/after COMMIT, second-holder/bijection/revocation/final-guard/C7, bounded reads, maintenance and u64 boundaries.
- Node v24.21.0, npm 11.19.0, PostgreSQL 17.11, pg 8.22.0. Exact images, ten migration hashes, host history and installed runtime/type closure are bound in the tuple.
- Contract JCS: 4,012 bytes, SHA-256 `55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759`; digest `sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee`. Producer and mesh canonical manifests compare exactly.
- Generation/check exit 0 with the identical tuple hash; 10 E11 tests pass, zero failures/skips/todo. Negative qualification tests reject skipped, missing, repeated or failed cases and a different installed archive.
- Local typecheck and lint pass. Full memory run: 220 pass plus one obsolete C6 null-hash expectation; corrected focused contract suite: 17/17 pass. Exact-head CI must rerun the complete suite.
- E10 historical exact-head CI remains bound as slot 21. E11b exact-head CI is recorded externally after push to avoid a self-reference. CI runs both installed campaigns and E11 tooling, retaining its own tuple/logs/locks over the same candidate bytes.
- Shared Docker flock used throughout; owned stack cleaned with make down. No new peer consensus is claimed; this is the code-author delivery.

## Five qualified profile identities

All versions are `1`. Each QUALIFIED claim binds its named passing cases, installed mesh SHA-256 and Stage B report SHA-256.

| Profile | Semantic digest |
| --- | --- |
| atomic-units-v1 | `sha256:507fd5a8f5d68a8c2b99c05bee5a23c0ded47d79532ca5edf34ea08c1919958a` |
| immutable-chains-v1 | `sha256:927777f8470be49c968a15cb9bbf2560efdd63bd329d763bfeeb1c166759a3bc` |
| immutable-boundaries-v1 | `sha256:47ee879a5552868ec7cee15f9984cb44f5a72b64aa2b02556232cd0c9037c80f` |
| scope-outbox-v1 | `sha256:d4f1e16890c9541fada3e71e4ba7ba2016da5b07e26383979e29e42b7916b1ed` |
| fenced-writers-v1 | `sha256:48cfb030a1a9c614de6170588116d1afe3d7c94acda79b4322b6b6d7d5156900` |

## Remaining handoff

Qualify reserved stable bytes/locks; conductor integration → main PR and exact-head CI; CI-only cluster-mesh@0.24.0 publication under the reservation; published-byte recheck; explicit producer C9 ACK; independent receiving ACK. C9 must name this tuple and explicitly acknowledge the `dff737ce…` → `dd0cccbd…` digest supersession under unchanged neutral contract `1.0.0` (additive intentHash, #821). The separate L4 MCP 0.22.0 candidate is excluded from this E2 tuple.
