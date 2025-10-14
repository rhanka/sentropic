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
- [x] Fix 404 enterprises/[id] path in production

**⏳ À faire :**
- [ ] Auth:
    - [ ] avec @simplewebauthn/{server,browser} cookie HttpOnly
    - [ ] RP Config
    - [ ] Schéma DB “webauthn_credentials” (Drizzle) pour lier clés → user : credentialId (base64url, unique), publicKey (PEM/COSE b64), counter, userId, deviceName, transports, uvFlag, timestamps (à confirmer)
    - [ ] table pour stocker les refresh tokens / device sessions pour révocation, liste d’appareils, et état MFA.
    - [ ] stockage des challenges (posgres + expiresAt + used + purge au démarrage cold start) avec TTL (60–300 s)
    - [ ] Flow : routes d’init + de vérif (register & auth) côté server + appels @simplewebauthn/browser côté client.
    - [ ] JWT/session après vérif (jose/cookies)
    - [ ] RBAC (admin app, admin org, editor, guest)
    - [ ] secureHeaders (équiv de Helmet pour Hono) (CSP/HSTS/COOP/COEP) et CORS strict
    - [ ] Rate-limit sur /webauthn/*
    - [ ] User Verification : required pour admins, preferred pour éditeurs.
    - [ ] Attestation policy : la plupart du temps none; sinon gère la vérification des certs.
    - [ ] secours lien magique
- [ ] Traçabilité des modèles (GPT5, GPT4.1nano) utilisés pour chaque enrichissement
- [ ] Approfondissement d'un enrichissement (passer de GPT4.1.nano à GPT5 pour un enrichissement)
- [ ] Interaction ciblée autour d'un cas d'usage ou entreprise
- [ ] Gestion des profils freemium / payant: gestion du nombre d'enrichissements / utilisateur / type de modèle
- [ ] Mise en place poker planning
- [ ] Ajouter un tool de recherche de brevets (Lens API)
- [ ] Implement security tests and add it in CI
- [ ] Backups automatisés PostgreSQL (externalisation sur S3)
- [ ] Mise en place de paiements
- [ ] Ré-activer et corriger les 2 tests E2E entreprises (création + bouton IA)
  - Raison du skip: `EditableInput` avec auto-save (5s) et enrichissement IA parfois >30s
  - Action: adapter le test pour attendre la fin d'auto-save et stabiliser l'enrichissement

