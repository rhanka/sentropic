# SPEC_VOL — @sentropic/harness

Study branch: BR23. Intention to be confirmed before SPEC_EVOL translation.

## Intention

Livrer un outil neutre de scaffolding / conductor / verify pour AI dev — branch discipline, BRANCH.md templates, plan/spec templates, verify hooks (lint/typecheck/migration/test plugins), conductor CLI — importable depuis tout repo tiers via npm + CLI binary `harness`, sans dépendance runtime sur l'app Sentropic. Consomme `@sentropic/graphify` (issu de la fusion du package `graphifyy@0.7.10` sous le namespace `@sentropic` — voir `SPEC_VOL_GRAPHIFY.md`) pour la commande `harness graph extract|query|publish`. Cible : équipes voulant adopter notre méthode de pilotage agentique sans adopter notre stack produit.

## Non-goal

Pas de logique applicative runtime. Pas de remplacement des CLIs existantes (Claude Code, Codex, Gemini). Pas de catalogue de skills (couvert par `@sentropic/skills`). Pas de marketplace managée (couvert par `@sentropic/marketplace`). Pas de dépendance runtime depuis aucun autre package `@sentropic/*` runtime.
