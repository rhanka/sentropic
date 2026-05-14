# SPEC_VOL — @sentropic/marketplace

Study branch: BR23. Intention to be confirmed before SPEC_EVOL translation.

## Intention

Livrer un module de marketplace managée permettant à toute organisation de définir son propre périmètre d'autonomie agentique : sources autorisées de skills/tools (`npm-public` / `npm-private:<scope>` / `mcp.so:<filter>` / `github:<repo-pattern>` / `internal-registry:<url>`), workflow d'approbation admin, audit trail, RBAC par workspace/rôle, perimeter par contexte. Composition naturelle avec `@sentropic/skills` (le catalogue) via consultation `MarketplaceEngine.evaluate(actor, action, target)` au moment du resolve. Cible : entreprises adoptant l'agentique avec contrôle de gouvernance équivalent à un store interne managé (npm enterprise, Salesforce AppExchange managed, VSCode enterprise gallery).

## Non-goal

Pas de distribution publique (déléguée à npm + mcp.so + GitHub). Pas de monétisation native. Pas d'agent marketplace au sens GPT Store (vendre des agents complets — hors scope jusqu'à demande explicite). Pas de catalogue de skills propre (consomme celui de `@sentropic/skills`).
