# Feature: Minor Fixes and Improvements

## Objective
Implémenter les corrections mineures et améliorations identifiées dans TODO.md (lignes 47-101), incluant :
- Corrections de bugs (404 sur refresh, comptage dans matrix, NavigationGuard, WebAuthn)
- Nouvelles fonctionnalités (ajout/suppression d'axes, amélioration EditableInput, troncature entreprise)
- Normalisation et améliorations techniques (refresh tokens, credentialBackedUp, enrichissement asynchrone, etc.)

## Scope
- **UI**: Corrections et améliorations d'interface utilisateur
- **API**: Normalisation et améliorations backend
- **Tests**: Validation des corrections et nouvelles fonctionnalités
- **CI**: Vérification que les tests passent

## Plan / Todo

### Phase 1: Corrections critiques (Fixes)
- [ ] **Fix 1**: Le refresh dans GitHub Pages (CTRL+R) des pages `cas-usage|entreprise/[id]` génère un 404 (régression)
  - Scope: UI (routing SvelteKit)
  - Fichiers à vérifier: `ui/src/routes/cas-usage/[id]/+page.svelte`, `ui/src/routes/entreprises/[id]/+page.svelte`
  
- [ ] **Fix 2**: Dans matrix, le nombre de cas n'est pas décompté (nombre par seuil de valeur pour configuration des seuils)
  - Scope: UI (page matrice)
  - Fichiers à vérifier: `ui/src/routes/matrice/+page.svelte`
  
- [x] **Fix 3**: NavigationGuard: sauver automatiquement
  - Scope: UI (composant NavigationGuard)
  - Fichiers à vérifier: `ui/src/lib/components/NavigationGuard.svelte` ou similaire
  
- [ ] **Fix 4**: WebAuthn - en prod OK pour register et login, mais en localhost pour dev, webauthn OK pour register mais pas pour login avec smartphone
  - Scope: API (service WebAuthn)
  - Fichiers à vérifier: `api/src/services/webauthn-authentication.ts`, configuration dev

### Phase 2: Nouvelles fonctionnalités (Features)
- [ ] **Feat 1**: Dans matrice, pouvoir ajouter et supprimer des axes de valeur/complexité
  - Scope: UI + API (page matrice + endpoints)
  - Fichiers à vérifier: `ui/src/routes/matrice/+page.svelte`, `api/src/routes/api/folders.ts`
  
- [ ] **Feat 2**: Dans EditableInput, pour les input markdown, mettre en exergue les champs édités avec un point orange (comme les inputs normaux) + hover avec bord gauche en gris
  - Scope: UI (composant EditableInput)
  - Fichiers à vérifier: `ui/src/lib/components/EditableInput.svelte`
  
- [ ] **Feat 3**: Dans les fiches entreprise (vue /entreprises), tronquer taille au même nombre de caractères que produits et services
  - Scope: UI (page entreprises)
  - Fichiers à vérifier: `ui/src/routes/entreprises/+page.svelte`

### Phase 3: Normalisation et améliorations techniques
- [ ] **Normalisation 1**: Normaliser l'incohérence titre/name/nom pour les UseCase
  - Scope: API + UI (prompts, schémas, interfaces)
  - Fichiers à vérifier: 
    - `api/src/services/default-prompts.ts` (ligne 69)
    - `api/src/services/context-usecase.ts` (ligne 6)
    - `api/src/services/queue-manager.ts` (lignes 328-330)
    - `ui/src/routes/dashboard/+page.svelte` (ligne 937)
  - Actions:
    1. Vérifier si le prompt doit générer `"name"` au lieu de `"titre"` pour cohérence
    2. Vérifier le schéma Zod côté API pour validation
    3. Normaliser sur `name` partout OU documenter la rétrocompatibilité
    4. Supprimer les fallbacks `(useCase as any)?.titre || (useCase as any)?.nom` si plus nécessaires
    5. Mettre à jour l'interface `UseCaseListItem` si nécessaire

- [ ] **Amélioration 1**: Implémenter le système de refresh tokens
  - Scope: API (session manager)
  - Fichiers à vérifier: `api/src/services/session-manager.ts`
  - Actions:
    - Activer `REFRESH_DURATION` (30 jours) et `refreshExpiresAt`
    - Ajouter endpoint pour rafraîchir les tokens
    - Gérer la rotation des refresh tokens

- [ ] **Amélioration 2**: Utiliser `credentialBackedUp` pour la gestion des devices
  - Scope: API (WebAuthn registration)
  - Fichiers à vérifier: `api/src/services/webauthn-registration.ts`
  - Actions:
    - Activer la vérification si un device est sauvegardé (backup)
    - Utiliser pour améliorer la gestion des credentials WebAuthn

- [ ] **Amélioration 3**: Réactiver l'enrichissement asynchrone des entreprises
  - Scope: API (routes companies)
  - Fichiers à vérifier: `api/src/routes/api/companies.ts`
  - Actions:
    - Activer la fonction `enrichCompanyAsync`
    - Utiliser la queue pour les enrichissements longs

- [ ] **Amélioration 4**: Réactiver le prompt de nom de dossier
  - Scope: API (routes use-cases)
  - Fichiers à vérifier: `api/src/routes/api/use-cases.ts`
  - Actions:
    - Activer `folderNamePrompt`
    - Utiliser pour générer automatiquement les noms de dossiers

- [ ] **Amélioration 5**: Réactiver la fonction `parseExecutiveSummary`
  - Scope: API (routes folders)
  - Fichiers à vérifier: `api/src/routes/api/folders.ts`
  - Actions:
    - Activer si nécessaire
    - Utiliser pour parser les synthèses exécutives stockées

- [ ] **Amélioration 6**: Implémenter l'annulation réelle des jobs dans la queue
  - Scope: API (routes queue)
  - Fichiers à vérifier: `api/src/routes/api/queue.ts`, `api/src/services/queue-manager.ts`
  - Actions:
    - Implémenter l'interruption réelle d'un job en cours d'exécution
    - Utiliser les AbortController déjà présents dans QueueManager

### Phase 4: Tests et validation
- [ ] **Test 1**: Exécuter les tests unitaires (`make test.unit`)
- [ ] **Test 2**: Exécuter les tests E2E pour valider les corrections UI (`make test-e2e`)
- [ ] **Test 3**: Vérifier le linting et typecheck (`make lint`, `make typecheck`)
- [ ] **Test 4**: Vérifier la CI GitHub Actions après push

## Commits & Progress
- [x] **Commit initial**: Création de la branche et BRANCH.md
- [x] **Commit 1**: Fix 404 sur refresh GitHub Pages - activation du fallback 404.html
- [x] **Commit 2**: Fix comptage dans matrix - calcul et affichage du nombre de cas par seuil
- [x] **Commit 3**: Fix auto-save des seuils et recalcul automatique des comptages
- [x] **Commit 4**: Fix NavigationGuard - sauvegarde automatique au lieu d'afficher un dialogue

## Status
- **Progress**: 4/20 tâches complétées
- **Current**: Fix NavigationGuard - sauvegarde automatique complété
- **Next**: Fix 4 - WebAuthn login avec smartphone en localhost

## Questions avant de commencer
1. **Priorité**: Quelle phase doit être traitée en premier ? (suggéré: Phase 1 - corrections critiques)
2. **Normalisation UseCase**: Préférence pour normaliser sur `name` partout ou maintenir la rétrocompatibilité avec `titre`/`nom` ?
3. **Refresh tokens**: Cette fonctionnalité est-elle prioritaire ou peut-elle être reportée ?
4. **Tests**: Doit-on créer de nouveaux tests pour chaque correction/amélioration ou seulement valider avec les tests existants ?

