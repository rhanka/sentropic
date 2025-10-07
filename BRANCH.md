# Plan de branche — chore/init-workflow-setup (CI & Tests)

## Contexte récent
- Commits récents:
  - make test-api: completion des tests unitaires (API/UI), refactor des fichiers de tests, correctifs schémas & prompts par défaut.
  - make test-e2e: simplification des tests de génération IA (attente auto-save), suppression doublons API E2E, skip des tests entreprises instables, globalSetup Playwright, docker-compose.test avec montages.
  - chore(api): modèles OpenAI ajustés.
- TODO actuel: CI GitHub Actions (build/test) à implémenter; déploiements à venir; ré-activer/corriger 2 tests E2E entreprises.

## Objectifs de cette branche
1. Définir l’intégration des tests dans la CI via Make (Docker-first).
2. Proposer la matrice de jobs et les gates de qualité (lint, typecheck, tests, sécurité placeholders à garder).
3. Documenter le tri des suites (unit/UI/API vs E2E) et la stratégie de flakiness.

## Pipeline CI proposé (GitHub Actions)
- Jobs (exécutés via `make`, dans Docker):
  1) quality:
     - `make typecheck`
     - `make lint`
     - `make format-check`
  2) build:
     - `make build`
  3) test-unit-api:
     - `make test-api` (filtrage par suites via npm scripts si nécessaire)
  4) test-unit-ui:
     - `make test-ui`
  5) test-e2e-smoke (rapide, PR):
     - `make test-smoke`
  6) test-e2e-full (optionnel, nightly/tag):
     - `make test-e2e`
- Stratégie PR: exécuter quality, build, test-unit-api, test-unit-ui, test-e2e-smoke. Garder test-e2e-full pour nightly ou labels.

## Intégration des tests
- Unitaires API/UI: déjà complets; utiliser les scripts existants (Vitest) via Make.
- E2E Playwright:
  - Smoke ciblé sur « devrait charger » pour PR.
  - Global setup + seed de données conservés.
  - Les 2 tests entreprises restent skip tant que flakiness non résolue (voir actions ci-dessous).

## Gestion de la flakiness (entreprises)
- Problème: `EditableInput` auto-save (~5s) + enrichissement IA (>30s) ⇒ délais variables.
- Mesures:
  - Attentes explicites sur fin d’auto-save (locator/waitFor stable) et sur toasts/état réseau.
  - Timeouts relevés individuellement pour ces tests.
  - Marquage `@flaky` et exécution hors PR (nightly) jusqu’à stabilisation.

## Données & seed
- Conserver le chemin actuel: seed via scripts existants (`e2e/global-setup.ts`, `api/src/scripts/seed-test-data.ts`).
- La CI n’injecte aucun secret OpenAI; les tests doivent fonctionner en mode mock/fallback (déjà prévu côté API/tests).

## Sécurité & conformité (placeholders à garder)
- Conserver les cibles `sast`, `secrets-scan`, `sbom`, etc. non bloquantes pour l’instant.
- Prévoir leur activation ultérieure avec échecs bloquants selon `security.mdc`.

## Checklists
- Exécution locale de contrôle
  - [x] `make db-status` (ok)
  - [x] `make test-smoke` (ok)
- Intégration CI (à créer dans `.github/workflows/ci.yml`)
  - [ ] Jobs quality/build/test-unit-api/test-unit-ui/test-e2e-smoke
  - [ ] Artefacts Playwright (traces/rapports) uploadés sur échec
  - [ ] Cache Docker ou actions/setup-node (si besoin), mais priorité Docker-first
- Flaky tests entreprises
  - [ ] Ajouter attentes robustes (auto-save, toasts)
  - [ ] Marquer `@flaky` et exclure des PR
  - [ ] Activer en nightly une fois stabilisés

## Questions pour vous
1) En PR, souhaitez-vous exécuter uniquement le smoke E2E, ou inclure aussi quelques scénarios critiques supplémentaires (ex: navigation dossiers/cas)?
2) Validez-vous la séparation « PR = smoke » et « nightly = full E2E » ?
3) Avez-vous des exigences de version Node/Docker spécifiques en CI à figer (ex: Node 20.x) ?
4) Souhaitez-vous activer dès maintenant des scans sécurité bloquants (SAST/Trivy) ou les garder informatifs au départ ?
5) Pour les tests entreprises instables, préférez-vous qu’on les garde skip en PR et actifs only nightly jusqu’à correction, ou totalement exclus jusqu’à stabilisation ?

## Notes
Respecter `.cursor/rules/MASTER.mdc` (Docker-first, Make) et `.cursor/rules/security.mdc` (gates futurs). Les workflows CI doivent exclusivement appeler des cibles `make`.

