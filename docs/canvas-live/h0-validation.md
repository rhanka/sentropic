# H0 validation receipt

Scope: approved host plan H0 only, based on `5e986a0b6cd2dfecfbde6a588d30055271124696`. This receipt records preparation checks; future B1/CL/FE behavior witnesses remain pending. No runtime, dependencies, schemas, migrations, comments contract or normative source files changed.

## Reproduce locally

Use the repository make workflow. `/tmp/canvas-h0.mk` below is a disposable external task makefile, not a branch worktree or artifact location; it avoids changing the forbidden repository `Makefile`:

```make
SHELL := /bin/bash
.PHONY: canvas-task
canvas-task:
	@$(value CMD)
```

```sh
rtk make -f /tmp/canvas-h0.mk canvas-task CMD='rtk bash docs/canvas-live/verify-h0.sh' ENV=test-canvas-h0
rtk make scope-check ENV=test-canvas-h0
```

Measured result after review corrections: `PASS C1 (sentropic)`, 46/46 input SHA-256 checks OK, then `PASS H0: 46 input hashes; 29 UI cases; 12 payload cases; 24 unique mounts / 10 files / 7 plain; 8 receipts; scope unchanged.` The checker asserts the manifest line count too. `make scope-check` returned `PASS C2 (sentropic)` before each commit. The first branch-plan commit replaces the inherited unrelated main-branch BRANCH.md using the prescribed template; no main checkout edits are included.

The checker verifies JSON parsing, unique case IDs, exact corpus mount union, the ten source files and every mount line, 24 total source mounts, seven plain rows, eight unique receipt rows, sibling payload preservation, no request before creation, source/fixture byte hashes and allowed diff paths. It does not execute either editor or claim source inspection as B1 execution parity. No API/UI/E2E behavior test is added or changed for this fixture/documentation lot. No service stack was started; no UAT or runtime log claim is made.

Input authority hashes were recomputed: approved host plan r3 `a48f54be6ce82b05e697f1c3f7dbc433ed60b69f5c2e377b6fb71faad9ababe7` (supersedes r2 `f130f04c4597b483b089ef5b3b6d6d9502b61a36111859f62f835b37c9bc19e2`); historical Opus r2 approval `2b8849cc3d377642d02a872cdd307cb45d64d07a3e52262c27c1f149e86c2b65`; norm inventory `53b8928bb7834b1a849e7656b4a11bb69ee2b776394c9995c12e411eb39c6409`; dossier r4b `b153f3cb60bbfa3b7d6e3b5f40a79dc04f6f5c7a67b5d31e9d28cebd87c6d364`; frozen DS source `161c5dac35d1cfe6b4a1937fe2f38f900e3f73d24cbae1cbb802b4036ee36834`; annotations v1 `e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0`. All match the supplied pins; file inputs are separately reproducible through the committed manifest.

Independent public-source reviews of `919c34c19550f613b4fcb9c954ab8c8e4a37f8ac` returned APPROVE and CHANGES. Source verification accepted F1–F6: remap prose normalizer cases, separately assert list arrays and folder-context passthrough, document the single-key `saveValue` override, repair provenance ranges, and hash extensions/package requests. Reviews of correction head `4bb5a2199d0d7158370d37e3a0115aa87c17bd03` accepted those six fixes, but one requested an explicit inbound-only assertion boundary and a hashed list-codec behavior source. Both refinements are included here; the literal normalized string is never claimed as a top-level HTTP-body oracle. These changes affect fixture expectations and evidence only. Final review and exact-head CI receipts attach to draft PR #823 when measured. The draft remains unmerged with BRANCH.md retained; no Track work was created or duplicated.

Review procedure exception: the Sonnet correction reviewer reported one prohibited Python invocation during an intermediate fixture check, then repeated the check with `jq`. It left no repository artifact, and no accepted result depends on it. This violated the owner's execution constraint and is preserved in the review record and reported to the owner; no zero-Python execution claim is made for the review process. The author checker uses Bash/jq, and no Python file is introduced. Requested reviewer identities are Claude/`claude-opus-5`/high and Claude/`claude-sonnet-5`/high, complementary to the declared Codex/`gpt-6.1-sol`/high author; requested identity does not attest effective post-routing identity.

PR #823 Opus r1 on `42548d0e53d09517d9b0b41b0269a8ca500f0e52`: F1/F2 accepted and corrected on 2026-10-28 using the owner's direct Q-CL-1 answer. Gates, corpus, N7 and removals now require DS full-profile coverage before one 24-site adoption. Former D-LIST/D-PRESERVED/D-PASTE fixture oracles are P coverage obligations; P-MATRIX-DECISION retains parity pending Q-B1-4. Only oracle metadata and its input hash change; content, counts, routes, authorities and runtime behavior stay unchanged. Independent re-review and CI on the correction head must be measured separately; this receipt does not claim approval of these corrections.

PR #823 Opus r2 on `b3ce5815396793d6a88c67f813b097424375ea7e`: F2/F3 verified against approved r3 and the configured editor, then corrected. Badge adoption/removal stays H7/CL-1B with a separate parity witness; FieldCard stays in CL-5. CL-2F covers every configured StarterKit 3.31.3 construct and interaction plus tiptap-markdown 0.9.0 round-trip. The two synthetic preserved/paste inputs now explicitly require editable coverage of quotes, code, marks, rules and breaks; only schema-absent tables/images carry G/DS raw preservation. Counts and 13 oracles remain unchanged; hashes are refreshed. F1 remains pending until completed/success CI including ci-gate is observed on the final exact head; no approval of these corrections is inferred.

F1 correction-head receipt: [CI 40741239069](https://github.com/rhanka/sentropic/actions/runs/40741239069), `workflow_dispatch`, exact head `495a35734c8657a0bbf24e9c96c0b8ba6b736312`, **completed/success**, including **ci-gate**, all five E2E groups, VSCode E2E, IdP screens and container security. The checklist records this observed success. This documentation-only receipt commit still requires its own exact-head CI success before handoff; the final run/SHA are reported externally without another commit that would move the head.
