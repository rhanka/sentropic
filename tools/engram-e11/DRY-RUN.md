# E11 E2 generation receipt — 2026-10-28

- PR: https://github.com/rhanka/sentropic/pull/818, base `feat/engram-e2-integration`; integration `32dd911be19f0874459a1b4e697d7175bb6b433f` merged, never rebased.
- Tested tooling source: `182f307ecab67922ebeccae1042f28a7ee769689`; later documentation commits do not change generator/checker/configuration/test bytes.
- Retained tuple and every referenced artifact: `.tmp/engram-e2-host-tuple/e11-current/e2-host-tuple.v1.json`; working bundle `tmp/engram-e11-current/`.
- Tuple SHA-256: `66fa8eeef276dfd73fdb9440f589dbdeff33417e8650b55ac354e894cd547527`.
- Installed receipt SHA-256: `0883c3516e1517e002d2e9eb7aad8ecf2e6e664f0522ff8d05002579f7816f70`.
- Consumer package SHA-256: `f31251f0b9dcab86a1933b7d51e11a1fe130e1aee60a2d4661808322d139d970`.
- Consumer lock SHA-256: `07457b5df26cbd8b6ccc7a5251010bc2e0a6aa7674add788cd9fc611f9dda125`.
- Workspace lock SHA-256: `0611b91cd29ad752c2f703dcf1cd57efecc01c2b914a14e0c35f2ec12093440a`.
- Campaign log SHA-256: `2dad9ecb81818dab6ad25ffb7f4db04493a53d8f18ee59f6274ef087b72a5ea5`; campaign `exit=0`, `cleanup=0`.
- Checker report SHA-256: `57e00b2d22e931ab8615c6b61f554a1a434b8cac0f9a2afde5a55761741d3c20`; generation and checking both exit 0 and report the identical tuple hash.
- Nine E11 tests pass, zero failures/skips/todo; deterministic generation, missing/tampered bytes, integrity substitution, unsafe paths, manual promotion and receiving/final refusals covered.
- Fresh retained-lock npm ci installs published Engram 0.21.3 plus mesh dev.6; before/after lock comparison passes. Strict declaration compilation, real PostgreSQL capture/completion/admission/read, two-process reopen/replay, seven typed refusals and four K7 hydration-fault cases pass.
- Node `v24.21.0`, npm `11.19.0`, PostgreSQL `17.11`, pg `8.22.0`. Exact images, ten migration hashes, host history and installed runtime/type closure are bound in the tuple.
- Contract JCS: 4,012 bytes, SHA-256 `55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759`; domain-separated digest `sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee`. Producer extraction and mesh canonical manifest compare exactly.
- E10 final-head CI `cfd45de4d54651626e97113494b9d7bd108998c8`: completed/success, run `40727760123`. E11 exact-head CI is retained after push outside the tuple to avoid self-reference and moving that head.
- Shared Docker flock used throughout; owned test stack cleaned after Docker steps. No publication, version bump, artifacts source edit, root lock edit, PR merge or ACK.

## Five required profile identities

All versions are `1`. These are declared identities, with equivalence `not-covered`; the installed proof does not qualify Stage B.

| Profile | Semantic digest |
| --- | --- |
| atomic-units-v1 | `sha256:507fd5a8f5d68a8c2b99c05bee5a23c0ded47d79532ca5edf34ea08c1919958a` |
| immutable-chains-v1 | `sha256:927777f8470be49c968a15cb9bbf2560efdd63bd329d763bfeeb1c166759a3bc` |
| immutable-boundaries-v1 | `sha256:47ee879a5552868ec7cee15f9984cb44f5a72b64aa2b02556232cd0c9037c80f` |
| scope-outbox-v1 | `sha256:d4f1e16890c9541fada3e71e4ba7ba2016da5b07e26383979e29e42b7916b1ed` |
| fenced-writers-v1 | `sha256:48cfb030a1a9c614de6170588116d1afe3d7c94acda79b4322b6b6d7d5156900` |

## Remaining PENDING entries and handoff

- Slot 15, C6 packaging owner: producer JCS bytes/digest are resolved. Dev.6 still omits its announced `contracts/engram-memory-neutral-contract-v1.d.ts` and retains pending declaration/agreement metadata. Require packaged standalone bytes, compilation and producer agreement.
- Slot 16, E9/host-binding owner: integrated `durable-memory.spec.ts` explicitly blocks 23 Stage B cases on E7-fenced-writers; three also depend on E7 host reads. Require the complete zero-skip campaign through the shipped memory read/write and separate host maintenance bindings on the exact tuple. Never promote the current declared claims.
- All other input slots are VERIFIED-CANDIDATE. Every prior reason tied to unpublished Engram 0.21.3, interim intentHash or successor dev.6 bytes is resolved. Plan E11 line 120 does not include the separate L4 MCP 0.22.0 candidate; L5 must bind that candidate independently.
- After those gaps: qualify reserved stable bytes/locks; conductor integration → main PR and exact-head CI; CI-only `cluster-mesh@0.24.0` publication under the reservation; published-byte recheck; explicit producer C9 ACK; independent receiving ACK. Registry observation retained as HTTP 404 for 0.24.0; recheck before release.
- Tuple remains PENDING; final gate refuses it. This receipt records generation and installed checks, without asserting final E2 acceptance or peer consensus. External reviews were requested under rules/subagents.md and were not launched without owner authorization.
