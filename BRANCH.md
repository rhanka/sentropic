# Feature: Minor Fixes and Improvements

## Objective
Implémenter les corrections mineures et améliorations identifiées dans TODO.md (lignes 47-101).

## Status
- **Progress**: Complété ✅
- **Typecheck API** : 0 erreur ✅
- **Typecheck UI** : 0 erreur, 0 warning ✅
- **Lint API** : 0 erreur ✅
- **Lint UI** : 0 erreur ✅

## Commits (34 depuis main)

### Fixes
- Fix 404 sur refresh GitHub Pages (fallback 404.html)
- Fix comptage dans matrix (calcul et affichage du nombre de cas par seuil)
- Fix auto-save des seuils et recalcul automatique des comptages
- Fix NavigationGuard (sauvegarde automatique au lieu d'afficher un dialogue)
- Fix typecheck API (corrections multiples : UseCase.data, queue, session-manager, tools, nodemailer, WebAuthn, createdAt)
- Fix WebAuthn (suppression challengeId, utilisation directe de credentialResponse.id/credentialID, conversion attestationType)
- Fix session-manager (vérification explicite des types JWTPayload, gt() avec timestamps)
- Fix queue (erreur 500 - utiliser Drizzle ORM au lieu de SQL brut)
- Fix typecheck UI (matrice: availableFolders, MatrixAxis, points, e.target, hasMatrix, apiGet)
- Fix UI warnings Svelte (a11y: label, article; CSS: sélecteurs dynamiques)
- Fix lint UI (variables non utilisées: Company, interceptPush/Replace, currentScale, apiPost, originalPushState/ReplaceState)
- Fix `as unknown as UseCaseData` (remplacé par type helper `UseCaseDataJson`)
- Fix `as any` et `as unknown as` (transportsJson, WebAuthnCredential)
- Fix createdAt NOT NULL (ajout .notNull() à toutes les colonnes, suppression workarounds)

### Features
- Feat ajout/suppression d'axes dans matrice
- Feat tronquer taille dans fiches entreprise
- Feat EditableInput markdown avec bordure orange et hover bord gauche gris
- Feat édition du titre/nom du usecase avec EditableInput (multiline)
- Feat multiline title editing avec layout 50/50 pour entreprises
- Feat dashboard folder title multiline et full width
- Feat multiline editing pour noms d'axes valeur/complexité dans matrice
- Feat unifier auto-save matrice et éviter fetch inutile lors modification poids

### Tests
- Test: update E2E tests for multiline title editing and matrix features

### Chores
- Chore: remove unused /api/test/seed endpoint
- Chore: replace @simplewebauthn/types imports with @simplewebauthn/server

### Reverts
- Revert: WebAuthn local IP addresses fix (non fonctionnel)

## Bilan final

**Toutes les vérifications passent** :
- ✅ Typecheck API : 0 erreur (28 corrigées)
- ✅ Typecheck UI : 0 erreur, 0 warning (13 erreurs corrigées)
- ✅ Lint API : 0 erreur
- ✅ Lint UI : 0 erreur (25 erreurs corrigées)

**Corrections majeures** :
- ✅ Suppression de toutes les mauvaises pratiques (`as unknown as`, `as any`)
- ✅ Ajout de `.notNull()` à toutes les colonnes `createdAt` (9 tables)
- ✅ Utilisation de Drizzle ORM pour toutes les requêtes (cohérence type safety)
- ✅ Correction de tous les types WebAuthn (imports, credentialResponse.id, attestationType)
- ✅ Amélioration de l'accessibilité (a11y) et des warnings Svelte
