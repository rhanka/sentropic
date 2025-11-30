# TODO - Top AI Ideas

## Check-list de mise en place

**✅ Terminé :**
- [x] Structure repo `/ui`, `/api`, Makefile, Dockerfiles, docker-compose
- [x] Schéma SQL + migrations (Drizzle) appliqués
- [x] API TypeScript (Hono) avec schémas Zod, OpenAPI généré
- [x] Service OpenAI (Node) et endpoint `/use-cases/generate`
- [x] Calculs serveur et endpoints d'agrégation Dashboard
- [x] UI SvelteKit pages et stores, i18n FR/EN
- [x] Système de queue PostgreSQL avec QueueManager
- [x] Compléter les tests unitaires (121 tests API)
- [x] Compléter les tests E2E (91/101 tests Playwright)
- [x] CI GitHub Actions (build/test/deploy)
- [x] Migration SQLite → PostgreSQL 16
- [x] Déploiements: UI (GitHub Pages), API (Scaleway Container)
- [x] Fix UI deployment (api url harcoding > VITE_API_BASE_URL)
- [x] Fix CORS - enable front from *.sent-tech.ca and localhost
- [x] Fix 404 enterprises/[id] path in production
- [x] Auth Webauth with mail chck + minimal RBAC
- [x] Usecase UI: card with headers/footer, model tag, citations

**⏳ À faire :**
- [x] Améliorer Dashboard en tant que synthèse exécutive
  - [x] ajouter une zone de ROI (top left quadrant, vert, to be discussed)
  - [x] le graphique devrait remplir max 50% de l'écran, et devrait être plus haut
  - [x] le label du cas doit être inscrit sans hover, et au hover la description doit être affichée, valeur complexité et non le statut
  - [x] ajouter un prompt pour synthèse exécutive de l'ensemble des cas : introduction incluant description du dossier et enjeux de l'entreprise, une analyse générale présentant une mise en exergue les tops cas - format à challenger / discuter
  - [x] Génération d'un rapport reprenant synthèse exécutive et dashboard et l'ensemble des cas (une page par cas ?)
- [x] Séparer dans la génération la description en: description (plus courte), problème, solution
- [ ] Ajouter les modèles 5.1 max (5.1 avec reasoning "max"), 5.1 (sans paramétrage), 5.1-mini, 5.1-nano
- [ ] Fixer les tests de linting et de typecheck et les appliquer
- [ ] Implémenter un chatbot pour interagir avec le cas d'usage, ou bin le rapport exécutif, ou encore l'entreprise
- [ ] Implémenter la gestion d'organisation (multi utilisateur) et de partage entre utilisateurs (dossiers, organisation)
- [ ] Fonctions de désactivation de dossier / cas d'usage / entreprise, de partage entre utilisateurs, de publication (publique)
- [ ] Gestion des profils freemium / payant: gestion du nombre d'enrichissements / utilisateur / type de modèle
- [ ] Mise en place poker planning
- [ ] Ajouter un tool de recherche de brevets (Lens API)
- [ ] Implement security tests and add it in CI
- [ ] Backups automatisés PostgreSQL (externalisation sur S3)
- [ ] Mise en place de paiements
- [ ] Ré-activer et corriger les 2 tests E2E entreprises (création + bouton IA)
  - Raison du skip: `EditableInput` avec auto-save (5s) et enrichissement IA parfois >30s
  - Action: adapter le test pour attendre la fin d'auto-save et stabiliser l'enrichissement

