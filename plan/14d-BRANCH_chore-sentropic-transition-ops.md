# Branch Plan Stub: BR-14d Sentropic Transition Ops

Current coordination source:

- `spec/SPEC_EVOL_SENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14d `chore/sentropic-transition-ops`

Ordering rule:

- BR-14d executes the remaining transition work after PR-117 release actions and after BR-14e has finalized codebase names.
- BR-14d is mandatory unless every repo/DNS/redirect/Scaleway/container/registry/secret/workflow transition item is completed during PR-117 release.

Scope summary:

- GitHub repository rename follow-up if PR-117 release did not finish it.
- `sentropic.sent-tech.ca` DNS and redirects from old `top-ai-ideas` hostnames.
- GitHub Pages custom domain, API hostname, CORS origins, cookie domain, OAuth callback URLs.
- Scaleway Container Serverless names, registry image names, secrets, workflows, dashboards, logs, alerts, and deployment metadata.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Include a deployment window, rollback plan, DNS verification steps, and provider-object inventory.
