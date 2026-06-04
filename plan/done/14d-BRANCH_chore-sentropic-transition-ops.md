# Branch Plan Stub: BR-14d Sentropic Transition Ops

Current coordination source:

- `spec/SPEC_EVOL_SENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14d `chore/sentropic-transition-ops`

Status (2026-05-30): **REALIZED via the BR-37 lineage (BR-37c PR #186, BR-37d).** The operational transition below was executed during the k8s cutover + legacy decommission, not as a standalone BR-14d branch. The only remaining BR-14d input is the residual-name report produced by BR-14e. Evidence: `docs/uat/2026-05-28-decommission-top-ai-ideas-37d.md`.

Ordering rule:

- BR-14d executes the remaining transition work after PR-117 release actions and after BR-14e has finalized codebase names.
- BR-14d is mandatory unless every repo/DNS/redirect/Scaleway/container/registry/secret/workflow transition item is completed during PR-117 release.

Scope summary (status vs BR-37 realization):

- GitHub repository rename follow-up — DONE: repo is `rhanka/sentropic` (OIDC trusted-publisher + CI workflow reference `rhanka/sentropic`).
- `sentropic.sent-tech.ca` DNS and redirects from old `top-ai-ideas` hostnames — DONE (BR-37c/37d): public Ingress live + 301 Single Redirect `top-ai-ideas.sent-tech.ca` → sentropic.
- API hostname, CORS origins, cookie domain, OAuth callback URLs — DONE (BR-37c): WebAuthn RP ID `sent-tech.ca`, `AUTH_CALLBACK_BASE_URL`, CORS/cookie aligned to k8s. GitHub Pages custom domain is N/A (front served from k8s; legacy Pages deploy removed from `ci.yml`).
- Scaleway Container Serverless names, registry image names, secrets, workflows, dashboards, metadata — DONE (BR-37d/BR-14e): legacy serverless container `top-ai-ideas-api` + managed DB `top-ai-ideas-db` decommissioned; legacy deploy machinery removed from `ci.yml`/`Makefile` (only `deploy-k8s` remains); BR-14e removed the source-image retag bridge. RESIDUAL (operator): live document bucket value if it still points to `top-ai-ideas-docs` — fold into the BR-14e residual-name report and migrate only with SCW/cluster credentials.

Closure:

- No standalone BR-14d branch required — ops realized via BR-37c/37d. Close after BR-14e delivers the residual-name report and the two name-only residuals above are dispositioned (rename or accept-as-residual).
