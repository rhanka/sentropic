# N3 — Airbus dossier publish contract `airbus-dossier-publish/1.0.0` (DRAFT r3)

Status: `FROZEN r3.1` (2026-11-07) — author ab-assistant, reviewed by s-conductor, co-signed by h-cond. Pending code: built form + payload.build (h2a R5 lot), `invalid-not-built` fixture.
Serves: O7 (S1, S3), O1 (S1, S2), later O8 (chapter-by-chapter dossiers).

## 1. Principle: wrap and reuse, do not redefine
- Dossier body: the existing **`DecisionDossierDocument`** (`urn:sentropic:focus:DecisionDossierDocument:1.0.0`,
  and `:2.0.0` with embedded evidence), validated by the **h2a focus-kit `validator.mjs`** (zero dependency,
  validatorVersion 0.5.0, sha256 `c5b3afce…ad2ea4`, shipped in h2a 0.98.8, vendored here under `vendor/focus-kit/`).
  The v1 schema file sha256 `725bc07e…8c8852` matches the DS catalog `DecisionDossier` entry and the focus-kit manifest.
- Body carrier: the existing **DS render envelope** of the `DecisionDossier` component (`contract: "1.0"`), so the
  same JSON feeds `render_DecisionDossier`.
- Renderer (N2): the existing **h2a focus-kit `renderer.html`** (rendererVersion 0.98.7, sha256 `6a6e62aa…77d305`,
  capability `embedded-offline`, formats 1 and 2). Verified 2026-11-07: the template dossier, built by
  `focus-build` and opened in headless Chromium with all network routed to a dead proxy, renders fully (questions,
  options, interactive diagram). Its only `http(s)` strings are Svelte/xyflow error-message links (no fetch).
- This contract adds only an outer **publish envelope**: artifact identity and version, producer, residency,
  integrity.

## 2. Shape

```jsonc
{
  "contract": "airbus-dossier-publish/1.0.0",          // const
  "artifact": {
    "id": "o7-hello-dossier",                           // ^[a-z0-9][a-z0-9-]{2,63}$, stable across versions
    "version": 1,                                       // integer >= 1, strictly increasing per id (store-enforced)
    "title": "…",                                       // 1..200 chars
    "createdAt": "2026-11-11T14:00:00Z",                // RFC 3339 UTC
    "chapter": { "index": 1, "of": 7 }                  // optional; O8 chapter-by-chapter
  },
  "producer": {
    "tool": "claude-code",                              // claude-code | apps-script | other
    "llmRoute": "vertex-direct",                        // vertex-direct | sent-tech-proxy | none   (O9: both modes)
    "model": "claude-opus-4-6"                          // optional, informative
  },
  "residency": { "classification": "airbus-internal", "egress": "none" },   // both const
  "payload": {
    "schemaId": "urn:sentropic:focus:DecisionDossierDocument:1.0.0",       // or :2.0.0 iff document.schemaVersion is present
    "render": {
      "contract": "1.0",
      "mode": "snapshot",                               // snapshot only
      "root": { "id": "root", "component": "DecisionDossier", "document": { /* DecisionDossierDocument */ } }
    }
  },
  "integrity": { "canonicalization": "jcs-rfc8785", "payloadSha256": "<hex sha256 of JCS(payload)>" }
}
```
All objects are closed (unknown keys refused), as upstream.

## 3. Airbus constraints enforced by `validate-dossier.mjs`
- **C1 offline**: no `http(s)://` URL in any payload string, except an owner allow-list of intranet prefixes (empty).
- **C3 size**: canonical payload ≤ 400 000 bytes. Storage = one Drive file per (id, version); PropertiesService holds
  only the index (per-value limit `unverified` for the Airbus tenant).
- **C4 snapshot only**: `mode` = snapshot; `interactions[].enabled` is already const false upstream.
- **C5 no secrets**: rejects private keys, `ya29.`, `AIza…`, `sk-…`, `Bearer …`, `gh?_…` patterns.
- Body: closed-schema validation **and** the presentation gate (`validateDecisionDossierForPresentation`).

## 4. Tooling (Node ≥ 20, zero npm dependency, no Python)
```
node validate-dossier.mjs --seal <envelope.json> > sealed.json   # compute integrity, print sealed JSON (exit 1 if invalid)
node validate-dossier.mjs sealed.json                             # exit 0 valid, 1 invalid; errors as JSON lines on stderr
```
Fixtures: `fixtures/valid-v1.json` (template dossier) and five invalid cases (closed doc, external URL, integrity,
residency, secret); all give the expected verdict (2026-11-07).
`tools/focus-build.dev.mjs` = h2a 0.98.8 `src/focus-build.ts` transpiled with esbuild for local proof only; it is
NOT a release artifact (N4 must ship the official one).

## 5. Publish flow (S1)
Claude Code on the laptop writes the dossier → wraps it → `--seal` → `validate` → push to the Apps Script store
(deploy path = U1) → the cluster-mesh GAS publish port re-validates and stores → the web app serves
`renderer.html` with the built document injected at `<!--FOCUS_PAYLOAD-->` → URL `?a=<id>&v=<version>`.

## 6. Open points for review
- R1 (h-cond): confirm focus-kit `validator.mjs` + `renderer.html` from h2a 0.98.8 as the N2/N3 baseline, and the
  release cadence that re-pins their sha256.
- R2 (s-conductor, N1): the store enforces strictly increasing `version` per `id` and re-runs the same checks.
  The vendored validator is pure ESM; GAS has no ESM → N1 needs it as an IIFE/global build.
- R5 (h-cond, N2): **`buildFocusDossier` is required before rendering** (it turns mermaid/ecosystem diagram sources
  into scenes and adds `build` metadata; without it the renderer shows a blank page — observed). Ask: a pure,
  GAS-portable `buildFocusDossier(doc, {renderer, catalog, sha256})` with no `node:fs`/`node:crypto`, so it runs
  both in Node on the laptop and in Apps Script (`Utilities.computeDigest`).
- R6 (h-cond + owner): `focus-build` refuses a dossier without a diagram section and suggests `ecosystem:overview`
  (the sentropic ecosystem scene). Airbus dossiers need an Airbus profile where the sentropic ecosystem scene is
  not required or not allowed.
- R3 (owner): intranet URL allow-list for C1, if any.
- R4: v1.1 for O8 (chapter metadata present; rendered ArchiMate / engram scenes not yet).

## 7. r3 amendments (accepted 2026-11-07; they override §1–§5 where they differ)
Sources: h-cond `~/src/h2a/tmp/h-cond/focus-live/N3-ANSWERS.md` (A1–A8), s-conductor N1 spec
`sentropic/spec/SPEC_EVOL_CLUSTER_MESH_GAS.md` (OQ13).
- **A1 baseline and re-pin**: focus-kit `validator.mjs` + `renderer.html` from h2a 0.98.8 (blobs identical on main
  65b65d6bf). Every h2a release that changes either blob re-pins both sha256 in this contract; the validator checks a
  `RENDERER_SHA256` pin as well as the validator pin.
- **A2 `payload.build`** (closed, covered by `integrity`): `rendererVersion`, `rendererSha256`, `validatorVersion`,
  `validatorSha256`, `documentDigest`, `catalogSha256` (null under `airbus@1`), `capabilities`, `formats`, `increment`,
  `envelopeSha256`.
- **A3 built form**: `payload.render.root.document` is the BUILT document (every `diagram` section carries its generic@1
  `scene`, produced by the pinned focus-kit builder). The store re-validates and checks `payload.build` against its own
  pins; it never rebuilds.
- **A4 profile `airbus@1`**: diagram sections optional (0..n); allowed sources = the Mermaid flowchart profile and generic@1
  scenes; any `ecosystem:*` source refused (`focus-ecosystem-forbidden`); no ecosystem catalog shipped or embedded; C1, C3,
  C5 apply to the whole payload; renderer capability `embedded-offline` required. Supersedes R6.
- **A5 integrity**: canonicalization refuses lone surrogates; `payloadSha256` equals the focus `baseDigest` of the payload
  without the `sha256:` prefix.
- **A6 vendoring**: `renderer.html` vendored with its sha256 check; the official kit module replaces
  `tools/focus-build.dev.mjs` once the pure builder (R5) ships.
- **A7 v1-only store** until focus-kit validator 0.6.0 (byte API): `schemaId` `:2.0.0` refused by the store meanwhile.
  The Apps Script validator is a global (IIFE) build of the pinned blob, no code change.
- **A8 fixtures**: Airbus-neutral `valid-v1` (one custom Mermaid diagram), plus `valid-no-diagram`, `invalid-ecosystem`,
  `invalid-not-built`.
- **OQ13 version rule (accepted)**: versions per id are contiguous `1..latest`; publish accepts `latest + 1` only (first =
  1); gaps, repeats, 0, negatives and non-integers refused with `version_conflict`. Same predicate at build time and when the
  runtime loads the registry. Replaces "strictly increasing per id" in §2.
- Code follow-ups (not yet done): validator A1/A5, fixtures A8 here; `tools/build.mjs` contiguous rule + `payload.build` in
  the S1 repo `airbus-appscript-sentropic` (its owner session).

## 8. r3.1 corrections (h-cond co-sign check 2026-11-07, `~/src/h2a/tmp/h-cond/n3-r3-check-last.md`)
- §1 precision: besides Svelte/xyflow error-message links, `renderer.html` carries 11 XML namespace URIs; none is fetched.
- §2 precision: `payload.render.mode` is optional; when present it must be `snapshot`.
- §4 fixtures now: `valid-v1` (Airbus-neutral, one custom Mermaid diagram = the S1 dossier), `valid-no-diagram`,
  `invalid-ecosystem`, plus the 5 earlier invalid cases (derived from the former template dossier; they still fail for
  their intended reason). `invalid-not-built`: **pending** the R5 builder lot (built form cannot be produced yet).
- A6 delivered: `vendor/focus-kit/renderer.html` vendored; the validator checks `RENDERER_SHA256`
  (`6a6e62aa…77d305`) as well as `VALIDATOR_SHA256`.
- A4 wording: **airbus@1 is enforced by the store validator** (`ecosystem:*` refused here, diagram sections optional);
  the pinned builder (h2a 0.98.8 `focus-build`) cannot yet build diagram-less dossiers — it needs the h2a R5/R6 lot
  (queued behind the Codex quota, back 2026-11-11).
- A2 wording: `documentDigest` and `catalogSha256` are **added by the R5 builder lot; absent from 0.98.8 builds**
  (the 0.98.8 builder emits 8 build fields). Until then `payload.build` and the built-form check (A3) are pending.
- A1 h2a commitment (accepted by h2a): each h2a release that changes `validator.mjs` or `renderer.html` bumps
  `validatorVersion`/`rendererVersion`, regenerates the manifest and lists both sha256 in its release notes; otherwise
  the notes say « focus-kit pins unchanged ».
