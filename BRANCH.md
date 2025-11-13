# Feature: Improve Use Case Cards and Detail Pages

## Objective
Améliorer l'apparence et la gestion des fiches de cas d'usage selon les spécifications du TODO.md. Cette feature se concentre sur l'UI uniquement (pas de changements API majeurs sauf pour stocker le modèle utilisé).

## Scope
- **UI**: Modifications des composants de cartes et de détail des cas d'usage
- **API**: Ajout d'un champ `model` dans le schéma `use_cases` pour stocker le modèle utilisé
- **Prompts**: Modification du format des références pour permettre les liens depuis les descriptions

## Plan / Todo

### 1. Base de données - Stockage du modèle utilisé
- [ ] Ajouter le champ `model` (text, nullable, default 'gpt-5') dans le schéma `use_cases`
- [ ] Générer la migration Drizzle
- [ ] Mettre à jour le type TypeScript `UseCase` dans l'API
- [ ] Modifier `queue-manager.ts` pour stocker le modèle lors de la création/détail d'un use case
- [ ] Appliquer la migration avec `make db-migrate`

### 2. Références - Numérotation et format
- [ ] Modifier le composant `References.svelte` pour afficher une numérotation (1, 2, 3...) avec des IDs pour le scroll
- [ ] Modifier le prompt `use_case_detail` pour générer des références avec numérotation et utiliser `[1]`, `[2]` dans les descriptions
- [ ] Modifier le prompt `use_case_list` pour générer des références avec numérotation
- [ ] Optionnel : Transformer les `[1]`, `[2]` dans les descriptions en liens cliquables qui scrollent vers les références (si le format markdown ne fonctionne pas bien)

### 3. Carte de cas d'usage - Restructuration
- [ ] Restructurer la carte avec un header et un footer clairs
- [ ] Tronquer le titre avec `line-clamp-1` ou `truncate`
- [ ] Tronquer la description avec `line-clamp-2` (déjà fait, vérifier)
- [ ] Retirer les icônes "œil" (voir) et "modifier" (ligne 293-311 dans `+page.svelte`)
- [ ] Repositionner l'icône poubelle dans le header (fixe par rapport au bord droit, visible au hover)
- [ ] Tester l'affichage responsive

### 4. Tag modèle - Affichage
- [ ] Ajouter le champ `model` au type `UseCase` dans `ui/src/lib/stores/useCases.ts`
- [ ] Afficher un tag avec le modèle utilisé dans la carte (ex: "GPT-4.1-nano", "GPT-5")
- [ ] Afficher le tag modèle dans la page de détail
- [ ] Styliser le tag de manière cohérente (badge/tag Tailwind)

### 5. Label "Actif" - Suppression
- [ ] Retirer l'affichage du label "Actif" (ligne 355-357 dans `cas-usage/+page.svelte`)
- [ ] Vérifier qu'aucun autre endroit n'affiche ce label

### 6. Tests et validation
- [ ] Tester visuellement les cartes avec différents contenus (titres longs, descriptions longues)
- [ ] Tester la numérotation des références
- [ ] Tester l'affichage du tag modèle
- [ ] Vérifier que les tests E2E existants passent toujours
- [ ] Exécuter `make test-ui` pour vérifier les tests unitaires

## Réponses aux questions
1. **Format des références dans les descriptions**: Format `[1]`, `[2]` dans le texte markdown. Alternative si nécessaire : transformer en liens cliquables qui scrollent vers la section références.
2. **Style du tag modèle**: Tag de même couleur pour tous les modèles (style badge neutre).
3. **Migration du modèle**: Les générations actuelles utilisent GPT-5, donc mettre "GPT-5" par défaut pour les use cases existants.

## Commits & Progress
- [x] **Commit 1** (4f7a4fd): Add model field to use_cases schema and migration
- [x] **Commit 2** (f64b1ab): Update UseCase type in UI store to include model field
- [x] **Commit 3** (9ef0ccd): Add model tag display in use case card and detail page, remove 'Actif' label
- [x] **Commit 4** (325025f): Restructure use case card with header/footer, remove eye/edit icons, truncate title
- [x] **Commit 5** (70c5bd4): Add numbering to references component
- [x] **Commit 6** (c0c18b4): Update prompts to generate numbered references with [1], [2] format in descriptions

## Status
- **Progress**: 9/10 tasks completed
- **Current**: All main tasks completed
- **Next**: Final testing and validation

