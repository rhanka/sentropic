# Analyse d'impact sur les tests - Feature: Improve Use Case Cards

## Résumé exécutif

Cette feature ajoute le champ `model` dans la base de données et modifie l'UI pour améliorer l'affichage des cartes de cas d'usage. L'impact sur les tests est **modéré** : certains tests existants doivent être mis à jour, et de nouveaux tests doivent être ajoutés.

## Impact sur les tests API

### Tests existants à mettre à jour

#### 1. `api/tests/api/use-cases.test.ts`
**Impact**: ⚠️ **Moyen**
- **Raison**: Les tests vérifient la création et la récupération de use cases, mais ne vérifient pas le champ `model`
- **Actions requises**:
  - Vérifier que le champ `model` est retourné dans les réponses GET
  - Vérifier que le champ `model` est stocké lors de la création (si fourni)
  - Vérifier que le champ `model` a la valeur par défaut 'gpt-5' si non fourni
  - Mettre à jour les assertions pour inclure le champ `model`

**Tests concernés**:
- `should create a use case` - doit vérifier que `model` est présent
- `should get a specific use case` - doit vérifier que `model` est retourné
- `should update a use case` - doit vérifier que `model` peut être mis à jour

#### 2. `api/tests/ai/usecase-generation-async.test.ts`
**Impact**: ⚠️ **Moyen**
- **Raison**: Teste la génération de use cases via la queue, doit vérifier que le modèle est stocké
- **Actions requises**:
  - Vérifier que le `model` passé dans la requête est stocké dans les use cases générés
  - Vérifier que le modèle par défaut est utilisé si non fourni
  - Vérifier que `firstCompleted.model` est défini et correspond au modèle utilisé

**Tests concernés**:
- `should complete full AI workflow` - doit vérifier que `model` est stocké dans les use cases générés

#### 3. `api/tests/ai/usecase-generation-sync.test.ts`
**Impact**: ⚠️ **Faible**
- **Raison**: Teste seulement le démarrage de la génération, pas le résultat final
- **Actions requises**:
  - Aucune action immédiate requise (teste seulement le démarrage)

#### 4. `api/tests/smoke/api-health.test.ts`
**Impact**: ✅ **Aucun**
- **Raison**: Teste seulement l'accessibilité des endpoints, pas le contenu

### Nouveaux tests à ajouter

#### 1. Test du champ `model` dans les use cases
**Fichier**: `api/tests/api/use-cases.test.ts`
```typescript
describe('Model field', () => {
  it('should return model field in GET response', async () => {
    // Créer un use case et vérifier que model est présent
    // Vérifier que model a la valeur par défaut 'gpt-5' si non fourni
  });

  it('should store model when creating use case', async () => {
    // Créer un use case avec model: 'gpt-4.1-nano'
    // Vérifier que model est stocké correctement
  });

  it('should use default model (gpt-5) when not provided', async () => {
    // Créer un use case sans model
    // Vérifier que model = 'gpt-5'
  });

  it('should update model field', async () => {
    // Mettre à jour le model d'un use case
    // Vérifier que model est mis à jour
  });
});
```

#### 2. Test du stockage du modèle dans la queue
**Fichier**: `api/tests/queue/queue.test.ts` (ou nouveau fichier)
```typescript
describe('Model storage in queue', () => {
  it('should store model when generating use case list', async () => {
    // Générer des use cases avec un modèle spécifique
    // Vérifier que le modèle est stocké dans les use cases créés
  });

  it('should store model when detailing use case', async () => {
    // Détailer un use case avec un modèle spécifique
    // Vérifier que le modèle est mis à jour
  });

  it('should use default model when not provided in generation', async () => {
    // Générer sans spécifier de modèle
    // Vérifier que 'gpt-5' est utilisé par défaut
  });
});
```

#### 3. Test de migration de base de données
**Fichier**: `api/tests/smoke/database.test.ts` (ou nouveau fichier)
```typescript
describe('Database migration - model field', () => {
  it('should have model column in use_cases table', async () => {
    // Vérifier que la colonne model existe
    // Vérifier que la valeur par défaut est 'gpt-5'
  });

  it('should allow NULL values for model (backward compatibility)', async () => {
    // Vérifier que model peut être NULL
  });
});
```

## Impact sur les tests UI

### Tests existants à mettre à jour

#### 1. `ui/tests/stores/useCases.test.ts`
**Impact**: ⚠️ **Moyen**
- **Raison**: Le type `UseCase` a été modifié pour inclure le champ `model`
- **Actions requises**:
  - Mettre à jour les mocks pour inclure le champ `model`
  - Vérifier que le store gère correctement le champ `model`

**Tests concernés**:
- `should fetch use cases successfully` - les mocks doivent inclure `model`
- `should update use cases store` - le mock doit inclure `model`

### Nouveaux tests à ajouter

#### 1. Test du parsing des références
**Fichier**: `ui/tests/utils/references.test.ts` (nouveau fichier)
```typescript
describe('Reference parsing', () => {
  it('should parse [1] references in text', () => {
    // Tester parseReferencesInText avec [1], [2]
    // Vérifier que les liens sont créés correctement
  });

  it('should parse [1] references in markdown', () => {
    // Tester parseReferencesInMarkdown
    // Vérifier que les liens sont créés dans le HTML
  });

  it('should handle invalid reference numbers', () => {
    // Tester avec [99] (référence inexistante)
    // Vérifier que le texte original est conservé
  });

  it('should create scroll links with correct IDs', () => {
    // Vérifier que les liens pointent vers #ref-1, #ref-2, etc.
  });
});
```

#### 2. Test du composant References
**Fichier**: `ui/tests/components/References.test.ts` (nouveau fichier)
```typescript
describe('References component', () => {
  it('should display numbered references', () => {
    // Vérifier que les références sont numérotées (1, 2, 3...)
  });

  it('should have correct IDs for scrolling', () => {
    // Vérifier que chaque référence a un id="ref-{index+1}"
  });

  it('should handle double-click on references', () => {
    // Tester le comportement du double-clic
    // Premier clic = focus, deuxième clic = ouverture URL
  });
});
```

#### 3. Test de l'affichage du tag modèle
**Fichier**: `ui/tests/components/UseCaseCard.test.ts` (nouveau fichier)
```typescript
describe('UseCaseCard component', () => {
  it('should display model tag when model is present', () => {
    // Vérifier que le tag modèle est affiché
    // Vérifier la couleur (vert pastel)
  });

  it('should not display model tag when model is missing', () => {
    // Vérifier que le tag n'est pas affiché si model est undefined
  });

  it('should display model tag in detail page', () => {
    // Vérifier que le tag est affiché dans la page de détail
  });
});
```

#### 4. Test de la restructuration des cartes
**Fichier**: `ui/tests/components/UseCaseCard.test.ts`
```typescript
describe('UseCaseCard structure', () => {
  it('should have header and footer sections', () => {
    // Vérifier la structure header/footer
  });

  it('should truncate long titles', () => {
    // Vérifier que les titres longs sont tronqués
  });

  it('should truncate long descriptions', () => {
    // Vérifier que les descriptions sont tronquées (line-clamp-2)
  });

  it('should not display eye and edit icons', () => {
    // Vérifier que les icônes œil et modifier ne sont pas présentes
  });

  it('should display delete icon in header on hover', () => {
    // Vérifier que l'icône poubelle apparaît au hover dans le header
  });
});
```

## Impact sur les tests E2E

### Tests existants à vérifier

#### 1. `e2e/tests/usecase.spec.ts`
**Impact**: ⚠️ **Moyen**
- **Raison**: Teste l'affichage et l'interaction avec les cartes de use cases
- **Actions requises**:
  - Vérifier que les cartes ont la nouvelle structure (header/footer)
  - Vérifier que le tag modèle est affiché
  - Vérifier que les icônes œil/modifier ne sont plus présentes
  - Vérifier que le label "Actif" n'est plus affiché

#### 2. `e2e/tests/usecase-detail.spec.ts`
**Impact**: ⚠️ **Moyen**
- **Raison**: Teste la page de détail des use cases
- **Actions requises**:
  - Vérifier que le tag modèle est affiché
  - Vérifier que les références sont numérotées
  - Vérifier que les liens [1], [2] scrollent vers les références
  - Vérifier le double-clic sur les références

### Nouveaux tests E2E à ajouter

#### 1. Test du parsing des références
**Fichier**: `e2e/tests/usecase-detail.spec.ts`
```typescript
describe('Reference parsing in use case detail', () => {
  it('should parse [1] references in description', async () => {
    // Vérifier que [1] dans la description est un lien cliquable
    // Vérifier que le clic scroll vers la référence
  });

  it('should parse [1] references in all fields', async () => {
    // Vérifier le parsing dans bénéfices, métriques, risques, etc.
  });

  it('should handle double-click on references', async () => {
    // Premier clic = scroll, deuxième clic = ouverture URL
  });
});
```

## Évolutions potentielles des tests

### 1. Tests de régression
- **Test de compatibilité**: Vérifier que les use cases existants (sans `model`) fonctionnent toujours
- **Test de migration**: Vérifier que la migration de base de données s'applique correctement
- **Test de rétrocompatibilité**: Vérifier que l'API accepte toujours les use cases sans `model`

### 2. Tests de performance
- **Test de parsing**: Mesurer le temps de parsing des références pour de grandes descriptions
- **Test de rendu**: Vérifier que le rendu des cartes reste performant avec beaucoup de use cases

### 3. Tests d'accessibilité
- **Test de navigation clavier**: Vérifier que les liens de références sont accessibles au clavier
- **Test de screen reader**: Vérifier que les références sont correctement annoncées

### 4. Tests de validation
- **Test de format de modèle**: Vérifier que seuls les modèles valides sont acceptés (gpt-5, gpt-4.1-nano, etc.)
- **Test de validation des références**: Vérifier que les numéros de références sont valides

### 5. Tests d'intégration
- **Test end-to-end de génération**: Vérifier que le modèle est stocké tout au long du processus de génération
- **Test de synchronisation**: Vérifier que le modèle est synchronisé entre l'API et l'UI

## Priorisation des tests

### Priorité Haute (à faire avant merge)
1. ✅ Mettre à jour `api/tests/api/use-cases.test.ts` pour vérifier le champ `model`
2. ✅ Mettre à jour `api/tests/ai/usecase-generation-async.test.ts` pour vérifier le stockage du modèle
3. ✅ Mettre à jour `ui/tests/stores/useCases.test.ts` pour inclure `model` dans les mocks
4. ✅ Vérifier les tests E2E existants (`usecase.spec.ts`, `usecase-detail.spec.ts`)

### Priorité Moyenne (à faire après merge)
1. Ajouter tests unitaires pour le parsing des références
2. Ajouter tests pour le composant References
3. Ajouter tests pour l'affichage du tag modèle
4. Ajouter tests E2E pour le parsing des références

### Priorité Basse (amélioration future)
1. Tests de performance
2. Tests d'accessibilité
3. Tests de validation avancés

## Estimation de l'effort

- **Tests API à mettre à jour**: ~2-3 heures
- **Nouveaux tests API**: ~3-4 heures
- **Tests UI à mettre à jour**: ~1 heure
- **Nouveaux tests UI**: ~4-5 heures
- **Tests E2E à vérifier/mettre à jour**: ~2-3 heures
- **Nouveaux tests E2E**: ~2-3 heures

**Total estimé**: ~14-19 heures de travail de test

## Recommandations

1. **Avant merge**: Mettre à jour les tests existants critiques (Priorité Haute)
2. **Après merge**: Ajouter les nouveaux tests unitaires et E2E (Priorité Moyenne)
3. **Amélioration continue**: Ajouter les tests de performance et d'accessibilité (Priorité Basse)

