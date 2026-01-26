# Feature: Chatbot Lot B2 — Chat UX actions and composer

## Objective
Implement Chatbot Lot B2 items from `TODO.md` (lines 66–88): user feedback (👍/👎), message-level actions (edit/retry/copy), assistant response copy, and improved chat input (single-line + menu, multi-line growth, future rich text).

## Existing Analysis
- UI chat entry point is `ui/src/lib/components/ChatPanel.svelte`; user messages are plain bubbles with no actions; assistant messages are rendered by `StreamMessage.svelte`.
- Chat input is a `textarea` with Enter-to-send and Shift+Enter line breaks; no single-line mode or action menu.
- Streaming and assistant content handling are centralized in `StreamMessage.svelte` (reasoning, tools, content).
- API exposes `/api/v1/chat/messages` and session endpoints only; no message edit/retry/feedback endpoints yet.
- DB schema includes `chat_messages` without feedback or edit history fields.

## Scope / Guardrails
- Scope limited to Chatbot Lot B2 items only.
- Keep changes minimal; no unrelated refactors.
- All code/comments/docs in English; user communication in French.
- Single data model evolution only. If an extra DB patch is required, reset data using `make db-restore BACKUP_FILE=prod-2026-01-25T17-18-10.dump`.
- Each committable lot must pass `make typecheck` and `make lint`.
- Final tests (after user UAT): `make test-api`, `make test-ui`, `make clean test-e2e`.

## Plan / Todo (linear, test-driven)
- [ ] **Data model (single change)**:
    - [x] Decide storage: new table vs columns in `chat_messages`.
    - [x] Update `api/src/db/schema.ts` + add one migration in `api/drizzle/`.
    - [x] Update `spec/DATA_MODEL.md` immediately after migration.
    - [ ] Validate DB reset strategy ready (only if extra patch required).
- [ ] **Lot 1 Feedback**:
    - [x] Add API endpoint to set feedback on assistant message (👍/👎, toggle).
    - [x] Ensure feedback is returned by `/chat/sessions/:id/messages`.
    - [x] UI: add feedback buttons under assistant message (hover or always visible).
    - [x] UI: persist feedback state on reload (from API).
    - [x] UAT lot 1
        - [x] Test: afficher les boutons 👍/👎 sur réponses assistant.
        - [x] Test: soumettre 👍 puis recharger — état persiste.
        - [x] Test: soumettre 👎 puis recharger — état persiste.
        - [x] Test: changer 👍→👎 — état mis à jour.
- [ ] **Lot 2 Message actions**:
    - [x] Add API endpoint(s) for edit/retry on user messages with history safety.
    - [x] Ensure retry removes subsequent assistant/user messages and re-queues.
    - [ ] UI: add hover action icons under user messages (edit/retry/copy).
    - [ ] UI: add hover action icon under assistant messages (copy).
    - [ ] UAT lot 2
        - [ ] Test: hover sur message utilisateur → icônes visibles.
        - [ ] Test: modifier un message utilisateur (édition) → message mis à jour.
        - [ ] Test: retry d’un message utilisateur → suite supprimée et nouveau stream.
        - [ ] Test: copie d’un message utilisateur → clipboard OK.
        - [ ] Test: copie d’une réponse assistant → clipboard OK.
- [ ] **Lot 3 Composer**:
    - [ ] Implement single-line mode UI (centered text vertically).
    - [ ] Add left “+” menu placeholder (no actions wired yet).
    - [ ] Implement autosize for multi-line (cap at 30% of chat box height).
    - [ ] UAT lot 3
        - [ ] Test: mode monoligne (entrée centrée verticalement).
        - [ ] Test: bouton + visible (menu placeholder).
        - [ ] Test: multi‑ligne auto‑resize ≤ 30% hauteur box.
- [ ] **Docs (spec updates)**:
    - [ ] Update `spec/DATA_MODEL.md` right after migration.
    - [ ] Update `spec/SPEC_CHATBOT.md` after Lot 2 (Lot B2 coverage).
    - [ ] Update `spec/JSON_STREAMING.md` only if streaming payload/UI changed.
    - [ ] Update `spec/SPEC.md` after Lot 3 if user-visible behavior changed.
- [ ] Add i18n strings and UX copy where needed (FR/EN).
- [ ] Tests to update/add (by type + file):
    - [ ] **API tests**:
        - [ ] Add new tests: `api/tests/chat/feedback.test.ts` (feedback create/update/toggle).
        - [ ] Add new tests: `api/tests/chat/message-actions.test.ts` (edit/retry flows, read-only guard).
        - [ ] Update existing: `api/tests/chat/chat-routes.test.ts` (messages include feedback state).
    - [ ] **UI tests**:
        - [ ] Add/extend: `ui/tests/chat-panel.spec.ts` (hover icons, copy, edit UI state).
        - [ ] Add/extend: `ui/tests/stream-message.spec.ts` (assistant copy action).
        - [ ] Add/extend: `ui/tests/chat-composer.spec.ts` (single-line + autosize behavior).
    - [ ] **E2E tests**:
        - [ ] Update: `e2e/tests/03-chat.spec.ts` (feedback, edit, retry, copy).
        - [ ] Update: `e2e/tests/06-streams.spec.ts` (ensure stream remains stable after retry).
- [ ] Run required Make tests per lot (typecheck/lint) and final test suite.
    - [x] UAT-1: `make typecheck` + `make lint`
    - [ ] UAT-2: `make typecheck` + `make lint`
    - [ ] UAT-3: `make typecheck` + `make lint`
    - [ ] Final: `make test-api` + `make test-ui` + `make clean test-e2e`
- [ ] Verify GitHub Actions CI for the branch.

## Commits & Progress
- [x] **Commit 1** (f470d54): Single migration + data model spec
- [x] **Commit 2** (c02a3b2): Feedback API endpoints
- [x] **Commit 3** (88d2bb7): Feedback UI (UAT-1)
- [ ] **Commit 4**: Message actions API (edit/retry)
- [ ] **Commit 5**: UI actions (edit/retry/copy) + assistant copy (UAT-2)
- [ ] **Commit 6**: Composer improvements (UAT-3)
- [ ] **Commit 7**: Test additions + doc updates (specs)

## Status
- **Progress**: Lot 1 complete (UAT done); Lot 2 API in progress
- **Current**: Implementing message actions API (edit/retry)
- **Next**: Implement UI actions for Lot 2
