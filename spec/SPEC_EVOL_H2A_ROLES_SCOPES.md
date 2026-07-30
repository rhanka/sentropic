# SPEC_EVOL — h2a Roles ↔ Scopes ↔ Workpackages alignment

Status: RATIFIED (owner rhanka, 2026-07-14). Conductor-authored governance change.

## Intent

Align h2a **roles** 1:1 with track **workpackages** so that (a) reporting is legible
**per part** (`track report` rolls up `%` per WP = per role), and (b) memory can later be
**scoped per role**. Before this change the WP taxonomy was organised by architect study-concern;
several delivery lanes (mcp, auth, mesh, canevas, cowork) had **no** WP, and 5/7 WPs were
accountable to `architect`.

## Principles (owner-ratified)

- **The architect builds nothing.** `architect` owns design/contracts/policy/studies/benchmarks +
  resource-plane *design*. Every build lands in a builder lane.
- **Knowledge is not a Sentropic build lane.** It is co-owned by architecture *(design)* +
  graphify *(repo)* + h2a *(protocol)*. Its study part lives in architecture; its build lives in
  graphify/h2a (outside the Sentropic WP grid).
- **Tooling/infrastructure is separated** into its own role `infra` (not folded into canevas).
- **Registries are a shared primitive**, not a WP: the substrate is `infra`; `mcp` / `canevas` /
  `infra` each manage their own registry instance.
- **The conductor owns a WP** (`WP-GOUV`): taxonomy, reporting, RACI, orchestration, relays.
- **immo** is out of scope (separate repo, org-B).

## Role → WP → accountable

| Rôle (accountable) | WP | Nature | Scope |
|---|---|---|---|
| conductor | WP-GOUV | gouvernance | Taxonomie rôles/WP, reporting par-partie, RACI, orchestration, relais |
| architect | WP-BENCH | design | Best-of benchmarks par périmètre (informe l'architecture) |
| architect | WP-FRAME / WP-RESP / WP-DATA / WP-KNOW | design | Framing studies, resource-plane (design), data spine, knowledge (as-architecture) |
| infra | WP-INFRA | build | build-cli, harness, CI/CD, deployment-plane, data-spine impl, resource-plane impl, substrat registry |
| agents | WP-AGENTS | build | Framework agentique + moteur : orchestration, loop/steering, runtime h2a |
| mcp | WP-MCP | build | provider platform, mcp-auth RS, catalog, connectors, control-plane-ui, registry mcp |
| auth | WP-AUTH | build | IdP, auth-hono, auth-ui, OAuth clients, federation, tenant/roles |
| cyber | WP-CYBER | build | SAST/SCA/scan conteneurs, registre vuln, secrets & clés, pentests, revues sécu |
| llm-mesh | WP-MESH | build | llm-mesh + llm-gateway (egress authentifié/poolé/mesuré) + comptes |
| chat | WP-CHAT | build | chat-ui/server/core, turnkey conversation, DS presets |
| canevas | WP-CANEVAS | build | live board/dossier + applis (diag, annot, PDF/cited-source, focus), registry canevas |
| cowork | WP-COWORK | build | desktop distribution, computer-use, remote sessions, local MCP, **app Android + Mac (chat contextuel)** |
| plugins | WP-PLUGINS | build | extension Chrome, extension VSCode |
| app | WP-APP | build | produit déployé : shell/cockpit, admin, UAT, inventory MCP/ressources, decision cockpit |

Adjacent roles (not Sentropic WPs): **track** (mandataire, record-only) · **h2a** (protocol).

## Notes / follow-ups

- **Data**: kept under `architect` (design) for now — the *impl* moves to the owning build lane
  when it is built (owner: "data c'est de l'archi… ça dépend si on est en design ou build").
- **Android + Mac** contextual-chat-pop = a declination of **cowork** (not plugins).
- **Unstaffed at ratification**: infra, agents, cyber, plugins have WPs but no live lane agent yet.
- **Legacy re-accountable WPs** (WP-CHATUI, old WP-APP, old WP-BENCH-conductor) were emptied
  (children reparented) and marked cancelled; they linger as empty shells until track supports WP
  deletion.
- **BR-72** (connector recoding, W1×3 done + W2) reparented under WP-MCP.
