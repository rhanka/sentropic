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
- [ ] Fixer les cibles make pour linting et de typecheck puis les appliqur progressivement, cible par cible en faisant un plan
- [ ] Minor feat and fixs
  - [ ] Fix: le refresh dans github pages (CTRL+R) des pages cas-usage|entreprise/[id] génère un 404 (c'est une régression)
  - [ ] Fix: Dans matrix, le nombre de cas n'est pas décompté (nombre par seuil de valeur pour configuration des seuils de valeur et complexité).
  - [ ] Feat: Dans matrice, il faut pouvoir ajouter et supprimer des axes de valeur complexité
  - [ ] Feat: dans EditableInput, pour les input markdown, mettre en exergue les champs édités avec un point orange (comme les inputs normaux) + hover avec bord gauche en gris
  - [ ] Feat: dans les fiches entreprise (vue /entreprises), tronquet taille au meme nombre de caractères que produits et services (...)
  - [ ] Fix: NavigationGuard: sauver automatiquement, tout simplement !
  - [ ] Fix webauthn : in prod web auth is both ok for register and login, but in localhost for dev, webauthn is ok for register but not for login with a smartphone
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

## Éléments identifiés pour implémentation future (lors du linting)

- [ ] **Implémenter le système de refresh tokens**
  - Activer `REFRESH_DURATION` (30 jours) et `refreshExpiresAt` dans `session-manager.ts`
  - Ajouter endpoint pour rafraîchir les tokens
  - Gérer la rotation des refresh tokens

- [ ] **Utiliser `credentialBackedUp` pour la gestion des devices**
  - Activer la vérification si un device est sauvegardé (backup)
  - Utiliser pour améliorer la gestion des credentials WebAuthn
  - Fichier: `api/src/services/webauthn-registration.ts`

- [ ] **Réactiver l'enrichissement asynchrone des entreprises**
  - Activer la fonction `enrichCompanyAsync` dans `api/src/routes/api/companies.ts`
  - Utiliser la queue pour les enrichissements longs
  - Actuellement commentée car non utilisée

- [ ] **Réactiver le prompt de nom de dossier**
  - Activer `folderNamePrompt` dans `api/src/routes/api/use-cases.ts`
  - Utiliser pour générer automatiquement les noms de dossiers
  - Actuellement commenté car non utilisé

- [ ] **Réactiver la fonction `parseExecutiveSummary`**
  - Activer dans `api/src/routes/api/folders.ts` si nécessaire
  - Utiliser pour parser les synthèses exécutives stockées
  - Actuellement commentée car non utilisée

- [ ] **Implémenter l'annulation réelle des jobs dans la queue**
  - Actuellement juste un TODO dans `api/src/routes/api/queue.ts`
  - Nécessite d'interrompre réellement un job en cours d'exécution
  - Utiliser les AbortController déjà présents dans QueueManager

