# BRANCH — chore/arch-13-quota-ledger-study

- Branch: `chore/arch-13-quota-ledger-study`
- Mode: mono-branch
- Baseline: origin/main @ e525142a9
- Kind: study (doc-only — produces the ARCH-13 output `spec/SPEC_EVOL_QUOTA_LEDGER.md`)

## Allowed Paths
- [x] `spec/SPEC_EVOL_QUOTA_LEDGER.md`
- [x] `BRANCH.md`

## Forbidden Paths
- [x] all code (`api/**`, `ui/**`, `packages/**`), `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `api/drizzle/**`, `deploy/**`

## Conditional Paths
- [x] none

## Lots
- [x] **Lot 1 — Author ARCH-13 study**
  - [x] Code-reality grounding (CostContext unwired, usage discarded on all stream paths, no pricing/quota tables, XFF spoofable, deploy topology)
  - [x] Draft `SPEC_EVOL_QUOTA_LEDGER.md`
  - [x] Double consensus (Codex 5.5-xhigh + Fable 5) — both GO-WITH-CHANGES (found a v0 budget-bypass flaw)
  - [x] Reconcile all must-fixes (reserve→settle→refund write-path; usage-envelope prerequisite; exact micro-USD money; multi-scope atomic reservation + explicit DD9 scope; effective-dated immutable component pricing fail-closed; XFF trusted-proxy deploy gate + nginx fix; HMAC-pepper + IPv6 /64; blocked-attempts audit; credential_source/BYO-key; system principal; idempotency + same-tx outbox)
  - [x] Flag the anonymous-budget OWNER sub-decision
- [x] **Lot N — Final**
  - [x] PR (doc-only)

## Feedback Loop
- 1 owner sub-decision (anonymous budget ownership: pool model / cap / authority) → BATCHED packet.
- NAMED cross-repo prerequisite: poc-k8s XFF/trusted-proxy verification + `ui/nginx` X-Forwarded-For forwarding fix (needed before anonymous budgets are safe).
- NAMED prerequisite: normalized usage/cost envelope plumbing (provider usage → step-finish event) before the ledger can settle real cost.

## Deferred
- Implementation lot (the quota/ledger build) — after owner ratifies the budget ownership + the usage-envelope + XFF-deploy prerequisites land.
