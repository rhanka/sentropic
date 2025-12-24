# Feature: Add GPT-5.2 model options

## Objective
Expose `gpt-5.2` and `gpt-5.2-pro` as selectable OpenAI models in the application (UI settings), and harden the API against malformed list outputs (empty bullets, nested bullet prefixes) coming from LLM responses.

## Plan / Todo
- [x] Add `gpt-5.2`, and select relevant models in the UI model selector
- [x] Implement server-side normalization for list fields returned by the LLM (remove marker-only items, strip bullet prefixes, split multi-line bullet blocks)

## Commits & Progress
- [x] **Commit 1**: Add `BRANCH.md` + UI model options
- [x] **Commit 2**: API list-field normalization, prompt adaptation



