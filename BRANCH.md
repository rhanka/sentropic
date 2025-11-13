# Feature: Improve Use Case Cards and Detail Pages

## Objective
Améliorer l'apparence et la gestion des fiches de cas d'usage selon les spécifications du TODO.md. Cette feature se concentre sur l'UI uniquement (pas de changements API majeurs sauf pour stocker le modèle utilisé).

## Scope
- **UI**: Modifications des composants de cartes et de détail des cas d'usage
- **API**: Ajout d'un champ `model` dans le schéma `use_cases` pour stocker le modèle utilisé
- **Prompts**: Modification du format des références pour permettre les liens depuis les descriptions

## Plan / Todo

### 1. Base de données - Stockage du modèle utilisé
- [x] Ajouter le champ `model` (text, nullable, default 'gpt-5') dans le schéma `use_cases`
- [x] Générer la migration Drizzle
- [x] Mettre à jour le type TypeScript `UseCase` dans l'API
- [x] Modifier `queue-manager.ts` pour stocker le modèle lors de la création/détail d'un use case
- [x] Appliquer la migration avec `make db-migrate`

### 2. Références - Numérotation et format
- [x] Modifier le composant `References.svelte` pour afficher une numérotation (1, 2, 3...) avec des IDs pour le scroll
- [x] Modifier le prompt `use_case_detail` pour générer des références avec numérotation et utiliser `[1]`, `[2]` dans les descriptions
- [x] Modifier le prompt `use_case_list` pour générer des références avec numérotation
- [x] Transformer les `[1]`, `[2]` dans les descriptions en liens cliquables qui scrollent vers les références
- [x] Étendre le parsing des références à tous les champs : bénéfices, métriques, risques, prochaines étapes, justifications des axes

### 3. Carte de cas d'usage - Restructuration
- [x] Restructurer la carte avec un header et un footer clairs
- [x] Tronquer le titre avec `line-clamp-1` ou `truncate`
- [x] Tronquer la description avec `line-clamp-2` (déjà fait, vérifier)
- [x] Retirer les icônes "œil" (voir) et "modifier" (ligne 293-311 dans `+page.svelte`)
- [x] Repositionner l'icône poubelle dans le header (fixe par rapport au bord droit, visible au hover)
- [x] Tester l'affichage responsive

### 4. Tag modèle - Affichage
- [x] Ajouter le champ `model` au type `UseCase` dans `ui/src/lib/stores/useCases.ts`
- [x] Afficher un tag avec le modèle utilisé dans la carte (ex: "GPT-4.1-nano", "GPT-5")
- [x] Afficher le tag modèle dans la page de détail
- [x] Styliser le tag de manière cohérente (badge/tag Tailwind - vert pastel)

### 5. Label "Actif" - Suppression
- [x] Retirer l'affichage du label "Actif" (ligne 355-357 dans `cas-usage/+page.svelte`)
- [x] Vérifier qu'aucun autre endroit n'affiche ce label

### 6. Tests et validation
- [ ] Tester visuellement les cartes avec différents contenus (titres longs, descriptions longues)
- [ ] Tester la numérotation des références
- [ ] Tester l'affichage du tag modèle
- [ ] Vérifier que les tests E2E existants passent toujours
- [ ] Exécuter `make test-ui` pour vérifier les tests unitaires
- [ ] Mettre à jour les tests API pour inclure le champ `model` (voir TEST_IMPACT_ANALYSIS.md)
- [ ] Mettre à jour les tests UI pour inclure le champ `model` dans les mocks

## Réponses aux questions
1. **Format des références dans les descriptions**: Format `[1]`, `[2]` dans le texte markdown. Alternative si nécessaire : transformer en liens cliquables qui scrollent vers la section références.
2. **Style du tag modèle**: Tag de même couleur pour tous les modèles (style badge neutre).
3. **Migration du modèle**: Les générations actuelles utilisent GPT-5, donc mettre "GPT-5" par défaut pour les use cases existants.

## Commits & Progress
- [x] **Commit 1** (4f7a4fd): Add model field to use_cases schema and store model in queue-manager
- [x] **Commit 2** (f64b1ab): Add model field to UseCase type in UI store
- [x] **Commit 3** (9ef0ccd): Add model tag display in use case card and detail page, remove 'Actif' label
- [x] **Commit 4** (325025f): Restructure use case card with header/footer, remove eye/edit icons, truncate title
- [x] **Commit 5** (70c5bd4): Add numbering to references component
- [x] **Commit 6** (c0c18b4): Update prompts to generate numbered references with [1], [2] format in descriptions
- [x] **Commit 7** (691f0e1): Change model tag color to green pastel and parse [1] [2] references in markdown with scroll to references
- [x] **Commit 8** (9edf076): Extend reference parsing to benefits, metrics, risks, nextSteps and score descriptions
- [x] **Commit 9** (24ae653): Update BRANCH.md with completed tasks and commits

## Status
- **Progress**: 9/10 tasks completed (toutes les tâches principales implémentées)
- **Current**: Feature complète - tous les éléments demandés sont implémentés
- **Next**: Tests et validation avant merge (voir TEST_IMPACT_ANALYSIS.md pour les détails)

## Résumé des modifications

### Base de données
- ✅ Ajout du champ `model` dans le schéma `use_cases` (défaut: 'gpt-5')
- ✅ Migration générée et appliquée
- ✅ Queue-manager mis à jour pour stocker le modèle

### UI - Cartes de cas d'usage
- ✅ Restructuration avec header et footer
- ✅ Troncature du titre et de la description
- ✅ Suppression des icônes "œil" et "modifier"
- ✅ Repositionnement de l'icône poubelle dans le header
- ✅ Tag modèle avec couleur vert pastel (bg-green-100 text-green-700)
- ✅ Suppression du label "Actif"

### UI - Page de détail
- ✅ Tag modèle affiché à côté du titre

### Références
- ✅ Numérotation (1, 2, 3...) dans le composant References
- ✅ Parsing des références [1], [2] dans tous les champs :
  - Description (markdown)
  - Bénéfices
  - Mesures du succès (metrics)
  - Risques
  - Prochaines étapes
  - Justifications des axes valeur
  - Justifications des axes complexité
- ✅ Liens cliquables qui scrollent vers les références
- ✅ Double-clic sur les références : premier clic = focus, deuxième clic = ouverture URL

### Prompts
- ✅ Mise à jour des prompts pour générer des références numérotées
- ✅ Instructions pour utiliser [1], [2] dans les descriptions

