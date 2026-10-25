# L0 validation and evidence receipt

Author: codex / gpt-6.1-sol / high. Date: 2026-10-25 UTC. Base: `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`. This record covers documentation and source/metadata inspection; it is not STT, native-agent, device, latency, financial, license or production acceptance.

## Reproducible source anchors

- Approved local spec SHA-256: `5a666faa9e1856245ef94b19988cb08514e6e1aeac32918715c07f8ce4a24c61`; verbatim answers: `a43cb38c831eb6fe58ea24d06ae98460eb62dc0cf26c4561f3c2bea741681b6a`.
- Opus r3 review SHA-256: `38744d852469b9955fdd3e3bd7ddb55cfa74c4da849c1f35f92afafe012bc52b`; Docker lock: `a6c3624f714dfc5457c7b17903d562be0ff5ab0440f9c2536643c8002f81b9c5`.
- Sentropic source: [gateway host composition](https://github.com/rhanka/sentropic/blob/fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6/api/src/routes/namespaces/gw.ts), [durable budget admission](https://github.com/rhanka/sentropic/blob/fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6/api/src/services/llm-metering/budget-admission.ts), [settlement](https://github.com/rhanka/sentropic/blob/fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6/api/src/services/llm-metering/route-settlement.ts).
- h2a upstream: [driver](https://github.com/rhanka/h2a/blob/40693473a6e38d3230742ba969f18d34dc3cd78c/packages/h2a/src/runtime/drive/index.ts), [runtime manifest](https://github.com/rhanka/h2a/blob/40693473a6e38d3230742ba969f18d34dc3cd78c/packages/h2a-runtime/package.json), [Claude runner](https://github.com/rhanka/h2a/blob/40693473a6e38d3230742ba969f18d34dc3cd78c/packages/h2a-runtime/src/claude-code-cli-runner.ts).
- Public registry metadata: `https://registry.npmjs.org/<package>/<exact-version>`; versions and integrities recorded in dependencies.md and scope-release.md. No tarball, model or native binary was installed/downloaded by L0.
- ONNX installer files were fetched only as text from unpkg, hashed and statically inspected; source hashes and the CPU skip-path limits are in dependencies.md.
- GitHub PR metadata reads used the connected GitHub tool; raw tree/ref/installer/npm metadata used read-only Make recipes. The h2a recursive tree at the frozen upstream SHA reported `truncated=false`; GitHub compare supplied a 300-file page, not a complete changed-file inventory.

## Checks

- [x] Harness C1 branch check passed after worktree creation and again with explicit expected/current `feat/live-stt-l0`.
- [x] Harness C2 scope checks passed before each substantive commit; selective staging and changed-line checks kept every commit below 150 lines.
- [x] Final cumulative Markdown-only path/whitespace/local-link/gate/tuple/arithmetic checks passed: eight documents, 19 unique gate rows, 1,025 units, 750 interruptions, 2/6/8/10/20/50 daily-share arithmetic and aggregate $20 envelope.
- [x] Approved input hashes and all six exact SDK registry integrity values rechecked; three in-house registry observations/integrities retained separately in scope-release.md.
- [x] ENV-scoped locked cleanup completed with exit zero on 2026-10-25; compose reported unset optional configuration, with no resources started or other ENV touched.
- [ ] Draft PR created with BRANCH.md as its body; final CI metadata inspected and reported separately.

The repository's normal `make scope-check` invokes raw Docker for this ENV; that conflicts with the supplied compose-only lock. An external Make file supplies the identical installed-host `harness check scope --branch-md ... --staged-files ...` recipe while `-o build-harness` suppresses the incompatible prerequisite. No tracked Makefile/compose/CI source was changed. Each check still validates the actual staged+unstaged paths mechanically. Untracked new files were staged explicitly before their scope check.

The external validation Make recipes ran Perl text/hash/link checks, exact-version public registry integrity checks, `git diff --check`, cumulative allowed-path checks, per-commit changed-line arithmetic and attribution-trailer checks. Before this validation commit the five commit sizes were 112, 107, 83, 122 and 89 changed lines. These external helpers are inspection tooling, not shipped test/build inputs or a new runtime dependency.

All shell commands after bootstrap reads ran through RTK-prefixed Make recipes, with `ENV=test-live-stt-l0` last; Docker cleanup uses the required outer flock. No host npm/Python, ad-hoc Docker, paid API, microphone, model download, login/refresh, credential console or shared Track writer was used. The first fetch required protected Git metadata access; the granted escalation only enabled the requested Git worktree/commit/push operations.

## Inspection limitations and preserved failures

- The root/h2a worktrees contain concurrent work and were never reset/staged/committed by this task. h2a local profile edits are explicitly excluded from the frozen upstream findings.
- Faster-whisper upstream does not expose `main`; `ls-remote --symref origin HEAD` identifies `typescript`. Its local-to-upstream compare returned 404, so no ancestry claim is made; only package/build-script observations were reconciled.
- Initial optional metadata queries used stale paths from historical notes; targeted source reads established the correct seat addendum and current ledger files. The exact cluster 0.22.1 query returned HTTP 404; its string body cannot be parsed as a package object. No runtime or install retry followed.
- No current provider schemas, speech prices, account entitlements, live quota or allocator reservations were verified; those remain G-CLOUD/G-QUOTA. Registry SDK presence does not establish endpoint/model support.
- General durable ledger source exists, but no DB was started and its tests were not rerun; audio-unit/daily/campaign acceptance remains G-LEDGER.
- License/distribution and no-interpreter installation/run receipts remain absent; no toolchain or native model artifact is admitted.
- Independent L0 consensus was not obtained; [review.md](review.md) records selection failure without a verdict. The r3 spec approval remains separate.

No application test campaign is appropriate for a cumulative documentation-only change. Local validation covers document consistency and evidence arithmetic; CI metadata, when available, provides a separate exact-head repository check. Paid/native/device acceptance stays with the future admitted lots, without weaker sample counts or invented passes.
