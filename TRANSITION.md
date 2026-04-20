# Entropic Transition Plan

This branch records the Entropic transition at repository level: public README pair, canonical public URL, branch sequencing, and the operational checklist for repo, DNS, redirects, and Scaleway objects.

External state changes such as GitHub repository rename, DNS records, redirects, and Scaleway object renames are not fully represented by git commits. They must be executed against the corresponding providers, but they should follow this plan so the transition remains auditable.

## Canonical Targets

- Repository target: `rhanka/entropic`.
- Public site target: https://entropic.sent-tech.ca.
- French editorial reference: [README.fr.md](README.fr.md).
- GitHub default README: [README.md](README.md), English translation of the French reference.
- Package namespace target: `@entropic/*`.

## Transition Principles

- `Top AI Ideas` becomes a business case running on Entropic, not the project name.
- New extracted packages use `@entropic/*`.
- Existing `top-ai`, `@top-ai/*`, `TOP_AI_*`, container names, image names, and DNS names are migrated in scoped branches, not by a repository-wide rename commit.
- Public redirects must be kept in place during and after the rename.
- Infrastructure object renames are staged after the application-level package/runtime split, unless a provider constraint forces them earlier.

## Branch Sequencing

| ID | Branch | Purpose | Priority |
| --- | --- | --- | --- |
| BR-14c | `feat/llm-mesh-sdk` | Publish the first standalone npm service: `@entropic/llm-mesh`, an open Vercel AI SDK-like layer for GPT, Claude, Gemini, Mistral, and Cohere access. It covers token-based use, Codex-account use, and prepares later Gemini Code Assist / Claude Code account support. | First |
| BR-14b | `refacto/llm-runtime-core` | Migrate the application LLM runtime onto the mesh abstraction: provider contracts, capability matrix, streaming normalization, retries, quotas, and internal API cleanup. | After BR-14c contract |
| BR-14a | `feat/chat-ui-sdk` | Extract `@entropic/chat` from the web, Chrome, and VSCode surfaces. It should depend on the LLM mesh contract rather than application runtime internals. | After BR-14c, can scope in parallel |
| BR-14d | `chore/entropic-infra-rename` | Rename or alias deployment objects: Scaleway containers, registry images, secrets, workflow names, environment variables, and dashboards. Preserve redirects and rollback path. | After repo/DNS decision and runtime package plan |

## GitHub Repository Rename

Target: `rhanka/top-ai-ideas-fullstack` -> `rhanka/entropic`.

Checklist:

- Confirm no critical PR is mid-merge when the rename is executed.
- Rename the repository in GitHub settings or via GitHub API.
- Keep GitHub's automatic repository redirects active.
- Update local remotes in active worktrees after the rename.
- Update CI badges, README links, deployment metadata, and any GitHub Pages settings that reference the old repository name.
- Verify open PRs, branch protections, required checks, and environments after the rename.

## DNS and Redirects

Canonical public site: https://entropic.sent-tech.ca.

Checklist:

- Create or confirm the `entropic.sent-tech.ca` DNS record for the UI.
- If the API moves to a new hostname, define it explicitly before changing production traffic.
- Keep the existing `top-ai-ideas` public hostnames as redirects or aliases during the transition.
- Update GitHub Pages custom-domain configuration if the UI is still served from GitHub Pages.
- Update CORS, cookie domain, OAuth callback URLs, and allowed origins after the canonical domain changes.
- Verify redirects with HTTP status codes and browser login flows before removing old hostnames.

## Scaleway Objects

Scaleway object rename can be deferred to BR-14d unless a hard external dependency requires it earlier.

Objects to inventory before renaming:

- Container Serverless services.
- Registry namespaces and image names.
- Secrets and environment variables using `TOP_AI`, `top-ai`, or `top-ai-ideas`.
- Cockpit dashboards, alerts, and logs.
- Deployment workflow references in GitHub Actions.
- Public API endpoints and any Scaleway-side custom domains.

Safe approach:

- Add new `entropic` names as aliases or parallel objects where possible.
- Deploy the same image to both old and new targets during validation.
- Move DNS only after health checks pass.
- Keep old objects during the rollback window.
- Delete or retire old objects only after redirects, logs, and monitors prove stable.

## Rename Inventory

The following strings should be inventoried before implementation branches start:

- `top-ai`
- `top_ai`
- `top-ai-ideas`
- `Top AI Ideas`
- `@top-ai/`
- `TOP_AI`
- old DNS hostnames under `sent-tech.ca`

Inventory output should be attached to the relevant branch notes before implementation, not applied as one broad mechanical rename.

## Acceptance Criteria

- README pair is clear: French reference plus English GitHub default.
- `entropic.sent-tech.ca` is documented as the canonical public URL.
- GitHub repository rename has a checklist and rollback-aware execution order.
- DNS redirect and OAuth/CORS risks are explicitly listed.
- Scaleway renames are planned as a separate scoped branch unless explicitly pulled into this branch.
- BR-14 is split into BR-14a, BR-14b, BR-14c, with BR-14c prioritized before chat extraction.
