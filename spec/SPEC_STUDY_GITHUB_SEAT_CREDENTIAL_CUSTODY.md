# SPEC STUDY — GitHub-backed custody of LLM seat credentials (MEP retrieval, Sentropic-side refresh)

Status: **STUDY / OPEN** — derived from the FROZEN `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md`. This study does not re-open the broker; it instantiates its catalog class 5 (LLM/dev accounts) and its **GitHub/Google** catalog wave for one concrete capability. New committed decisions spawn a `SPEC_EVOL_*`, not edits here.

Owner intent (2026-09-20): *« Je veux que llm-mesh + gw offre une capacité de stocker les sièges sur GitHub, pour les récupérer à la MEP, quitte à ce que le rafraîchissement de device se fasse côté repo sentropic — pour réduire les coûts run. »*

## 0. Executive summary

Today the mesh/gateway authenticates each provider with a **metered API key** injected at deploy (k8s secret ← GitHub Actions secret). The owner runs several **seat-based subscriptions** (Codex/ChatGPT, Cloud-Code, Claude, Gemini, Muse) whose quota is **already paid**. Running the mesh on those seats instead of metered keys reduces run cost — the same lever as the enrollment proposal, but with a concrete custody+delivery mechanism:

1. **Enroll** each seat once via the existing `@sentropic/llm-mesh/enrollment` device-code / OAuth-PKCE flow (providers `codex`, `cloud-code`, `claude-code`, + net-new for Gemini/Muse).
2. **Store** the resulting seat credential (a "device": access + refresh + expiry) in a **GitHub-backed custody store** — the durable, MEP-reachable vault.
3. **Refresh** the device on a schedule from the **Sentropic repo side** (a GitHub Action using the refresh token, re-writing the store), so stored credentials stay valid between deploys.
4. **Retrieve at MEP**: the deploy pipeline pulls the current credentials from the GitHub store into the runtime (k8s → gateway keyring / `LocalAccountTransportService` pool), so `llm-gateway` egresses on seat quotas.

**Central tension (the owner decision this study exists to frame).** The broker study **bans raw-secret mirroring by default** (§4.3): refresh tokens and LLM account material must not be copied into a second store; custody is **handle-first**; any exception needs an *explicit owner gate + KMS-to-KMS envelope + audit trail + revocation SLA*. "Store the seats on GitHub" is, literally, mirroring seat refresh tokens into an external store. So this capability is only admissible as a **ratified exception** — and its whole design turns on *how* GitHub holds the material (raw vs ciphertext vs handle).

## 1. Goal and non-goals

### 1.1 Goal
Give the owner a mono-principal capability to run `llm-gateway` on their own paid seats, with credentials that survive redeploys and refresh unattended, without ever exposing raw seat secrets to agents or to GitHub in cleartext.

### 1.2 Non-goals (v0)
- No cross-user / cross-agent seat pooling (broker §2.5: needs owner ToS acceptance + kill-switch). This is the owner's **own** seats, personal-passthrough — ToS-safe by the broker's v0 rule.
- No agent-visible refresh tokens, cookies, 2FA codes, or security-key material (broker §1.2, §5).
- No new authorization plane: reuse `AccessGrant` (policy/index) + LLM `AuthorizationGrant` (account-use) + `SecretAuthMaterial` per broker §3.4 / §2.5.
- No change to the metered-key path: it stays the fallback when a seat is `reauth_required` / `disabled`.

## 2. Grounded map (what exists vs net-new)

Exists (verified in `packages/llm-mesh`):
- Enrollment: `EnrollmentProvider { start, complete, resolve, refresh }`, providers `codex` / `cloud-code` / `claude-code`, device-code + authorization-url flows, PKCE helper. `PreparedCredential { accountId, accessToken, refreshToken?, expiresAt, authClientConfigVersion, accountEmail? }`.
- Account pool: `LocalAccountTransportService` + `AccountTransportAccount { accessToken, refreshToken, expiresAt, status: active|cooldown|reauth_required|disabled, cooldownUntil, modelIds, priority }`, acquire→lease→outcome with cooldown/rotation.
- Keyring: `@sentropic/llm-mesh/node` — `EnvKeyring`, `EncryptedFileKeyring`, `InMemoryKeyring`, OS keychains; `KeyringAdapter { getSecret, setSecret, deleteSecret }`.
- MEP path: `.github/workflows/ci.yml` → `deploy/k8s` (base + prod overlay) injects secrets into k8s; `llm-gateway` reads them.
- Precedent: `transpose-cv` PR #37 already routes mesh credentials through a `KeyringAdapter` (EnvKeyring / EncryptedFileKeyring). Same seam extends to the gateway.

Net-new (this study):
- A **GitHub-backed custody store** for seat credentials (the "device" vault) — none exists (`github`/`copilot`/`muse` = 0 refs in llm-mesh today).
- A **Sentropic-side refresh loop** (scheduled GitHub Action in this repo) that renews tokens and rewrites the store.
- **MEP retrieval** wiring from the GitHub store into the gateway keyring / account pool.
- Provider coverage for **Gemini** and **Muse** (Muse identity/auth = open, see §6).

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
