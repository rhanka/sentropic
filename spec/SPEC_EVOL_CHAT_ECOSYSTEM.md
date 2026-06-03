# SPEC_EVOL — Chat Ecosystem Program (WP-CHAT) — PLAN v2

Status: PLAN v2, post double review (**Codex gpt-5.5/xhigh = REVISE**, **Opus 4.8 = RECONSIDER**) — findings incorporated. Detailed spec follows, then re-challenge, then owner go.
Owner: `sentropic-chat` (chat ecosystem evolution; autonomous backlog implementer within risk tiers; NOT BR-38c which `38etc` owns).
**Baseline: `main`** (NOT `uat/39c-auth-oidc` — the root checkout lags; `@sentropic/chat-server@0.1.1` and `@sentropic/build-cli@0.2.0` exist on `main`). All WP-CHAT branches fork from `main`.
Sources: h2a `nego:chatui-turnkey-dialogue` (mermaid-editor), `neg:chat-librarization-radar-20260602` (radar P1-P7), `neg:ds-react-scaffolding` (DS), + owner ecosystem mandate.
Approved decisions (2026-06-02): public-surface change OK (owner autonomous on sentropic non-reg, within risk tiers); headless **UI** core + bindings, additive/non-breaking (ENFORCED, §2.1); React before Vue (Vue gated, §2); double adversarial review every design step.

## 1. North star & positioning

Turn `@sentropic/chat-ui` from "shells + primitives" into the runtime-agnostic, themeable, multi-surface chat ecosystem of the sentropic agentic backplane — the "assistant-ui of sentropic". Provider/runtime-agnostic like Vercel AI SDK & assistant-ui, articulated to a unique backplane (NHI auth, h2a inter-agent, flow/queue, unified registries, heavy surfaces, canvas, voice). Consumable standalone by sibling apps and compatible with Vercel/assistant-ui. Differentiators (NHI, a11y, i18n…) carry **acceptance criteria** (§8), not just bullets.

## 2. Architecture pillar — headless **UI** core + framework bindings

- `@sentropic/chat-ui-core` (NEW, headless TS) is **UI-state only**: stream projection, draft state, stream client, renderer registry, **local-tool UI state**. It does **NOT** own runtime/orchestration/wire/sessions-persistence/voice/canvas — those stay in `chat-core`/`chat-server`/`flow` or their own packages (corrects review BLOCKER-1). The two stateful stores that import `svelte/store` `writable` (`stores/localTools.ts`, `stores/chatWidgetLayout.ts`) are **de-Svelte-d** into framework-agnostic state with thin per-framework store adapters.
- Genuinely framework-pure TS today ≈ **~1500 LOC** (`state/*`, `utils/*`); total package ≈ 67% TS / 33% Svelte. The core is the pure part + de-Svelte-d stores — not a wholesale move.
- **Bindings**: `@sentropic/chat-ui` stays the **Svelte façade** (see §2.1); `chat-ui-react` is a **pilot** (Wave B) that must be consumed by one real app before it is "done"; **`chat-ui-vue` is DEFERRED** until a DS Vue port exists AND a committed Vue consumer exists. Multi-framework is a **separately-scoped, separately-gated sub-program**, NOT a fused P0 pillar.
- Per-framework reality (review BLOCKER-2): Svelte 5 snippets (`{#snippet}`/`{@render}`) are the host-UI injection API in 4/5 components → the **prop/injection contract is redesigned per framework** (React children/render-props, Vue scoped slots). `svelte-streamdown` is Svelte-only → React/Vue bindings need a **different streaming-markdown engine**; this is the #1 visual-divergence risk and is owned by the binding sub-program, not the core.

### 2.1 Non-breaking — ENFORCED, not asserted (review BLOCKER-2/Opus-1)

- `@sentropic/chat-ui` remains the Svelte-binding **façade indefinitely**, re-exporting **100% of the current ~25 export subpaths verbatim** (`.`, `client/*`, `state/*`, `renderers/registry`, `hosts/*`, `stores/*`, `utils/*`, `components/*.svelte`) from the new core.
- Merge gate before any extraction lands: **export-surface snapshot** (generated export-manifest diff / `publint`) + **npm-pack consumer fixture** + a **"no removed/renamed export, no prop-contract change"** check.
- The live app stays on its current specifiers; radar/drawing-skills stay on `@sentropic/chat-ui@^0.1.x`. A contract test asserts every current specifier still resolves.

## 3. Sameness strategy + SDK-boundary reaffirmation

Root cause of radar/sentropic divergence: rich ergonomics live in app `AppChatPanel` (~6k lines), never librarized → radar rewrote approximations (its P1-P7 = the diff). Fix = librarize the **reusable** pieces once; every app consumes the same lib + same DS tokens.
- **SDK boundary inherited unchanged** (review Opus-7, per `SPEC_STUDY_CHAT_UI_SDK_SCOPE.md` l.107/113/320): the lib gets the **composition** (`ChatConversation` + flagged adapters) and the reusable ergonomic pieces; **the app keeps session orchestration**. "Delete app duplicates" is allowed ONLY for code **verbatim-replaced** by a published primitive; any `AppChatPanel` path deletion is an **escalation** (tier-1, §5).
- **Parity pyramid** (replaces vague "lib === sentropic"; review BLOCKER-3/Opus-2,3):
  1. Golden **stream fixtures** → deterministic core-projection tests (framework-free).
  2. **Semantic DOM/ARIA/interaction** tests per framework (jsdom) over the same fixtures.
  3. **Bounded screenshot baselines** ONLY on a story-gallery of fixed states, dynamic content masked, defined viewports — NOT pixel parity across markdown engines.
  Parity is **behavioral + DOM-contract**, not pixel. No "parity-green" self-merge until the harness exists and is proven non-flaky (§6 A0).

### 3.1 Theming = tokenization track (not "wiring"; review Opus-4)

chat-ui is today **100% hardcoded Tailwind** (61 color utilities, 0 `--st-*`); `AppChatPanel` ~200 `class=` sites. So DS theming = an explicit **tokenization** track: audit every hardcoded utility → map to `--st-*` (soft dep on `@sentropic/design-system-tokens@0.10.3`) → per-component regression snapshot. **No token-name leak into multiple frameworks before the `--st-*` 1.0 freeze.** Provider skins (Claude/Gemini/ChatGPT) = **token presets / narrow alias layer** in the chat-ui layer (not a parallel DS); DS owns enterprise themes (DSFR/Carbon/Airbus). Tokenization perturbs the live app at least once → **tier-1 / escalation**.

## 4. Decomposition (tracks)

| Track | Content | Deps | Serves |
|---|---|---|---|
| **P0 UI-core + façade + parity harness** | extract UI-only core; `@sentropic/chat-ui` façade re-export gate; **build the parity harness**; characterization baseline | main | all |
| **T1 ergonomic librarization** | radar P1-P4/P6/P7 + `ChatConversation` turnkey + 38c attachment defaults (composition, not orchestration lift) | P0, 38c(38etc) | mermaid + radar |
| **T2 theming/tokenization ↔ DS** | tokenize chat-ui → `--st-*`; size=sm at binding; provider-skin presets; DS themes; runtime switcher | T1, DS tokens | owner + both |
| **T4 registries + backplane + security/NHI** | unified CatalogSource (tools/MCP/canvas/agents/flow + bg CLI); stop/steer contract (radar P5); **security/NHI delegation track** (auth-context propagation, tool-permission boundaries, redaction, audit, prompt-injection) | chat-server, flow, skills, auth-hono | radar(P5) + owner |
| **T6 surfaces** | add **full** layout; standalone website sidecar; mobile | T1 | owner |
| **T7 competitive compat** | adapters: Vercel AI SDK data-stream + assistant-ui runtime — **+ early Wave-A spike** before freezing core APIs | P0 | owner |
| **T8 assist.sent-tech.ca** | capstone demo, built via build-app CLI — **gated on `@sentropic/build-cli` merged & published** | T1-T7, build-cli | owner |
| **(carved out) Voice** | own `SPEC_EVOL_CHAT_VOICE` (STT/TTS/realtime/VAD/privacy) | — | owner |
| **(carved out) Canvas** | own `SPEC_EVOL_CHAT_CANVAS` (livedoc/CRDT, editors, collab/audit/reversibility, 3D-CATIA/sheets) | — | mermaid + owner |
| **(carved out) Multi-framework React/Vue** | own gated sub-program; React pilot → real consumer; Vue gated on DS-Vue + consumer | P0 | owner |

WP-CHAT **owns only the port seams** for voice/canvas/frameworks (interfaces/extension points), not their implementations.

## 5. Operating model — WP-CHAT, **risk-tiered** autonomy

- New **`WP-CHAT`** work package registered in root `PLAN.md` (system-of-record for waves/deps): series of small, single-purpose, incrementally-mergeable branches off `main`.
- **Risk tiers** (reconciles owner "minimal-UAT, escalate only on strong irreversibility" with the review's prod-safety findings; note the live app consumes chat-ui by **source import → no semver buffer**, so any change to a file imported by `ui/src/**` reaches prod on rebuild):
  - **Tier-0 (autonomous self-merge)**: net-additive, no public-export/prop change, not imported by live `ui/src/**` critical paths. Gate = unit + core-projection parity + per-app smoke + CI green.
  - **Tier-1 (escalation: owner visual/canary + mandatory full chat e2e on an isolated env, never `ENV=dev`)**: core extraction, public-export/prop changes, app retrofit, deletion of any `AppChatPanel` path, changes to streaming/projection/scoped-style, auth/tool/voice/canvas seams, tokenization passes that restyle the live app.
- **Double adversarial review (Codex 5.5-high + Opus 4.8 max)** on each design artifact (already in force).
- **On-demand visual check**: owner may trigger a Playwright/screenshot verification at any time.
- **Autonomous loop** drains the tier-0 backlog branch-by-branch + PRs while other agents work other segments; tier-1 items queue for owner gate.
- **Retrofit**: per the release matrix (§7.2), never forced.

## 6. Sequencing (waves) — de-fused

- **Wave A0 (baseline, on `main`)**: characterization tests of current chat behavior; **build & prove the parity harness** (renderer, fixtures, tolerance, frameworks, CI placement, flake triage owner); define the export-shim contract + snapshot gate. No feature work. (review BLOCKER-3/Opus-3, Codex-6)
- **Wave A1**: pure **UI-TS** extraction into `chat-ui-core` **behind unchanged `@sentropic/chat-ui` exports** (façade re-export, export-snapshot gate green). De-Svelte the 2 stores. Tier-1.
- **Wave A2**: app retrofit onto the façade where 1:1; zero dual-path only for verbatim-replaced code. Tier-1.
- **Wave A3**: radar **P1-P3** features (ModelSelector, MessageActions, ContextProvider port) on the stabilized core. Then tokenization (T2) start.
- **Wave B**: T1 remainder (P4/P6/P7 + `ChatConversation` turnkey, consuming 38c) + **React binding pilot** (consumed by one real app) + T6 `full` layout + T7 early compat spike.
- **Wave C**: T4 registries/backplane + security/NHI track (+ P5 stop/steer). Voice/Canvas proceed in their own SPEC_EVOLs.
- **Wave D**: T7 full compat adapters. Vue binding only if DS-Vue + consumer committed.
- **Wave E**: T8 assist.sent-tech.ca (gated on merged build-cli).

## 7. h2a coordination, version & retrofit

- `nego:chatui-turnkey-dialogue` (mermaid): counteroffer = `ChatConversation` turnkey via composition (Wave B), 38c→38d lineage.
- `neg:chat-librarization-radar`: counteroffer = P1-P3 first (Wave A3) → `@sentropic/chat-ui` minor; P4/P6/P7 Wave B; P5 (backend contract) Wave C.
- DS: open dedicated `scope:chat-ui` nego (after owner go); pin tokens@0.10.3 soft → `--st-*` 1.0 freeze before hard dep.

### 7.1 DS coordination outcome (reply `env:1780418256083`, confirmed)
- Pin `@sentropic/design-system-tokens@0.10.3` (+ svelte/themes aligned); `--st-foundation/semantic/component-*` + aliases; CSS-var consumption approved; pre-1.0 → soft dep until `--st-*` 1.0 freeze; size via `size:'sm'|'md'|'lg'` (chat default `sm` at binding); DS React port exists (0.1.0), **DS Vue greenfield**; React Phase-5B playbook reused (export parity, jsdom parity, smoke-pack gate); provider skins in chat-ui layer, DS owns enterprise themes.

### 7.2 Release / retrofit matrix (review Codex-10/Opus-8)
Two consumption modes with **opposite breakage timing**: sentropic = **source/workspace import (immediate, no buffer)**; radar/drawing-skills = **published `^0.1.x` (deferred buffer)**. Non-breaking must hold for BOTH simultaneously. DS is a **separate repo** (cross-repo via h2a). Per release: package version, DS-token version, peer ranges, consumer upgrade branch, rollback pin, API diff, per-app smoke status.

## 8. Cross-cutting acceptance criteria (were absent; review Codex-8/9, Opus-6)
- **Accessibility**: WCAG 2.2 AA; **ARIA live-region policy for streaming**; keyboard traversal; focus management; reduced-motion; axe checks per framework.
- **i18n**: preserve `ChatUiLabelDictionary` injection; locale dictionaries; **RTL/bidi-safe** layout.
- **Security/NHI**: per-call auth-context propagation; **NHI token-delegation/scoping for chat-initiated tool calls** (security-reviewed); local-tool consent UI; redaction; audit hooks; prompt-injection handling.
- **SSR/hydration**: per-framework SSR/hydration tests (SvelteKit/Next-RSC/Nuxt differ) — streaming + hydration mismatch is a known chat bug class.
- **Bundle size**: per-entrypoint budget gate (core + binding + Streamdown + tokens + skins).
- **Observability**: stream metrics, error taxonomy, client telemetry contract surface.

## 9. Resolved factual drift (review Opus-minor)
- Baseline = `main` (`chat-server`/`build-cli` exist there; root `uat/39c` lags).
- TS share ≈ 67% (not 80%); the pure liftable part ≈ ~1500 LOC; 2 stores need de-Svelte-ing.
- `WP-CHAT` to be registered in root `PLAN.md` as part of A0.

## 10. Review log
- Codex gpt-5.5/xhigh → REVISE (12 findings); Opus 4.8 → RECONSIDER (4 BLOCKER + majors). All BLOCKERs and majors incorporated above. The previously-fused P0 (extraction + 3-framework + low-UAT self-merge) is **de-fused** into A0→A3 + carved-out sub-programs + risk tiers, per both verdicts.

## 11. Non-goals
No llm-mesh/provider/persistence/runtime reimplementation in chat-ui; **no breaking change to current consumers** (enforced §2.1); comments/jobs/Drive/RBAC stay app-owned (injected adapters); **session orchestration stays in the app** (SDK boundary, §3); voice/canvas/multi-framework are carved-out sub-programs (WP-CHAT keeps only seams); BR-38c stays with `38etc`.
