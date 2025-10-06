# TODO - Top AI Ideas

## Check-list de mise en place

**✅ Terminé :**
- [x] Structure repo `/ui`, `/api`, Makefile, Dockerfiles, docker-compose
- [x] Schéma SQLite + migrations (Drizzle) appliqués
- [x] API TypeScript (Hono) avec schémas Zod, OpenAPI généré
- [x] Service OpenAI (Node) et endpoint `/use-cases/generate`
- [x] Calculs serveur et endpoints d'agrégation Dashboard
- [x] UI SvelteKit pages et stores, i18n FR/EN
- [x] Litestream config S3 (Scaleway) validée (backup/restore)
- [x] Système de queue SQLite avec QueueManager

**⏳ À faire :**
- [ ] Compléter les tests unitaires
- [ ] Compléter les tests E2E
- [ ] CI GitHub Actions (build/test)
- [ ] Déploiements: UI (GitHub Pages), API (Scaleway Container)
- [ ] Backups et reprise d'activité
- [ ] Auth Google/LinkedIn, sessions cookies HttpOnly
- [ ] Mise en place de rôles Admin général, Admin client, Guests clients
- [ ] Mise en place poker planning
- [ ] Mise en place de paiements
- [ ] Implémentation de l'authentification OIDC
- [ ] Pages `/configuration-metier` et `/donnees` complètes

