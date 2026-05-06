# BR16a Rectification Plan - Prod Secrets and Clean Reopen

## Objective

Reopen BR16a cleanly by removing every unrequested production/CD change that pushed secrets at the Scaleway container level, restore the intended namespace-level secret model, validate a manual production deployment outside CI, then remerge BR16a through a clean PR.

## Exact Execution Plan

1. Verify the real git state.
   - Confirm `d0640140` and related prod-fix commits are not on `main`.
   - Confirm which BR16a commits still contain unrequested CD/container secret changes.
   - Identify the last healthy `main` commit before BR16a.
   - Identify the BR16a state to reopen before finalization and before `BRANCH.md` deletion.

2. Reopen BR16a cleanly.
   - Recreate/update a BR16a worktree from the functional BR16a product state.
   - Remove all out-of-scope commits and changes:
     - Scaleway `secret-environment-variables` injection at container level.
     - `PGSSLMODE` / `DB_SSL_CA_PEM_B64` deployment experiments in CI/CD.
     - Experimental prod-fix commits.
     - Any CD change not explicitly validated for BR16a.
   - Keep only BR16a product scope:
     - Google Drive OAuth.
     - Picker/import.
     - In-situ document indexing.
     - Settings UI.
     - Tests.
     - BR16a specs and docs.

3. Restore the intended Scaleway secret model.
   - Remove Google/DB/AI secrets that were pushed at the Scaleway container level by the bad deploy path.
   - Push Google OAuth / Picker secrets at the Scaleway namespace level, aligned with the existing secret model.
   - Do not print secret values in logs or markdown.
   - Verify the API container no longer has parasite container-level secrets from the bad deploy attempts.

4. Manual production deployment check outside CI before remerge.
   - Deploy the cleaned BR16a API/UI images manually to the production containers outside the GitHub CD path.
   - Verify API health and startup migrations.
   - Verify mail sending still works in production because mail secrets are part of the runtime dependency set.
   - Verify Google Drive OAuth and Picker in production with the existing CDP/browser session.
   - Verify import from Drive until a document is attached, indexed, visible, and downloadable with the correct filename/export behavior.
   - Roll back to the known healthy production image after validation unless explicitly instructed otherwise.

5. Let the user run UAT.
   - Keep the manually deployed BR16a state available only if explicitly approved for UAT.
   - Provide the exact UAT checklist:
     - Google Drive connect/disconnect from Settings.
     - Add file from chat menu through Drive.
     - Add file from document band through Drive.
     - Native Google Docs/Sheets/Slides import.
     - PDF/DOCX/PPTX import.
     - Download filenames and native export behavior.
     - Mail flow still sends and is received.

6. Finalize BR16a.
   - Add a finalization lot in `BRANCH.md` covering namespace secrets, container-secret cleanup, manual MEP validation, mail validation, rollback, and CD non-regression.
   - Consolidate relevant `SPEC_EVOL` content into stable specs/docs.
   - Move the BR16a branch plan into `plan/done/`.
   - Remove the root `BRANCH.md` symlink/file only at the final PR stage.

7. Clean PR and merge.
   - Push the cleaned BR16a branch.
   - Open/update a clean PR with `BRANCH.md` as the body.
   - Wait for CI to be green.
   - Confirm CD no longer injects container-level secrets.
   - Merge only after CI green and UAT/manual MEP validation are complete.

## Non-Negotiables

- No raw secret value in logs, markdown, commits, or chat.
- No container-level secret injection in CI/CD.
- No direct production CD experiments on `main`.
- No merge before manual production deployment check outside CI.
- No BR16a finalization until mail and Google Drive production behavior are both verified.
