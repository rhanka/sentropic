# H0 validation receipt

Scope: approved host plan H0 only, based on `5e986a0b6cd2dfecfbde6a588d30055271124696`. This receipt records preparation checks; future B1/CL/FE behavior witnesses remain pending. No runtime, dependencies, schemas, migrations, comments contract or normative source files changed.

## Reproduce locally

Use the repository make workflow. An external task makefile avoids changing the forbidden repository `Makefile`:

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

Measured result after review corrections: `PASS C1 (sentropic)`, 45/45 input SHA-256 checks OK, then `PASS H0: 45 input hashes; 29 UI cases; 12 payload cases; 24 unique mounts / 10 files / 7 plain; 8 receipts; scope unchanged.` `make scope-check` returned `PASS C2 (sentropic)` before each commit. The first branch-plan commit replaces the inherited unrelated main-branch BRANCH.md using the prescribed template; no main checkout edits are included.

The checker verifies JSON parsing, unique case IDs, exact corpus mount union, the ten source files and every mount line, 24 total source mounts, seven plain rows, eight unique receipt rows, sibling payload preservation, no request before creation, source/fixture byte hashes and allowed diff paths. It does not execute either editor or claim source inspection as B1 execution parity. No API/UI/E2E behavior test is added or changed for this fixture/documentation lot. No service stack was started; no UAT or runtime log claim is made.

Input authority hashes were recomputed: approved host plan `f130f04c4597b483b089ef5b3b6d6d9502b61a36111859f62f835b37c9bc19e2`; Opus r2 approval `2b8849cc3d377642d02a872cdd307cb45d64d07a3e52262c27c1f149e86c2b65`; norm inventory `53b8928bb7834b1a849e7656b4a11bb69ee2b776394c9995c12e411eb39c6409`; dossier r4b `b153f3cb60bbfa3b7d6e3b5f40a79dc04f6f5c7a67b5d31e9d28cebd87c6d364`; frozen DS source `161c5dac35d1cfe6b4a1937fe2f38f900e3f73d24cbae1cbb802b4036ee36834`; annotations v1 `e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0`. All match the supplied pins; file inputs are separately reproducible through the committed manifest.

Independent public-source reviews of `919c34c19550f613b4fcb9c954ab8c8e4a37f8ac` returned APPROVE and CHANGES. Source verification accepted F1–F6: remap prose normalizer cases, separately assert list arrays and folder-context passthrough, document the single-key `saveValue` override, repair provenance ranges, and hash extensions/package requests. These changes affect fixture expectations and evidence only. Both reviewers are asked to recheck the published correction head; final review and exact-head CI receipts attach to draft PR #823 when measured. The draft remains unmerged with BRANCH.md retained; no Track work was created or duplicated.
