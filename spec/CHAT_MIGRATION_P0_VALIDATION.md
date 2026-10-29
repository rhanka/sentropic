# P0 — Author qualification and review receipt

Date: 2026-10-28. Draft PR: [#816](https://github.com/rhanka/sentropic/pull/816). Baseline: `ea20bd9c026e9717d911514e763f8911b6981dde`. Reviewed contract candidate: **`64521846e5350648c7715f35ea97e4c9321f6dee`**. Later receipt/checklist edits add no migration decision or implementation change.

## Mechanical qualification

| Check | Result / evidence boundary |
| --- | --- |
| Package source relocation map | **103/103** tracked source/declaration paths; no missing or extra row. |
| Package tests/support map | **94/94** tracked non-source paths; mixed test custody explicitly split. |
| Public export map | **68/68** `package.json` export keys; symbol/re-export declarations inventoried separately. |
| Sending-tree consumer census | **99/99** case-insensitive `chat-ui` matches at the pinned baseline, excluding package/spec/plan/checklist; includes CI/E2E and retained historical evidence. |
| Global selector references | **125/125** inventoried selector texts match the exact first-token source line; shared nested base/utility rules retain their owning host blocks. Semicolon hover directive recorded separately. |
| App Widget snippets | **13/13** named snippets; 767-line header-actions span classified with explicit reusable/host split. |
| Widget styling baseline | **75** `dark:` tokens on 25 lines, preserved as measured baseline; zero implementation changes in P0. |
| Scope and links | Only `BRANCH.md` and `spec/CHAT_MIGRATION_P0*.md`; local appendix links resolve; full diff whitespace check passes. |
| Atomic history | Every branch commit has at most **150** added+deleted lines, uses `make commit`, and has no AI/co-author trailer. |
| DS evidence | Downloaded Svelte 0.36.0 and themes 0.11.0 archives match registry SHA-512 and recorded SHA-256; actual emitted exports/APIs inspected. This is not a browser/install test. |

Local checks used `make` with `ENV=test-chat-p0` last: installed host `harness check branch` with actual/expected branch; `make -f Makefile -f /tmp/chat-p0.mk -o build-harness scope-check`; read-only census/selector/link/history checks through the same external make overlay. The overlay changes no tracked Makefile and avoids its Docker build prerequisite. No container was started; no application unit/E2E campaign or personal UAT is claimed for this documentation lot.

## Independent review reconciliation

Author metadata supplied by the launch request: host **codex**, model **gpt-6.1-sol**, effort **high**. Both independent legs requested a different host and different exact declared model ID; neither launch metadata nor this receipt attests the effective post-routing provider identity.

| Round / requested reviewer | Lens | Result / disposition |
| --- | --- | --- |
| r1 / Claude `claude-opus-4-8`, high | Boundary, authority, releases, owner UAT | **APPROVE**; accepted refinements clarify the conductor's owner-summary reconciliation and split mixed DOM/runtime test custody. |
| r1 / Claude `claude-sonnet-5`, high | Inventory, dependency closure and evidence | **CHANGES**; accepted missing bare-name CI/E2E/reference matches and incorrect selector line offsets. Expanded census and corrected all 125 lines in bounded commits. |
| r2 / Claude `claude-opus-4-8`, high | Same boundary lens on exact candidate above | **APPROVE**; no blocker; authority and owner-held gates preserved. |
| r2 / Claude `claude-sonnet-5`, high | Same evidence lens on exact candidate above | **APPROVE**; independently recomputed **99/99** consumers and **125/125** selector locations; no remaining discrepancy. |

Consensus on the reviewed contract candidate: **APPROVE, 2/2 completed eligible legs, no failed dispatched leg**. Readable local artifacts: `.tmp/chat-p0-review/{boundary,evidence,boundary-r2,evidence-r2}.md`; aggregate `.tmp/chat-p0-review/dossier.md`. No reviewer acknowledgement substitutes for a domain owner or the owner's personal tests.

## External acceptance still pending

Sentropic integration conductor and DS maintainer received live h2a requests; final-candidate requests are `env:send:17fda830-d30d-4452-9d5f-5bf9522abf35` and `env:send:62c4e209-f1c6-4946-be10-66995b2af9f2`. Architect co-freeze was routed through the conductor. **No reply/contract acknowledgement is evidenced in this receipt.** The conductor remains responsible for the single-writer Track disposition/acknowledgement trace and owner-summary refresh before P1 dispatch. Root Track and the DS repository were not edited.

P0 authoring/review readiness is distinct from P0 domain co-freeze acceptance. U0 personal tests, separate UAT GO/transfer GO and npm authorization remain held exactly as the contract states. The draft is not a transfer, publication or merge authorization.

Final CI acceptance requires GitHub Actions **completed / success on the exact final pushed head**. Its run URL and head are recorded in the PR's final qualification comment after the last push; this committed receipt does not pre-claim that external result or treat earlier-candidate CI as final-head evidence.
