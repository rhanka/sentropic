# Feature: Deployment to GitHub Pages & Scaleway Container

## Objective
Setup automated deployment for UI (GitHub Pages) and API (Scaleway Container Serverless) with CI/CD integration. To enable streamlined deployment, migrate from sqlite to postgres, targetting serverless postgres db on scaleway.

## Plan / Todo

### Deployment (CI/CD, Scaleway, GitHub Pages)
- [x] Fix GitHub Actions conditions for deployment jobs (github.ref instead of branch)
- [x] Add missing dependencies in deployment jobs (needs: [changes, ...])
- [x] Fix deploy-ui job syntax (remove duplicate runs-on line)
- [x] Add Postgres 16 service in docker-compose (port 5432, volume, healthcheck)
- [x] Switch DB client to `pg` and `drizzle-orm/node-postgres`
- [x] Port schema from `sqliteTable` to `pgTable` (types kept simple: text/integer/timestamp)
- [x] Configure Drizzle for Postgres and generate initial migrations
- [x] Adjust Make targets and env to use Postgres `DATABASE_URL`
- [x] Update DB scripts (status/seed/backup/restore) for Postgres
- [x] Refactor residual raw `db.all/run` calls to Drizzle PG
- [x] 1) Update DB scripts for Postgres: `db-status`, `db-backup`, `db-restore`, `db-reset`
- [x] 2) Remove `sqlite` and `litestream` services from `docker-compose.yml`
- [x] 3) Remove host `ports: "5432:5432"` publish for Postgres (internal network only)
- [x] Affichage des listes post génération d'Entreprise en format Postgres `{...}` au lieu d'array (ex: produits, technologies, etc.)
  - Détail: depuis migration PG, les champs listes s'affichent sous forme de tableaux PG au lieu de JSON/tableaux
  - Hypothèse: sérialisation JSON manquante à l'insert/update; parsing manquant au GET
  - Fix: sérialisation JSON dans `queue-manager.ts:processCompanyEnrich` pour tous les champs array
- [x] Erreurs de cast numérique dans le détail cas d'usage (ex: `invalid input syntax for type integer: "57.5"`)
  - Détail: scores décimaux écrits dans des colonnes entières
  - Hypothèse: arrondir ou caster proprement avant write (totalValueScore/totalComplexityScore)
  - Fix: `Math.round()` dans `queue-manager.ts:processUseCaseDetail` avant UPDATE
- [x] Vues non rafraîchies automatiquement après traitement des jobs IA
  - Détail: après génération/enrichissement, l'UI ne se met pas à jour automatiquement
  - Hypothèse: événements/polling ou endpoints de statut à vérifier; comportement pré‑migration à rétablir
  - Fix: ajout RefreshManager aux pages entreprises (liste + détail) pour détecter `company.status === 'enriching'`
- [x] Propagation sources → dataSources et relatedData → dataObjects (schéma, API, UI)
  - Détail: changement de nomenclature dans les prompts et interface utilisateur
  - Fix: mise à jour schéma DB, API endpoints, queue manager, types UI, composants
- [x] Fix settings.set() pour Postgres (INSERT OR REPLACE → INSERT ... ON CONFLICT)
  - Fix: sauvegarde des paramètres IA fonctionne maintenant
- [x] Amélioration logging: modèle GPT utilisé + appels Tavily
  - Logging du modèle: `🤖 Using model: gpt-5 with web search`
  - Logging Tavily: `🔍 Tavily search called` + nombre de résultats
  - Augmentation max_results Tavily: 5 → 10
- [x] Fix defaultModel depuis settings au lieu de valeurs hardcodées
  - Les endpoints enrich/generate/detail respectent maintenant le modèle configuré dans l'UI
- [x] Fix markdown line breaks pour champs entreprise (\\n → \\n\\n)
  - Transformation appliquée à products, processes, challenges, objectives
- [x] Séparation db-init et db-migrate
  - db-init: vérifie si tables existent, initialise seulement si DB vierge
  - db-migrate: applique les nouvelles migrations (évolution du schéma)
- [x] Régénération migration Postgres initiale propre (data_sources, data_objects)
  - Migration initiale commitée (0000_luxuriant_natasha_romanoff.sql)
  - Workflow simplifié : db-init supprimé (redondant avec db-migrate)
- [x] Run unit/integration/E2E tests locally on Postgres and fix issues
  - ✅ API tests: 121 tests passed (smoke, unit, endpoints, queue, AI sync, AI async)
  - ✅ E2E tests: 91/101 tests passed, 10 skipped (normaux)
  - Migration Postgres 100% validée en local
- [x] Update CI to start Postgres and set `DATABASE_URL`
  - ✅ Ajout REGISTRY secret pour build-api
  - ✅ Ajout DATABASE_URL et env Postgres pour test-api-ai et test-e2e
  - Postgres démarré automatiquement via 'make up' dans docker-compose.yml
- [ ] Docs: README/TODO updates, add env migration notes
- [ ] Test Scaleway deployment locally with make commands
- [ ] Verify make publish-api-image works correctly
- [ ] Verify make deploy-api works correctly
- [ ] Test complete deployment flow
- [ ] Push changes and verify CI pipeline
- [ ] Update TODO.md and RELEASE.md

## Commits & Progress
- [ ] **Commit 1**: Fix GitHub Actions deployment conditions and job dependencies
- [ ] **Commit 2**: Complete and test deployment workflow

## Status
- **Progress**: Migration Postgres 100% complète et validée (212 tests passent). Prêt pour CI et déploiement.
- **Fonctionnel**: 
  - ✅ API + DB Postgres (7 tables, migrations propres)
  - ✅ Enrichissement entreprises avec Tavily (10 résultats)
  - ✅ Génération cas d'usage (10/10 complétés en 50s)
  - ✅ Paramètres IA configurables (modèle respecté, settings sauvegardés)
  - ✅ UI refresh automatique (entreprises, dossiers, cas d'usage)
  - ✅ Tests validés : 121 API + 91 E2E = 212 tests ✅
- **Prochaines étapes**: 
  1. Mettre à jour CI pour Postgres (service postgres + DATABASE_URL)
  2. Tester déploiement Scaleway en local
  3. Push et monitoring CI
  4. Docs (README, notes migration)


## Notes
- Need SCALEWAY_ACCESS_KEY and SCALEWAY_SECRET_KEY environment variables
- Need DOCKER_USERNAME, DOCKER_PASSWORD, and REGISTRY variables
- API_IMAGE_NAME and API_VERSION are auto-calculated by Makefile


