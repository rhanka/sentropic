# Feature: BR-16c — Google Drive Shared Edit and Sync Follow-Up

## Objective

Extend the BR-16a Google Drive connector after the first OAuth + Picker + `document_summary` integration is validated.

BR-16c owns collaboration and lifecycle features that are intentionally deferred from BR-16a: shared Drive/document assistance, change detection, queued summary regeneration, direct Google Docs editing, and Google Slides/PPT generation/editing.

## Scope / Guardrails

- Scope limited to Google Drive follow-up behavior after BR-16a.
- Do not implement SharePoint/OneDrive here; BR-16b owns non-Google connectors.
- Do not replace BR-17 RAG; if semantic retrieval is needed, coordinate with BR-17.
- Keep source documents in Google Drive.
- Preserve the BR-16a connector account and document source model.

## Feedback Loop

- [ ] `attention` BR16c-Q1 — Sharing assistance scope: should Sentropic only detect/report missing permissions, or also guide/share Drive objects through Google APIs?
- [ ] `attention` BR16c-Q2 — Change detection strategy: polling, Google Workspace Events/webhooks, or user-triggered stale checks.
- [ ] `attention` BR16c-Q3 — Regeneration policy: when a Drive revision changes, should Sentropic auto-enqueue `document_summary`, ask the user first, or mark stale only?
- [ ] `attention` BR16c-Q4 — Direct Google Docs editing tool scope: patch text/sections only, structured document edits, or full doc generation into Google Docs.
- [ ] `attention` BR16c-Q5 — Google Slides/PPT scope: generate Slides directly, edit existing Google Slides, or export PPTX through a `pptxgenjs`-style renderer.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline from BR-16a**
  - [ ] Read BR-16a merged implementation and final spec.
  - [ ] Confirm connector account, source document schema, and `document_summary` behavior.
  - [ ] Finalize BR16c-Q1 to BR16c-Q5.

- [ ] **Lot 1 — Shared Drive and permission assistance**
  - [ ] Detect whether the acting user's Google account can access an attached Drive file.
  - [ ] Surface missing permissions clearly in document status/tool responses.
  - [ ] Add sharing assistance only if approved.

- [ ] **Lot 2 — Change detection and stale status**
  - [ ] Track Drive revision/version changes.
  - [ ] Mark documents stale when the Drive source changes.
  - [ ] Define notification surface.

- [ ] **Lot 3 — Queued summary regeneration**
  - [ ] Enqueue `document_summary` regeneration when a stale Drive document is approved for refresh.
  - [ ] Preserve manual resync from BR-16a.
  - [ ] Record old/new revision metadata.

- [ ] **Lot 4 — Direct Google Docs editing tool**
  - [ ] Add a tool equivalent in intent to the DOCX/freeform path, but targeting Google Docs.
  - [ ] Keep explicit user authorization and audit history.

- [ ] **Lot 5 — Google Slides / PPT tool**
  - [ ] Add generation/editing path for Google Slides or PPT-like output.
  - [ ] Coordinate with BR-21 `pptxgenjs` decisions where relevant.

- [ ] **Lot 6 — Final validation**
  - [ ] Typecheck/lint/API tests/UI tests.
  - [ ] UAT on shared Drive document, changed revision, summary regeneration, and direct edit if implemented.
