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
- [x] **Data model (single change)**:
    - [x] Decide storage: new table vs columns in `chat_messages`.
    - [x] Update `api/src/db/schema.ts` + add one migration in `api/drizzle/`.
    - [x] Update `spec/DATA_MODEL.md` immediately after migration.
    - [ ] Validate DB reset strategy ready (only if extra patch required).
- [x] **Lot 1 Feedback**:
    - [x] Add API endpoint to set feedback on assistant message (👍/👎, toggle).
    - [x] Ensure feedback is returned by `/chat/sessions/:id/messages`.
    - [x] UI: add feedback buttons under assistant message (hover or always visible).
    - [x] UI: persist feedback state on reload (from API).
    - [x] `make typecheck` + `make lint`
    - [x] UAT lot 1
        - [x] Test: afficher les boutons 👍/👎 sur réponses assistant.
        - [x] Test: soumettre 👍 puis recharger — état persiste.
        - [x] Test: soumettre 👎 puis recharger — état persiste.
        - [x] Test: changer 👍→👎 — état mis à jour.
- [x] **Lot 2 Message actions**:
    - [x] Add API endpoint(s) for edit/retry on user messages with history safety.
    - [x] Ensure retry removes subsequent assistant/user messages and re-queues.
    - [x] UI: add hover action icons under user messages (edit/retry/copy).
    - [x] UI: add hover action icon under assistant messages (copy).
    - [x] `make typecheck` + `make lint`
    - [x] UAT lot 2
        - [x] Test: hover sur message utilisateur → icônes visibles.
        - [x] Test: modifier un message utilisateur (édition) → message mis à jour.
        - [x] Test: retry d’un message utilisateur → suite supprimée et nouveau stream.
        - [x] Test: copie d’un message utilisateur → clipboard OK.
        - [x] Test: copie d’une réponse assistant → clipboard OK.
- [x] **Lot 3 Composer**:
    - [x] Implement single-line mode UI (centered text vertically).
    - [x] Add left “+” menu placeholder (no actions wired yet).
    - [x] Implement autosize for multi-line (cap at 30% of chat box height).
    - [x] Fix autosize + scrollbar behavior (UAT feedback).
    - [x] `make typecheck` + `make lint`
    - [x] UAT lot 3
        - [x] Test: mode monoligne (entrée centrée verticalement).
        - [x] Test: bouton + visible (menu placeholder).
        - [x] Test: multi‑ligne auto‑resize ≤ 30% hauteur box.
- [x] **Lot 4A Rich text input + copy/paste**:
    - [x] Switch composer to `EditableInput` (rich text paste support).
    - [x] Use `EditableInput` for user message edit (Lot 2) to support rich text.
    - [x] Ensure copy action preserves rich text when possible (fallback to plain text).
    - [x] `make typecheck` + `make lint`
    - [x] UAT lot 4A
        - [x] Test: collage rich text dans le composer (styles conservés).
        - [x] Test: édition d’un message utilisateur en rich text.
        - [x] Test: copier/coller d’un message conserve le rich text (ou fallback propre).
- [ ] **Lot 4B Chat session documents (upload + résumé + doc tool)**:
    - [ ] Add document upload to chat session (paperclip in the "+" menu).
    - [ ] Generate automatic summary (short/long) for attached docs.
    - [ ] Ensure doc tool can access session-attached docs.
    - [ ] `make typecheck` + `make lint`
    - [ ] UAT lot 4C
        - [ ] Test: upload document via trombone dans le chat.
        - [ ] Test: résumé auto créé (court/long selon taille).
        - [ ] Test: doc tool utilise les docs attachés à la session.
- [ ] **Lot 4C Composer menu content (tools/context)**:
    - [ ] List tools and contexts in the “+” menu (checkable).
    - [ ] Add multi-context mode: context additions when switching views (last added has priority).
    - [ ] Allow toggling tools/contexts from the menu.
    - [ ] `make typecheck` + `make lint`
    - [ ] UAT lot 4B
        - [ ] Test: menu “+” affiche tools + contextes.
        - [ ] Test: toggle tool/context ON/OFF persiste pour la session.
        - [ ] Test: multi‑contexte: changement de vue ajoute le contexte, priorité au dernier.
- [ ] **Docs (spec updates)**:
    - [ ] Update `spec/DATA_MODEL.md` right after migration.
    - [ ] Update `spec/SPEC_CHATBOT.md` after Lot 2 (Lot B2 coverage).
    - [ ] Update `spec/JSON_STREAMING.md` only if streaming payload/UI changed.
    - [ ] Update `spec/SPEC.md` after Lot 4 if user-visible behavior changed.
- [ ] Add i18n strings and UX copy where needed (FR/EN).
- [ ] Tests to update/add (by type + file):
    - [ ] **API tests**:
        - [ ] Add new tests: `api/tests/chat/feedback.test.ts` (feedback create/update/toggle).
        - [ ] Add new tests: `api/tests/chat/message-actions.test.ts` (edit/retry flows, read-only guard).
        - [ ] Update existing: `api/tests/chat/chat-routes.test.ts` (messages include feedback state).
        - [ ] Add new tests: `api/tests/chat/session-docs.test.ts` (upload + summary + doc tool access).
    - [ ] **UI tests**:
        - [ ] Add/extend: `ui/tests/chat-panel.spec.ts` (hover icons, copy, edit UI state).
        - [ ] Add/extend: `ui/tests/stream-message.spec.ts` (assistant copy action).
        - [ ] Add/extend: `ui/tests/chat-composer.spec.ts` (single-line + autosize behavior).
        - [ ] Add/extend: `ui/tests/chat-composer-menu.spec.ts` (menu content, toggles, multi-context).
        - [ ] Add/extend: `ui/tests/chat-richtext.spec.ts` (EditableInput, paste, edit flow).
        - [ ] Add/extend: `ui/tests/chat-docs.spec.ts` (upload, summary badge, menu list).
    - [ ] **E2E tests**:
        - [ ] Update: `e2e/tests/03-chat.spec.ts` (feedback, edit, retry, copy).
        - [ ] Update: `e2e/tests/03-chat.spec.ts` (menu tools/context toggles, rich text copy/paste).
        - [ ] Update: `e2e/tests/06-streams.spec.ts` (ensure stream remains stable after retry).
        - [ ] Update: `e2e/tests/03-chat.spec.ts` (document upload + summary + doc tool usage).
- [ ] Run final test suite.
    - [ ] `make test-api` + `make test-ui` + `make clean test-e2e`
- [ ] Verify GitHub Actions CI for the branch.

## Commits & Progress
- [x] **Commit 1** (f470d54): Single migration + data model spec
- [x] **Commit 2** (c02a3b2): Feedback API endpoints
- [x] **Commit 3** (88d2bb7): Feedback UI (UAT-1)
- [x] **Commit 4** (6a28f92): Message actions API (edit/retry)
- [x] **Commit 5** (023875c): UI actions (edit/retry/copy) + assistant copy (UAT-2)
- [x] **Commit 6** (32d9ee4): Composer improvements (UAT-3)
- [ ] **Commit 7**: Test additions + doc updates (specs)

## Status
- **Progress**: Lot 3 implementation done (UAT pending)
- **Current**: UAT lot 3 ready for user testing
- **Next**: Lot 4A/4B planning + implementation, then specs/tests updates
