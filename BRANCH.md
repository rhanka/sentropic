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
- [ ] Run unit/integration/E2E tests locally on Postgres and fix issues (API: OK, AI sync: OK; AI async: borderline local)
- [ ] Update CI to start Postgres and set `DATABASE_URL`
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
- **Progress**: Postgres local switched (service, client, schema, migrations). Cleanup done. API smoke/unit/endpoints/queue: OK. AI sync: OK.
- **Current**: AI async completes partially locally (4/10 in 120s) — latency-bound; expected stable in CI.
- **Next**: Push branch, monitor CI; then run full E2E UI and update docs.


## Notes
- Need SCALEWAY_ACCESS_KEY and SCALEWAY_SECRET_KEY environment variables
- Need DOCKER_USERNAME, DOCKER_PASSWORD, and REGISTRY variables
- API_IMAGE_NAME and API_VERSION are auto-calculated by Makefile


