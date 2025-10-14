# TODO - Top AI Ideas

## Check-list de mise en place

**✅ Terminé :**
- [x] Structure repo `/ui`, `/api`, Makefile, Dockerfiles, docker-compose
- [x] Schéma PostgreSQL 16 + migrations (Drizzle) appliqués
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

**⏳ À faire :**
- [x] Fix 404 enterprises/[id] path in production
- [ ] Auth Google/LinkedIn, sessions cookies HttpOnly
- [ ] Ajouter un tool de recherche de brevets (Lens API)
- [ ] Mise en place de rôles Admin général, Admin client, Guests clients
- [ ] Implement security tests and add it in CI
- [ ] Backups automatisés PostgreSQL (remplacer Litestream)
- [ ] Mise en place poker planning
- [ ] Mise en place de paiements
- [ ] Implémentation de l'authentification OIDC
- [ ] Ré-activer et corriger les 2 tests E2E entreprises (création + bouton IA)
  - Raison du skip: `EditableInput` avec auto-save (5s) et enrichissement IA parfois >30s
  - Action: adapter le test pour attendre la fin d'auto-save et stabiliser l'enrichissement
- [ ] Pages `/configuration-metier` et `/donnees` complètes

