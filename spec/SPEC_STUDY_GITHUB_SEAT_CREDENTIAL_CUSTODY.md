# SPEC STUDY — GitHub-backed custody of LLM seat credentials (MEP retrieval, Sentropic-side refresh)

Status: **STUDY / RECONCILED 2026-10-18** — historical study dated 2026-09-20, reconciled with `origin/main` at `1472d961e098908e64ef60b83835af357888d031` and with PR #659 (merged 2026-10-10 as `dc95f7e4f88048e9671002827537cde4cb8149b7`). Derived from the FROZEN `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md`; this study does not re-open the broker. Current authority for custody consumption is `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §7 (D7); this study selects no new design and authorizes no production delivery. Owner instruction 2026-10-18: keep PR #596 open (« La garder »).

Reading guide: **Historical (2026-09-20)** marks the original request and options as recorded at that date. **Current (on main)** marks a normative decision, implemented code, or inventory observed at the pinned main above. **Unverified** marks a claim with no live qualification evidence at that baseline. A historical observation is not a current fact.

Owner intent (2026-09-20, historical): *« Je veux que llm-mesh + gw offre une capacité de stocker les sièges sur GitHub, pour les récupérer à la MEP, quitte à ce que le rafraîchissement de device se fasse côté repo sentropic — pour réduire les coûts run. »* This dated request, tying GitHub storage to deployment retrieval and lower run cost, is retained as provenance. The cost model was unproven in the original study and remains unverified (§9).

## 0. Executive summary

Historical (2026-09-20): the mesh/gateway authenticated each provider with a metered API key injected at deploy, while the owner held already-paid seat subscriptions. The study proposed enrolling each seat once, storing the resulting device credential in a GitHub-backed custody store, refreshing it from the Sentropic repository side, and retrieving it at deployment (MEP) so the gateway would run on seat quotas.

Current (on main): the deployable-process contract already specifies that capability beyond the Claude-specific scope. D7 records the owner-selected GitHub Secrets approach, full provider/device payloads, and a dedicated Actions-secret API credential (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:13`, `:144-145`). It specifies a sole scheduled refresher, serialized triggers, GitHub-first durable commit, CAS delivery, failure recovery, and an independent freshness monitor (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:147-153`). PR #659 delivered ordinary Claude-seat enrollment, persistence, refresh, and an injected execution bridge; it did not deliver the general GitHub custody service (§2, §6). The custody job, the projection resolver, and live qualification remain implementation gaps already named on main (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:220`, `:263`, `:410`).

Remaining contribution of this study: the dated owner rationale, the explicit O1/O2/O3 comparison retained as decision history (§3), and unresolved operational questions (§7). It is not a separate accepted implementation design.

Central tension (historical framing, still applicable as history): the broker study bans raw-secret mirroring by default and requires an explicit owner gate, a KMS-to-KMS envelope, an audit trail, and a revocation SLA for any exception (`spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:335`). How the selected design on main relates to that default is stated in §3; no stronger guarantee is claimed there.

## 1. Goal and non-goals

### 1.1 Goal
Historical goal: give the owner a mono-principal capability to run `llm-gateway` on their own paid seats, with credentials that survive redeploys and refresh unattended, without exposing raw seat secrets to agents. Current (on main): that objective is carried by the D7 custody lane (§3-§5); this study adds no second delivery mechanism.

### 1.2 Non-goals (v0)
- No cross-user / cross-agent seat pooling. Scope stays mono-principal, own seats only, personal passthrough with cross-user selection disabled (`spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md:249`). No categorical provider-permission assurance is stated: the later Claude treatment distinguishes the recorded owner continuation decision from provider permission (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:63-75`, `:260`).
- No agent-visible refresh tokens, cookies, 2FA codes, or security-key material. Policy/index, custody, and human-challenge boundaries are already established on main (`spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:267`, `:329-335`, `:366-380`; `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_ADMINISTRATION.md:16-44`).
- No new authorization plane: reuse the existing policy/index and account-administration contracts cited above.
- No unconditional metered fallback: fallback requires explicit configuration, matching owner/workspace authorization, and reserved budget (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:163`); no implicit fallback follows a seat failure (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:187`, `:258`). The CI-seats lane keeps its own seat-only cost constraint (`spec/SPEC_EVOL_CI_SEATS.md:5-6`); that lane rule is not a blanket rule for every gateway consumer.

## 2. Grounded map (what exists vs net-new)

Exists — Current (on main), observed at the pinned main:
- Enrollment contract and providers, including native Muse and existing Codex/Cloud-Code enrollment (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:16-18`). Muse provider code exists in `packages/llm-mesh/src/enrollment/muse-code.ts`; Muse identity is not a remaining discovery decision (§6).
- Ordinary Claude-seat enrollment, renewable import, refresh, durable publication, and an access-only injected execution bridge, delivered by PR #659. The contract distinguishes ordinary and custody-managed seats (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:120-135`). Enrollment delivered by PR #659 is not evidence that GitHub custody is operational.
- Storage contracts as specified on main: durable ordinary envelopes are distinct from custody projections (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:256-257`). The keyring classes named for OS keychains use memory maps at the cited baseline (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:26`); no durable OS-keychain behavior is promised, and no second custody token store is created (§5).
- Provider inventory: a five-CLI credential envelope for agy, codex, vibe, muse, and claude, with lifecycle qualification explicitly unverified (`spec/SPEC_EVOL_CI_SEATS.md:58-68`).
- Workflow inventory: only `ci.yml` and `idp-identity-sync.yml` are tracked under `.github/workflows/` at the pinned main. No custody refresh workflow is tracked.

Net-new — still missing on main (existing gaps, not supplied by this study or by PR #659):
- The scheduled custody job that refreshes custody-managed seats and commits full payloads to GitHub Secrets (D7/G4 prerequisite, `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:263`).
- The projection resolver (`apps/llm-gateway/src/seat-resolver.ts` is absent at the pinned main; delivery is assigned to B4, `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:220`).
- The independent freshness monitor and live provider lifecycle qualification (`spec/SPEC_EVOL_CI_SEATS.md:58-68`).

Historical note: the `transpose-cv` PR #37 keyring precedent and the 2026-09-20 inventory (including the former zero-references statement for Muse) are historical observations. They do not describe the current provider inventory and do not justify a second custody path.

## 3. Central design problem — how GitHub holds the material

Three custody shapes, in increasing alignment with the broker's handle-first default:

### O1 — GitHub-encrypted secrets (repo/environment secrets via API)
GitHub stores the seat tokens as **GitHub Actions secrets** (encrypted at rest by GitHub, sealed-box on write). The deploy workflow reads them at MEP; the refresh Action rewrites them.
- **Pro:** simplest; reuses the exact MEP path (ci.yml already consumes GH secrets); no extra KMS.
- **Con:** GitHub can decrypt at use time → custody is **delegated to GitHub**, and the material is *recoverable secret* in a second store. This is precisely the mirroring the broker bans by default; admissible only under the owner exception, and it puts seat-account trust in GitHub's secret plane.

### O2 — Envelope-encrypted blobs in a private repo (key in Sentropic KMS) — recommended
GitHub stores only **ciphertext** (age / SOPS / sealed-secret), encrypted to a key held by **Sentropic KMS**, never by GitHub. Refresh Action and MEP both decrypt with the KMS key made available to that step.
- **Pro:** GitHub never holds a decryptable secret → satisfies the **KMS-to-KMS envelope** exception cleanly; GitHub is a dumb durable transport; audit + revocation stay Sentropic-owned.
- **Con:** the KMS key must be reachable by the refresh Action and the deploy — key-distribution problem (one bootstrap secret still lives in GH to unwrap). Slightly more moving parts.

### O3 — Handle-only on GitHub, secret in Sentropic KMS
GitHub stores only a **reference/handle**; the raw seat token lives solely in Sentropic KMS. The GitHub-side refresh triggers a Sentropic endpoint that does the actual token refresh; GitHub never holds token material.
- **Pro:** fullest alignment with broker handle-first default; smallest blast radius.
- **Con:** "store the seats on GitHub" becomes "store a handle on GitHub" — arguably not what the owner asked; requires a reachable Sentropic KMS/endpoint at MEP anyway, which weakens the "GitHub is the store I retrieve from" intent.

**Study lean:** **O2** — it honors the owner's "GitHub is the store I retrieve at MEP" literally (GitHub holds the bytes) while keeping the decryptable secret out of GitHub, which is the only way the broker's raw-secret-mirroring exception is defensible. O1 is the fast path if the owner accepts delegating seat-token custody to GitHub's secret plane. Owner call in §7.

## 4. Refresh loop (Sentropic-repo side)

- A scheduled workflow in this repo (e.g. `.github/workflows/seat-refresh.yml`, cron) iterates enrolled seats, calls `EnrollmentProvider.refresh({ accountId, refreshToken, credentialVersion })`, re-encrypts (O2) and rewrites the store, bumping a version.
- On refresh failure → mark the seat `reauth_required` and raise a **human escalation** (broker §5: transaction-bound challenge on a trusted surface; agents never see codes). Device/OAuth seats periodically need a human reauth; the loop must degrade to metered-key fallback, never hard-fail the gateway.
- Replay/version guard: a newer handle never silently overwrites an active one without version check (broker §4.5 conflict policy).

## 5. MEP retrieval → gateway

- Extend the deploy step: pull current seat credentials from the store → k8s secret → gateway `KeyringAdapter` (`EncryptedFileKeyring` directory) and/or seed `LocalAccountTransportService` accounts (`status: active`, `modelIds`, `priority`).
- Gateway then acquires a seat per request (existing acquire/lease/outcome), with **metered API key as fallback** when no seat is `active`.
- Reuses the `transpose-cv` PR #37 keyring seam; the gateway is the second consumer that justifies promoting it.

## 6. Provider coverage — open

| Seat | Enrollment today | Refreshable unattended? | Note |
|---|---|---|---|
| Codex (ChatGPT) | `codex` (device-code) ✅ | refresh token, periodic reauth | exists |
| Cloud-Code (Gemini) | `cloud-code` (Google OAuth) ✅ | refresh token | exists; `resolve()` gives `cloudaicompanionProject` |
| Claude | `claude-code` ✅ | refresh token | exists |
| Gemini (direct/AI-Studio) | — | — | net-new provider or via `cloud-code` |
| **Muse** | — | **unknown** | **identity + auth mode undefined → §7 decision** |

## 7. Owner decisions to frame (for the EVOL gate)

1. **Custody exception** — ratify the raw-secret-mirroring exception at all, and pick the shape: **O1** (GitHub-encrypted secrets, custody delegated to GitHub) / **O2** (envelope ciphertext, key in Sentropic KMS — recommended) / **O3** (handle-only). Everything downstream depends on this.
2. **Encryption-key residence** (if O2/O3): where the KMS/unwrap key lives and how the refresh Action + MEP reach it without a new cleartext secret on GitHub.
3. **Muse** — what product is it and what is its auth mode (Copilot-served? standalone seat OAuth?), so it can be scoped or deferred.
4. **First-wave seats** — which of {Codex, Cloud-Code, Claude, Gemini, Muse} enroll first (proof), which defer.
5. **Refresh cadence + reauth escalation surface** — cron interval and where the human reauth challenge lands (Focus / h2a / Sentropic UI).
6. **Retrieval target** — seed the gateway **account-transport pool** (rotation/cooldown across multiple seats) or just the **keyring** (one credential per provider)?
7. **Scope confirmation** — mono-principal, own seats only (ToS-safe), no cross-user pooling in v0.

## 8. Method / next steps
- This is the STUDY rung (reversible). Per `harness/brainstorm`, the **committed decisions** (esp. §7.1 custody) go through **≥2 independent adversarial reviews** (e.g. Codex 5.6-xhigh + a second lens on custody/ToS/security) before a `SPEC_EVOL_GITHUB_SEAT_CREDENTIAL_CUSTODY.md` and `harness/plan`.
- No implementation before the custody exception is owner-ratified: storing seat refresh tokens is irreversible-ish (revocation SLA) and security-affecting.

## 9. Risks
- **Custody**: any GitHub-held decryptable seat token widens the blast radius to GitHub's secret plane; O1 delegates seat-account trust to GitHub.
- **ToS**: programmatic use of seat subscriptions (Copilot/ChatGPT/Claude/Gemini) outside their client may violate provider ToS — must be reviewed per seat before enrollment (same gate as the enrollment proposal).
- **Reauth cliffs**: device/OAuth seats force periodic human reauth; without a reliable escalation + metered fallback the gateway can lose a provider mid-run.
- **Refresh-token theft surface**: a scheduled Action holding refresh tokens is a high-value target; O2/O3 shrink it, O1 does not.
- **Cost model unproven**: seat ToS may forbid this exact usage, nullifying the saving — validate before build.
