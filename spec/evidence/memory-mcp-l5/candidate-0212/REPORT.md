# Engram 0.21.2 L5 qualification: FAIL

The candidate is **not accepted** as L5-MEMORY-V1. No acceptance receipt or
receipt digest was issued. L4's exit condition remains unmet.

This is a blocked qualification, not an observed six-tool runtime failure.
Attempt 2 supersedes attempt 1's interpretation of the Docker rule: the owner
explicitly permits existing official targets using `docker run --rm`, under
the shared flock. The official CI gate has been submitted; its execution is
currently waiting for that lock. See `attempt-2-lock.txt` for the captured
holder and nested waiter in `tmp/worktrees/mem-e1`; no L5 container has started.

The [producer audit](PRODUCERS.md) traces the absent proof files to unimplemented
harness lots and predecessor integrations. They are source suites, not outputs
of an omitted pack/receipt/catalog-generation command. In addition, the receipt
verifier explicitly rejects unresolved provenance even for a complete bundle.

## Exact input and passing inspections

- Harness baseline: origin/main `7815a2a8569f44f220fd4daa5e41dae992618e30`;
  existing PR #762 rebased from its attempt 1 baseline `6c3f9f04a`.
- Candidate SHA-256: `a295eef8a1733fd8c00f72ccd6938a5ea11678fdf33848f8849c4d531bd43af8`.
- SHA-512 integrity matches the supplied value; see `inspection.log`.
- P2: `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`, unchanged;
  its two retained archives match SHA-256 and SHA-512 (`p2-archives.tsv`).
- L4 handoff manifest matches P2 and the archive; snapshot SHA-256:
  `36347dfd54337d7ad9134c8d76ec0d1673909fc4f8047dc9005e68fe6438429a`.
- Packed exports equal the L4 handoff inventory. Exact optional peers are platform
  0.4.0 and broker 0.1.0; the optional SDK range is ^1.31.0.
- All 24 packed registry file hashes and the external publisher receipt hash match
  (`registry-digests.tsv`). The receipt is excluded from npm files by design:
  upstream `scripts/gen-mcp-memory-assets.mjs:10-14` explains its tarball self-binding.
- The registry entry digest is `29caca1059c71db403a20e49f20de9cce5489b4b4859afb6f99223338b543b03`;
  sorted compact JSON reproduces the upstream canonicalizer's digest for these bytes.
- Six declared tool names match. This is a static inventory check, not behaviour evidence.

## Blocking proof obligations

`proof-availability.jsonl` lists every missing file and exact catalog command.
P01-P09 each lack required files; P10's files exist but were not executed.
All ten proofs remain unverified against this candidate; none is recorded as passing.

| Proof | Missing files | Required observation still absent |
| --- | ---: | --- |
| P01 context-dispatch | 2 | E4 mesh context and installed identity/source refusal |
| P02 audit-verdict | 1 | Installed candidate audit/verdict refusal |
| P03 digests-schemas | 1 | Schema-profile suite |
| P04 wire-sdk | 2 | Wire-profile and installed SDK discovery/call |
| P05 durable-fences | 2 | SQLite workflow and policy-version persistence |
| P06 crash-lost-ack | 3 | Crash/recovery and installed restart/lost-response |
| P07 assurance-continuation | 3 | OIDC, continuation and installed step-up |
| P08 packaging-disabled | 2 | Installed export graph and disabled-install 0/0/0/0 |
| P09 predecessor-regressions | 4 | Remote dispatch/adapter and host bridge regressions |
| P10 checkpoint-tooling | 0 | An executed, candidate-bound Vitest result |

Main's Makefile accepts only `memory-l5-test LOT=1`, packs only
`STAGE=pre-candidate`, and explicitly says the absent packed suite arrives
in Lot 4. CI `memory-l5-qualification` invokes Lot 1 with P2, not an E4
candidate. There is no implemented candidate-qualification lot to select.

P05's catalog producer is Lot 2; P09's is Lot 3. Both are rejected by the
current runner. The installed P01/P02/P04/P06/P07/P08 sources belong to Lot 4;
the checkpoint input is scheduled for Lot 5+. The exact missing P09 sources
belong to R2 and R7a/BR3 predecessor integrations. No existing official step
generates them. P10's contract tests do not require their source files to exist.

`schema-validator.mjs:351-354` also fails pending predecessor mappings, the
absent Lot 2 assurance verifier, and three unconditional provenance obligations:
`ci.provenance`, `ownerUat.provenance`, `acceptances.provenance`. These prevent
local acceptance independently of test results; they were not removed or waived.

The L4 handoff is not the harness's aggregate candidate manifest: eight required
fields are absent (`inspection.log`). Conversion/packing tooling for that stage is
not implemented. The frozen exports inventory covers broker/platform entries;
the installed engram export-graph proof is absent. Required graph roots
`memory-reference/index.ts` and `verifier.mjs` are absent too.

The L4 manifest and publisher receipt name source `ad96c6815e252daca31389cbe64b992d3e107a35`;
the supplied rebased checkout is `7638249ec9fe5558dde61898cb19372b9702ba1c`.
Their relation is not attested here; the archive digest remains the candidate identity.

## Reproduction and bounded handoff

The inspection command uses `inspection.mk` and only shell/JQ/OpenSSL/tar; it runs
no containers and produces no catalog proof. It must not be counted as acceptance:

```sh
make -f spec/evidence/memory-mcp-l5/candidate-0212/inspection.mk memory-l5-inspect-candidate API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5
```

`gate-dry-run.log` is retained attempt 1 evidence. Attempt 2 submits the actual
official `memory-l5-gate LOT=1` with CI's retained P2 manifest and the same ports/ENV,
under the shared flock. It does not qualify the engram candidate by itself.
The archive SHA-256/SHA-512, P2 binding and static inspection were rerun successfully.

L5 harness owner: complete the catalog-mapped candidate lots and authenticated
provenance verification, preserving every proof, pinned image and receipt check. Acceptance requires
actual candidate-bound results for P01-P10, installed six-tool behaviour, disabled
0/0/0/0 and a schema-valid, evidence-backed checkpoint. L4 owner: attest the
pre-rebase source mapping without changing the qualified tarball identity.

Deployed host bindings, native SQLite/PostgreSQL and key cleanup remain **unverified**.
