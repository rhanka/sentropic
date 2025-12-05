# Feature: Minor Fixes and Improvements

## Objective
Implémenter les corrections mineures et améliorations identifiées dans TODO.md (lignes 47-101).

## Status
- **Progress**: 9/20 tâches complétées
- **Current**: Feat 4 complété (édition multiline du titre avec layouts différenciés)
- **Next**: Retravailler Fix WebAuthn pour login smartphone en localhost dev

## Commits
- [x] **Commit 1**: Fix 404 sur refresh GitHub Pages - activation du fallback 404.html
- [x] **Commit 2**: Fix comptage dans matrix - calcul et affichage du nombre de cas par seuil
- [x] **Commit 3**: Fix auto-save des seuils et recalcul automatique des comptages
- [x] **Commit 4**: Fix NavigationGuard - sauvegarde automatique au lieu d'afficher un dialogue
- [ ] **Commit 5**: Fix WebAuthn - accepter les IPs locales pour login smartphone en localhost dev (reverté, à retravailler)
- [x] **Commit 6**: Feat ajout/suppression d'axes dans matrice
- [x] **Commit 7**: Feat tronquer taille dans fiches entreprise
- [x] **Commit 8**: Feat EditableInput markdown avec bordure orange et hover bord gauche gris
- [x] **Commit 9**: Feat édition du titre/nom du usecase avec EditableInput
- [x] **Commit 10**: Feat multiline title editing avec layout 50/50 pour entreprises

## Plan d'évolution des tests

### Tests à mettre à jour (priorité haute)

#### 1. Tests E2E - Édition de titre (multiline)
**Fichiers concernés** : `e2e/tests/workflow.spec.ts`, `e2e/tests/companies.spec.ts`, `e2e/tests/companies-detail.spec.ts`

**Problème** : Les tests cherchent `h1 input.editable-input` mais maintenant c'est un `textarea` pour les entreprises et usecases.

**Actions** :
- Mettre à jour les sélecteurs : `h1 input.editable-input` → `h1 textarea.editable-textarea, h1 input.editable-input`
- Tester l'édition multiline (retours à la ligne)
- Vérifier que le textarea s'ajuste automatiquement en hauteur

#### 2. Tests E2E - Matrice (ajout/suppression d'axes)
**Fichier concerné** : `e2e/tests/matrix.spec.ts`

**Nouvelles fonctionnalités non testées** :
- Ajout d'un axe de valeur/complexité
- Suppression d'un axe de valeur/complexité
- Comptage automatique des cas par seuil
- Auto-save des seuils (vérifier sauvegarde après 5s d'inactivité)

**Actions** :
- Ajouter test pour boutons "Ajouter axe de valeur" / "Ajouter axe de complexité"
- Ajouter test pour boutons de suppression d'axes
- Vérifier que le comptage se met à jour après modification des seuils
- Vérifier l'auto-save (attendre 5s après modification)

### Tests optionnels (priorité moyenne)

#### 3. Tests E2E - NavigationGuard auto-save
**Fichier concerné** : Nouveau test ou `e2e/tests/workflow.spec.ts`

**Action** :
- Tester que les modifications sont sauvegardées automatiquement lors de la navigation
- Vérifier qu'aucun dialogue de confirmation n'apparaît

#### 4. Tests E2E - Layout 50/50 vs 2/3
**Fichiers concernés** : `e2e/tests/usecase-detail.spec.ts`, `e2e/tests/companies-detail.spec.ts`

**Action** :
- Vérifier visuellement que le layout est correct (titre sur 2/3 pour usecase, 50/50 pour entreprise)
- Test optionnel (visuel, peut être vérifié manuellement)

### Tests non nécessaires

- **Fix 404 sur refresh** : Difficile à tester en E2E (nécessite serveur statique), vérifié manuellement
- **Fix WebAuthn localhost** : Testé dans `e2e/tests/auth-webauthn.spec.ts`, le cas localhost est spécifique au dev
- **Troncature taille entreprise** : Changement visuel mineur, vérifié manuellement
- **Bordure orange EditableInput** : Changement visuel, vérifié manuellement

### Conclusion

**Action immédiate** : Mettre à jour les sélecteurs dans les tests existants pour supporter `textarea` au lieu de `input` uniquement.

**Action future** : Ajouter des tests pour les nouvelles fonctionnalités de la matrice (ajout/suppression d'axes, comptage, auto-save).

**Décision** : Si aucune feature testée n'est changée, on verra si ça passe au CI. Les tests existants devraient continuer à fonctionner avec les mises à jour de sélecteurs.
