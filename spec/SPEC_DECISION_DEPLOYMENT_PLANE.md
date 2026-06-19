# SPEC DECISION — Deployment-plane (ARCH-17 / BR-55) ratification packet

Status: RATIFICATION PACKET (planning-only, 2026-06-19). Decision list extracted from the
double-4.8max-reviewed study `SPEC_EVOL_DEPLOYMENT_PLANE.md` (PR #340) — that spec holds the full
analysis/evidence; THIS file is the clean decision dossier. **Final sign-off belongs to rhanka.**
Format: each decision is framed by **what is at stake for you / the program** (cost, risk,
irreversibility), then options, then recommendation. Nothing here is built until ratified.

## How to read this
- **Reversible, recommendation stands** (D1, D2, D3, D5, D6, D10): foundations can proceed on the
  recommendation; flagged here only for visibility. Change later cheaply.
- **Owner-blocking** (D4 naming, D7 gate, D8/D9 migrations+rollback, D11 RP ID, OQ0/OQ2): these
  change cost, security posture, or are hard to undo — they want your call. **Batched below.**

---

## A. Reversible — recommendation stands unless you object

| # | Decision | Stake for the program | Recommendation |
|---|----------|----------------------|----------------|
| D1 | Preprod env isolation level | A real CD safety net needs a place to land merges before prod. Cheapest viable = its own namespace. | Separate `sentropic-preprod` namespace (own PG + secrets + hosts). Predecessor: BR-55b0 (poc-k8s baseline). |
| D2 | Prod namespace identity | Renaming the live namespace = disruptive migration (DNS/secrets/PVC) for zero functional gain. | Keep the live `sentropic` namespace AS prod. Zero disruption. |
| D3 | Preprod database | A shared DB would let preprod boot-migrations mutate the **prod** schema on every merge — unacceptable. | Separate preprod postgres. |
| D5 | Prod tag policy | You need releases addressable + the exact bytes in prod traceable. | Date tags `vYYYY.MM.DD.N` (matchID) + promote by immutable digest. (npm semver stays separate.) |
| D6 | Per-env secret mechanism | Secrets must not cross trust domains; the repo already had to purge SealedSecret blobs from git once. | SealedSecrets per namespace; **hard rule**: preprod & prod get DISTINCT signing KEK + DB creds + client secrets. |
| D10 | Who owns BR-55 | Plumbing that the deferred multi-cloud `k8s-ops` contract will reuse. | Foundations builds it (coord. scale); BR-55b0 owned by the cluster operator (cross-repo). |

## B. Owner-blocking — your call (batched 4 at a time, see questions)

**D4 — Preprod domain names.** Stake: durable public names, hard to change once issued certs/DNS exist.
Options: (a) `sentropic-preprod.sent-tech.ca` + `auth-preprod.sent-tech.ca`; (b) `*.preprod.sent-tech.ca` (wildcard cert). Reco (a). Needs your validation (durable naming).

**D7 — How a prod deploy gets YOUR authorization.** Stake: this IS the "prod = rhanka signature" gate; today it is **unenforced** (no GitHub Environment exists — any dispatch could deploy). Options: (a) GitHub `production` Environment, required reviewer = you, run pauses for your approval (native, auditable); (b) h2a `h2a_sign` signature verified by the workflow; (c) plain dispatch (insufficient). Reco (a) as the gate + (b) as the attestation. Must also: tag-protection (a tag can't bypass), and the "recette attestation" must be a machine-verifiable ref (track VerificationRun / h2a sign), not free text.

**D8 — Prod migration safety on release.** Stake: the api runs migrations at boot and exits on failure; a bad prod migration takes the IdP down. Options: (a) decouple — `MIGRATE_ON_BOOT` flag + dedicated migration Job + mandatory pre-deploy backup (enables fast app-only rollback for no-migration releases); (b) keep boot-migrations + pre-deploy backup, rollback = DB restore + downtime, forward-only/expand-contract discipline. Reco (a) if in BR-55d scope, else (b). Pre-deploy backup mandatory either way.

**D9 — Can you roll back a bad prod release.** Stake: **today there is NO automated DB rollback** — `db-restore` is local-only; nothing restores the live prod DB. Options: (a) BR-55d ships a real, gated `db-restore-prod` (pg_restore into the live pod, proven on preprod first) + digest re-pin; (b) app-only rollback (digest re-pin), valid only for no-migration releases and only if D8(a) lands. Reco (a) as the capability, (b) as the fast path. Until (a) ships: forward-only migrations only.

**D11 — Preprod passkey isolation.** Stake: a shared WebAuthn RP ID would let **real users' prod passkeys authenticate against preprod** (and vice-versa) — a parallel login surface for real identities, even with split KEK/DB. Options: (a) distinct preprod RP ID (full isolation; passkeys not portable between envs — intended); (b) shared `sent-tech.ca` RP ID (portable, cross-validating). Reco (a). Security-isolation decision, not convenience.

## C. Open questions (need an external party, not just a pick)

- **OQ0 (cluster operator)** — will the operator create the `poc-k8s/tenants/sentropic-preprod/` baseline (namespace/quota/limits/netpol/pull-secret)? Hard predecessor to D1.
- **OQ1 (cluster headroom)** — does the poc cluster have quota/PVC room for a 2nd full namespace? Needs a `kubectl describe quota` check.
- **OQ2 (preprod data)** — start empty + synthetic fixtures (default), or seed from a **scrubbed** prod dump? If seeded, scrubbing signing keys / client secrets / passkeys / sessions / PII is mandatory.
- **OQ3/OQ4 (gate source-of-truth + recette artifact)** — folded into D7; must resolve before BR-55d.
- **OQ6 (cd-k8s + k3d smoke)** — in the first BRs or deferred?

---

## Separate, immediate (not deployment-plane) — the staleness CI bug
Stake: **today every `packages/auth-ui/**` change reaches main but NOT prod** (the `api` paths-filter
+ `API_VERSION` hash omit it → publish + deploy skip; this caused today's manual deploy). A ~10-line
CI fix (add `packages/auth-ui/**` — and other api-bundled packages — to the filter + the version
hash) makes future auth-ui merges publish + deploy automatically, independent of the whole
deployment-plane. Options: (a) fix now (small, separable); (b) leave manual until BR-55c lands the CD.

## Recommendation summary
Ratify A as-is. Decide B (D4/D7/D8/D9/D11) + the staleness fix. OQ0/OQ1/OQ2 need the operator /
a data-policy call. Impl order (after ratification): BR-55b0 → 55a → 55b → 55c (cd.yml, kills the
staleness pain) → 55d (release-prod + the D7 gate). Detail + evidence: PR #340.
