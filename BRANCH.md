# Feature: Add GPT-5.2 model options

## Objective
Expose `gpt-5.2` and `gpt-5.2-pro` as selectable OpenAI models in the application (UI settings), and harden the API against malformed list outputs (empty bullets, nested bullet prefixes) coming from LLM responses.

## Plan / Todo
- [ ] Add branch documentation (this file) and keep it updated per commit
- [ ] Add `gpt-5.2` and `gpt-5.2-pro` to the UI model selector
- [ ] Implement server-side normalization for list fields returned by the LLM (remove marker-only items, strip bullet prefixes, split multi-line bullet blocks)
- [ ] Run relevant tests via `make` (UI + API where applicable)
- [ ] Update `TODO.md` (check item) and reference PR/branch if needed

## Commits & Progress
- [ ] **Commit 1**: Add `BRANCH.md` + UI model options
- [ ] **Commit 2**: API list-field normalization + unit tests
- [ ] **Commit 3**: Docs (analysis) + TODO update

## Status
- **Progress**: 0/5 tasks completed
- **Current**: Finalizing tests + commits
- **Next**: Push branch, open PR


