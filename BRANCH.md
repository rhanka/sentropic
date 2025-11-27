# Feature: Séparation de la description en description/problème/solution

## Objective

Séparer le champ `description` des cas d'usage en trois champs distincts pour une meilleure structuration :
1. **description** : Description courte et concise du cas d'usage (colonne native)
2. **problème** : Le problème métier adressé (stocké dans `data.problem` JSONB)
3. **solution** : La solution proposée (stocké dans `data.solution` JSONB)

Refactorisation du schéma pour une approche minimaliste : garder uniquement les champs de gestion d'état et les champs fréquemment accédés (`name`, `description`) en colonnes natives, et migrer toutes les données métier vers un champ `data` JSONB.

## Scope

- **API** : Schéma DB, migrations, types TypeScript, services de génération, prompts
- **UI** : Types, composants d'affichage et d'édition
- **CI** : Aucun changement prévu (sauf si tests nécessitent des ajustements)

## Limites de travail (éviter les effets de bord)

- ✅ **Ne pas modifier** : Makefile, CI workflows (sauf ajustements tests si nécessaire)
- ✅ **Minimal changes** : Se concentrer uniquement sur la refactorisation du schéma `use_cases`
- ✅ **Rétrocompatibilité** : Maintenir la compatibilité avec les données existantes pendant la migration
- ✅ **Tests** : Mettre à jour uniquement les tests affectés par le changement de schéma
- ✅ **Pas de refactoring** : Ne pas refactoriser d'autres parties du code non liées à cette feature

## Contexte

Actuellement, le champ `description` des cas d'usage contient une description complète qui mélange plusieurs aspects. De plus, le schéma actuel a de nombreuses colonnes métier qui pourraient être consolidées dans un champ JSONB pour plus de flexibilité.

## Schéma de la table `use_cases`

### As-is (État actuel)

**Fichier**: `api/src/db/schema.ts`

```typescript
export const useCases = pgTable('use_cases', {
  id: text('id').primaryKey(),
  folderId: text('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => companies.id),
  name: text('name').notNull(),
  description: text('description'),  // ⚠️ Description complète qui mélange tout
  process: text('process'),
  domain: text('domain'),
  technologies: text('technologies'),
  prerequisites: text('prerequisites'),
  deadline: text('deadline'),
  contact: text('contact'),
  benefits: text('benefits'),
  metrics: text('metrics'),
  risks: text('risks'),
  nextSteps: text('next_steps'),
  dataSources: text('data_sources'),
  dataObjects: text('data_objects'),
  references: text('references'),
  valueScores: text('value_scores'),
  complexityScores: text('complexity_scores'),
  totalValueScore: integer('total_value_score'),
  totalComplexityScore: integer('total_complexity_score'),
  model: text('model'),
  status: text('status').default('completed'),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow()
});
```

**Structure SQL actuelle**:
```sql
CREATE TABLE "use_cases" (
  "id" text PRIMARY KEY NOT NULL,
  "folder_id" text NOT NULL,
  "company_id" text,
  "name" text NOT NULL,
  "description" text,  -- ⚠️ Champ unique contenant description + problème + solution
  "process" text,
  "domain" text,
  "technologies" text,
  "prerequisites" text,
  "deadline" text,
  "contact" text,
  "benefits" text,
  "metrics" text,
  "risks" text,
  "next_steps" text,
  "data_sources" text,
  "data_objects" text,
  "references" text,
  "value_scores" text,
  "complexity_scores" text,
  "total_value_score" integer,
  "total_complexity_score" integer,
  "model" text,
  "status" text DEFAULT 'completed',
  "created_at" timestamp DEFAULT now()
);
```

**Problème actuel**:
- Le champ `description` contient une description complète qui mélange :
  - Une description générale du cas d'usage
  - Le problème métier adressé
  - La solution proposée
- Pas de séparation structurée entre ces trois aspects
- Difficile d'extraire ou d'afficher séparément le problème et la solution

### To-be (État cible)

**Fichier**: `api/src/db/schema.ts`

```typescript
export const useCases = pgTable('use_cases', {
  // === GESTION D'ÉTAT ===
  id: text('id').primaryKey(),
  folderId: text('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => companies.id),
  status: text('status').default('completed'), // 'draft', 'generating', 'detailing', 'completed'
  model: text('model'), // Modèle utilisé pour la génération
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  
  // === CHAMPS FRÉQUEMMENT ACCÉDÉS EN MASSE (performance) ===
  name: text('name').notNull(), // ✅ Colonne native pour requêtes rapides
  description: text('description'), // ✅ Colonne native pour requêtes rapides (description courte)
  
  // === DONNÉES MÉTIER (tout dans JSONB pour flexibilité) ===
  data: jsonb('data').notNull().default('{}')
});
```

**Structure SQL cible**:
```sql
CREATE TABLE "use_cases" (
  -- Gestion d'état
  "id" text PRIMARY KEY NOT NULL,
  "folder_id" text NOT NULL,
  "company_id" text,
  "status" text DEFAULT 'completed',
  "model" text,
  "created_at" timestamp DEFAULT now(),
  
  -- Champs fréquemment accédés en masse (colonnes natives pour performance)
  "name" text NOT NULL,
  "description" text,
  
  -- Données métier (tout dans JSONB)
  "data" jsonb NOT NULL DEFAULT '{}'
);
```

**Structure du champ `data` JSONB**:
```typescript
type UseCaseData = {
  // === Nouveaux champs ===
  problem?: string;
  solution?: string;
  
  // === Détails métier ===
  process?: string;
  domain?: string;
  technologies?: string[];
  prerequisites?: string;
  deadline?: string;
  contact?: string;
  
  // === Listes ===
  benefits?: string[];
  metrics?: string[];
  risks?: string[];
  nextSteps?: string[];
  dataSources?: string[];
  dataObjects?: string[];
  
  // === Références ===
  references?: Array<{
    title: string;
    url: string;
  }>;
  
  // === Scores détaillés (pour recalcul dynamique) ===
  valueScores?: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
  complexityScores?: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
  
  // === Extensions futures ===
  embeddings?: {
    problem?: number[];
    solution?: number[];
  };
  metadata?: Record<string, any>;
};
```

**Migration SQL**:
```sql
-- 1. Ajouter le champ data JSONB
ALTER TABLE "use_cases" ADD COLUMN "data" jsonb NOT NULL DEFAULT '{}';

-- 2. Migrer les données existantes vers data
UPDATE "use_cases" 
SET "data" = jsonb_build_object(
  'process', "process",
  'domain', "domain",
  'technologies', COALESCE("technologies"::jsonb, '[]'::jsonb),
  'prerequisites', "prerequisites",
  'deadline', "deadline",
  'contact', "contact",
  'benefits', COALESCE("benefits"::jsonb, '[]'::jsonb),
  'metrics', COALESCE("metrics"::jsonb, '[]'::jsonb),
  'risks', COALESCE("risks"::jsonb, '[]'::jsonb),
  'nextSteps', COALESCE("next_steps"::jsonb, '[]'::jsonb),
  'dataSources', COALESCE("data_sources"::jsonb, '[]'::jsonb),
  'dataObjects', COALESCE("data_objects"::jsonb, '[]'::jsonb),
  'references', COALESCE("references"::jsonb, '[]'::jsonb),
  'valueScores', COALESCE("value_scores"::jsonb, '[]'::jsonb),
  'complexityScores', COALESCE("complexity_scores"::jsonb, '[]'::jsonb)
)
WHERE "data" = '{}';

-- 3. Supprimer les colonnes migrées (après vérification)
-- ALTER TABLE "use_cases" DROP COLUMN "process";
-- ALTER TABLE "use_cases" DROP COLUMN "domain";
-- ... (toutes les colonnes métier sauf name, description, et gestion d'état)
-- ALTER TABLE "use_cases" DROP COLUMN "total_value_score";  -- ✅ Supprimé (champ calculé)
-- ALTER TABLE "use_cases" DROP COLUMN "total_complexity_score";  -- ✅ Supprimé (champ calculé)
```

**Indexation recommandée**:
```sql
-- Index sur name et description (colonnes natives)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_use_cases_name_trgm 
  ON use_cases USING GIN (name gin_trgm_ops);

CREATE INDEX idx_use_cases_description_trgm 
  ON use_cases USING GIN (description gin_trgm_ops);

-- Index composite pour requêtes fréquentes
CREATE INDEX idx_use_cases_folder_name 
  ON use_cases (folder_id, name);

-- Index JSONB pour problem/solution
CREATE INDEX idx_use_cases_data_gin 
  ON use_cases USING GIN (data);

CREATE INDEX idx_use_cases_data_problem_trgm 
  ON use_cases USING GIN ((data->>'problem') gin_trgm_ops);

CREATE INDEX idx_use_cases_data_solution_trgm 
  ON use_cases USING GIN ((data->>'solution') gin_trgm_ops);

-- Index pour tri/filtrage sur statut
CREATE INDEX idx_use_cases_folder_status 
  ON use_cases (folder_id, status);
```

**Avantages de la nouvelle structure**:
- ✅ **Performance** : `name` et `description` en colonnes natives pour requêtes en masse rapides
- ✅ **Flexibilité** : Toutes les données métier dans `data` JSONB (ajout de champs sans migration)
- ✅ **Séparation claire** : description courte, problème et solution distincts
- ✅ **Pas de redondance** : Suppression des champs calculés (`totalValueScore`, `totalComplexityScore`)
- ✅ **Recalcul dynamique** : Les scores totaux sont recalculés à partir de `data.valueScores` et `data.complexityScores` + matrice du dossier
- ✅ **Indexation efficace** : Index GIN + pg_trgm pour recherches textuelles dans JSONB
- ✅ **Rétrocompatibilité** : Migration progressive possible

**Exemple de données**:

**Avant**:
```json
{
  "id": "uc_123",
  "name": "Détection de défauts par vision",
  "description": "Ce cas d'usage utilise l'IA pour détecter automatiquement les défauts de production. Le problème actuel est que la détection manuelle est lente et sujette à erreurs. La solution proposée utilise la computer vision pour analyser les images en temps réel et identifier les anomalies avec une précision de 99%."
}
```

**Après**:
```json
{
  "id": "uc_123",
  "folder_id": "folder_456",
  "company_id": "company_789",
  "status": "completed",
  "model": "gpt-4.1-nano",
  "name": "Détection de défauts par vision",
  "description": "Détection automatique des défauts de production par vision artificielle en temps réel.",
  "created_at": "2024-01-15T10:30:00Z",
  "data": {
    "problem": "La détection manuelle des défauts est lente, coûteuse et sujette à erreurs humaines. Les opérateurs peuvent manquer des défauts subtils ou être incohérents dans leur évaluation.",
    "solution": "Utilisation de la computer vision avec des modèles d'IA entraînés pour analyser les images de production en temps réel. Le système identifie automatiquement les anomalies avec une précision de 99% et alerte immédiatement les opérateurs.",
    "process": "Production",
    "domain": "Qualité",
    "technologies": ["Computer Vision", "Deep Learning", "TensorFlow"],
    "prerequisites": "Caméras haute résolution, infrastructure cloud",
    "deadline": "6 mois",
    "contact": "Responsable qualité",
    "benefits": ["Réduction des erreurs", "Gain de temps", "Amélioration de la qualité"],
    "metrics": ["Taux de détection", "Temps de traitement", "Précision"],
    "risks": ["Coût initial", "Formation des équipes"],
    "nextSteps": ["POC", "Déploiement pilote", "Formation"],
    "dataSources": ["Images de production", "Base de données qualité"],
    "dataObjects": ["Image", "Défaut détecté", "Rapport qualité"],
    "references": [
      { "title": "Computer Vision in Manufacturing", "url": "https://example.com" }
    ],
    "valueScores": [
      { "axisId": "business_value", "rating": 89, "description": "Impact business élevé" }
    ],
    "complexityScores": [
      { "axisId": "technical_complexity", "rating": 55, "description": "Complexité technique moyenne" }
    ]
  }
}
```

**Note importante** : Les `totalValueScore` et `totalComplexityScore` ne sont plus stockés. Ils sont recalculés dynamiquement à partir de :
- `data.valueScores` et `data.complexityScores`
- La matrice de notation du dossier (`folder.matrixConfig`)

## Plan d'implémentation

### 1. Schéma de base de données

**Fichier**: `api/src/db/schema.ts`

- [x] Refactoriser le schéma pour adopter l'approche minimaliste :
  - [x] Garder uniquement les champs de gestion d'état : `id`, `folderId`, `companyId`, `status`, `model`, `createdAt`
  - [x] Garder `name` et `description` en colonnes natives (performance)
  - [x] Ajouter un champ `data` JSONB pour toutes les données métier
  - [x] **Supprimer** `totalValueScore` et `totalComplexityScore` (champs calculés)
  - [x] Colonnes métier temporaires conservées (seront supprimées après migration des données)
- [x] Générer la migration avec `make db-generate` → 0007_handy_morlocks.sql
- [x] Vérifier la migration générée (ajout `data`, suppression colonnes calculées)
- [x] Créer un script de migration des données existantes vers `data` (`migrate-usecases-to-data.ts`)
- [x] Appliquer la migration avec `make db-migrate`
- [x] Créer les modules centralisés pour migrations et indexation (`db/run-migrations.ts`, `db/ensure-indexes.ts`)
- [x] Intégrer l'indexation au démarrage de l'API (`index.ts`)
- [x] Créer les index recommandés (GIN, pg_trgm) via `db/ensure-indexes.ts` (idempotent, exécuté au démarrage)

**Migration attendue**:
```sql
-- Ajout du champ data JSONB
ALTER TABLE "use_cases" ADD COLUMN "data" jsonb NOT NULL DEFAULT '{}';

-- Migration des données existantes (voir section détaillée ci-dessus)
-- ...

-- Suppression des colonnes migrées (après vérification)
-- ALTER TABLE "use_cases" DROP COLUMN "total_value_score";
-- ALTER TABLE "use_cases" DROP COLUMN "total_complexity_score";
-- ... (autres colonnes métier)
```

### 2. Types TypeScript (API)

**Fichiers**:
- `api/src/services/context-usecase.ts`
- `api/src/routes/api/use-cases.ts`
- `api/src/utils/scoring.ts`

- [ ] Créer le type `UseCaseData` pour structurer le champ `data`
- [ ] Mettre à jour l'interface `UseCaseDetail` pour inclure :
  - `description: string` (description courte)
  - `problem?: string` (problème métier dans `data`)
  - `solution?: string` (solution proposée dans `data`)
- [ ] Mettre à jour le schéma Zod `useCaseInput` pour accepter `problem` et `solution`
- [ ] Mettre à jour la fonction `hydrateUseCase` pour :
  - Extraire les données de `data` JSONB
  - Ne plus retourner `totalValueScore` et `totalComplexityScore` (calculés dynamiquement)
- [ ] Mettre à jour les endpoints POST/PUT pour sérialiser/désérialiser `data`
- [ ] Créer une fonction utilitaire pour calculer les scores totaux à la demande :
  ```typescript
  const calculateUseCaseScores = (useCase: UseCase, matrix: MatrixConfig) => {
    const valueScores = useCase.data.valueScores || [];
    const complexityScores = useCase.data.complexityScores || [];
    return calculateScores(matrix, valueScores, complexityScores);
  };
  ```
- [ ] Mettre à jour tous les endroits qui utilisent `totalValueScore`/`totalComplexityScore` pour utiliser le calcul dynamique

### 3. Prompts de génération

**Fichier**: `api/src/config/default-prompts.ts`

- [ ] Modifier le prompt `use_case_list` pour générer :
  - `description`: Description très courte (30-60 caractères)
  - `problem`: Le problème métier adressé (40-80 caractères)
  - `solution`: La solution proposée (40-80 caractères)
- [ ] Modifier le prompt `use_case_detail` pour générer :
  - `description`: Description très courte (30-60 caractères) - **même longueur que pour la liste**
  - `problem`: Le problème métier adressé (40-80 caractères)
  - `solution`: La solution proposée (40-80 caractères)
- [ ] Mettre à jour les exemples JSON dans les prompts pour refléter la nouvelle structure

### 4. Services de génération

**Fichier**: `api/src/services/queue-manager.ts`

- [ ] Mettre à jour `processUseCaseList` pour :
  - Extraire et stocker `problem` et `solution` dans `data`
  - Stocker toutes les données métier dans `data` (pas dans des colonnes séparées)
  - Ne plus stocker `totalValueScore` et `totalComplexityScore`
- [ ] Mettre à jour `processUseCaseDetail` pour :
  - Extraire et stocker `problem` et `solution` dans `data`
  - Stocker toutes les données métier dans `data`
  - Ne plus stocker `totalValueScore` et `totalComplexityScore`
- [ ] S'assurer que les longueurs respectent les contraintes :
  - `description`: 30-60 caractères (très courte)
  - `problem`: 40-80 caractères
  - `solution`: 40-80 caractères

### 5. Interface utilisateur (UI)

**Fichiers**:
- `ui/src/lib/stores/useCases.ts`
- `ui/src/lib/components/UseCaseDetail.svelte`

- [ ] Mettre à jour le type `UseCase` pour inclure :
  - `data?: { problem?: string, solution?: string }`
- [ ] Ajouter `problem` et `solution` dans les champs éditables de `UseCaseDetail.svelte`
- [ ] Adapter l'affichage pour montrer les trois sections distinctement :
  - Description (courte)
  - Problème
  - Solution
- [ ] Mettre à jour la logique de sauvegarde pour gérer `data.problem` et `data.solution`

### 6. Migration des données existantes

- [ ] Créer un script de migration SQL pour :
  - Migrer toutes les colonnes métier vers `data` JSONB
  - Conserver `name` et `description` en colonnes natives
  - Analyser les descriptions existantes et tenter d'extraire problème/solution si possible (ou laisser vide)
  - Conserver la description actuelle comme description courte (tronquée si nécessaire)
  - Supprimer les colonnes migrées après vérification
- [ ] Tester la migration sur une copie de la base de données
- [ ] Vérifier l'intégrité des données après migration

### 7. Tests

- [ ] Mettre à jour les tests unitaires pour :
  - La nouvelle structure avec `data` JSONB
  - Le calcul dynamique des scores totaux
  - La migration des données
- [ ] Mettre à jour les tests d'intégration pour :
  - Vérifier la génération des trois champs (description, problem, solution)
  - Vérifier le calcul dynamique des scores
  - Vérifier les requêtes en masse sur `name` et `description`
- [ ] Mettre à jour les tests E2E si nécessaire
- [ ] Vérifier que les anciennes données sont toujours accessibles après migration
- [ ] Tester les performances des requêtes en masse avec colonnes natives vs JSONB

### 8. Documentation

- [ ] Mettre à jour la documentation de l'API si nécessaire
- [ ] Documenter la nouvelle structure dans les spécifications

## Structure de données attendue

### Avant
```typescript
{
  id: "uc_123",
  name: "Cas d'usage",
  description: "Description complète qui mélange tout...",
  process: "...",
  technologies: "...",
  totalValueScore: 89,
  totalComplexityScore: 55,
  // ... beaucoup de colonnes
}
```

### Après
```typescript
{
  // Gestion d'état (colonnes natives)
  id: "uc_123",
  folderId: "folder_456",
  companyId: "company_789",
  status: "completed",
  model: "gpt-4.1-nano",
  createdAt: "2024-01-15T10:30:00Z",
  
  // Champs fréquemment accédés (colonnes natives pour performance)
  name: "Cas d'usage",
  description: "Description courte du cas d'usage",
  
  // Toutes les données métier (JSONB pour flexibilité)
  data: {
    problem: "Le problème métier adressé...",
    solution: "La solution proposée...",
    process: "...",
    technologies: ["..."],
    valueScores: [...],  // Pour recalcul dynamique
    complexityScores: [...],  // Pour recalcul dynamique
    // ... tout le reste
  }
  
  // Note: totalValueScore et totalComplexityScore sont calculés dynamiquement
}
```

## Points d'attention

1. **Rétrocompatibilité** : Les cas d'usage existants doivent continuer à fonctionner même sans `data.problem` et `data.solution`
2. **Validation** : S'assurer que les champs optionnels sont bien gérés partout
3. **Affichage** : L'UI doit gérer gracieusement l'absence de `problem` ou `solution`
4. **Prompts** : Les prompts doivent être clairs sur la séparation des trois éléments
5. **Performance** : `name` et `description` restent en colonnes natives pour les requêtes en masse rapides
6. **Scores calculés** : Les `totalValueScore` et `totalComplexityScore` doivent être recalculés dynamiquement à partir de `data.valueScores`, `data.complexityScores` et la matrice du dossier
7. **Migration** : Migration progressive recommandée (ajout de `data`, migration des données, puis suppression des colonnes)
8. **Indexation** : Créer les index recommandés (GIN, pg_trgm) pour optimiser les recherches dans JSONB
9. **Longueurs des champs** :
   - `description`: 30-60 caractères (très courte, même pour liste et détail)
   - `problem`: 40-80 caractères
   - `solution`: 40-80 caractères

## Questions à clarifier avant implémentation

1. **Validation des longueurs** : Faut-il valider les longueurs côté API (Zod schema) pour s'assurer que description = 30-60, problem = 40-80, solution = 40-80 ?

2. **Affichage dans les listes** : Dans la page `/cas-usage`, les cartes affichent actuellement `name`. Faut-il aussi afficher la `description` courte ? Faut-il afficher `problem`/`solution` au hover ?

3. **Affichage dans le dashboard** : Le scatter plot affiche la description au hover. Faut-il afficher aussi `problem`/`solution` ? Ou garder uniquement la description courte ?

4. **Export/rapport** : Dans le rapport généré (dashboard), comment afficher ces 3 champs ? Faut-il les 3 sections distinctes dans `UseCaseDetail` pour l'impression ?

5. **Migration des données existantes** : 
   - Comment gérer les descriptions longues existantes ? Les tronquer à 60 caractères ?
   - Comment extraire `problem` et `solution` des descriptions existantes ? Via IA ou laisser vide ?

6. **Recherche** : Faut-il permettre de rechercher dans `problem` et `solution` ? Les index pg_trgm sont prévus, mais faut-il une interface de recherche ?

7. **UI/UX** : Comment présenter ces 3 champs dans `UseCaseDetail` ? 
   - 3 sections distinctes avec titres ?
   - Tooltips ou expand/collapse ?
   - Ordre d'affichage : description → problem → solution ?

## Plan / Todo

### Phase 1 : Schéma DB + Migration

**Ce que je fais (AI)** :
- [x] Refactoriser le schéma (supprimer colonnes métier, ajouter `data` JSONB)
- [x] Créer la migration SQL avec Drizzle (0007_handy_morlocks.sql)
- [x] Créer le script de migration des données existantes (`migrate-usecases-to-data.ts`)
- [x] Appliquer la migration (`make db-migrate`)
- [x] Créer les modules centralisés (`db/run-migrations.ts`, `db/ensure-indexes.ts`)
- [x] Intégrer l'indexation au démarrage de l'API (`index.ts`)
- [x] Refactoriser les scripts pour utiliser les modules centralisés

**Vérifications automatiques (AI exécute)** :
- [x] `make db-generate` - Migration générée (0007_handy_morlocks.sql)
- [x] `make db-migrate` - Migration appliquée avec succès
- [x] `make db-status` - Structure de la table vérifiée
- [x] `make db-migrate-data` - Script de migration testé (base vide, fonctionne)
- [x] `make build-api` - Build API vérifié (passe)
- [x] `make db-create-indexes` - Script d'indexation testé (via module centralisé)

**Vérifications manuelles (TU vérifies)** :
- [ ] Vérifier via `make db-inspect` que le schéma est correct (colonnes `name`, `description`, `data` présentes)
- [ ] Vérifier que les colonnes supprimées ne sont plus dans le schéma
- [ ] Vérifier que les données existantes sont toujours accessibles
- [ ] Vérifier que le champ `data` est bien de type JSONB et contient les données migrées
- [ ] Vérifier que les index sont créés (`make db-status` ou `make db-inspect`)

### Phase 2 : Types TypeScript (API)

**Ce que je fais (AI)** :
- [ ] Créer le type `UseCaseData` pour structurer le champ `data`
- [ ] Mettre à jour l'interface `UseCaseDetail`
- [ ] Créer la fonction de calcul dynamique des scores
- [ ] Mettre à jour `hydrateUseCase` pour extraire les données de `data`
- [ ] Mettre à jour les endpoints POST/PUT pour sérialiser/désérialiser `data`
- [ ] Mettre à jour tous les endroits utilisant `totalValueScore`/`totalComplexityScore`

**Vérifications automatiques (AI exécute)** :
- `make build-api` - Vérifier que le build passe
- `make test-api SCOPE=tests/api/use-cases.test.ts` - Tester les endpoints use-cases
- `make dev` puis `make logs-api TAIL=50` - Vérifier que l'API démarre correctement et qu'il n'y a pas d'erreurs dans les logs
- `make logs-ui TAIL=50` - Vérifier que l'UI démarre correctement et qu'il n'y a pas d'erreurs dans les logs

**Vérifications manuelles (TU vérifies)** :
- [ ] Vérifier dans le code que le type `UseCaseData` est bien défini et complet
- [ ] Vérifier que `hydrateUseCase` extrait bien les données de `data` JSONB
- [ ] Vérifier que les scores totaux ne sont plus retournés directement mais calculés dynamiquement
- [ ] Tester les endpoints API via curl ou Postman :
  - GET `/use-cases/:id` - Vérifier que `data.problem` et `data.solution` sont présents
  - PUT `/use-cases/:id` - Vérifier que la sérialisation/désérialisation fonctionne
  - Vérifier que les anciens endpoints fonctionnent toujours (rétrocompatibilité)

### Phase 3 : Prompts de génération

**Ce que je fais (AI)** :
- [ ] Modifier le prompt `use_case_list` pour générer `description`, `problem`, `solution`
- [ ] Modifier le prompt `use_case_detail` pour générer `description`, `problem`, `solution`
- [ ] Mettre à jour les exemples JSON dans les prompts

**Vérifications automatiques (AI exécute)** :
- `make build-api` - Vérifier que le build passe
- `make test-api-ai SCOPE=tests/ai/*-sync.test.ts` - Tester la génération AI
- `make dev` puis `make logs-api TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs API
- `make logs-ui TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs UI

**Vérifications manuelles (TU vérifies - IMPORTANT)** :
- [ ] **Vérifier le contenu des prompts** dans `api/src/config/default-prompts.ts` :
  - Le prompt `use_case_list` demande bien `description`, `problem`, `solution` séparément
  - Le prompt `use_case_detail` demande bien `description`, `problem`, `solution` séparément
  - Les exemples JSON dans les prompts reflètent la nouvelle structure
  - Les instructions sont claires sur la séparation des trois champs
  - **Les longueurs sont spécifiées** : description (30-60 caractères), problem (40-80), solution (40-80)
- [ ] Générer un cas d'usage via l'UI et vérifier :
  - Que les trois champs (description, problem, solution) sont bien générés
  - Que `description` respecte 30-60 caractères
  - Que `problem` respecte 40-80 caractères
  - Que `solution` respecte 40-80 caractères
  - Que les données sont stockées correctement dans `data` JSONB
- [ ] Vérifier via `make db-inspect-usecases` que les nouveaux cas d'usage ont bien `data.problem` et `data.solution`

### Phase 4 : Services de génération

**Ce que je fais (AI)** :
- [ ] Mettre à jour `processUseCaseList` pour stocker dans `data` JSONB
- [ ] Mettre à jour `processUseCaseDetail` pour stocker dans `data` JSONB
- [ ] Supprimer le stockage des scores totaux

**Vérifications automatiques (AI exécute)** :
- `make build-api` - Vérifier le build
- `make test-api-queue SCOPE=tests/queue/*.test.ts` - Tester le traitement de la queue
- `make test-api-ai` - Tester la génération complète
- `make dev` puis `make logs-api TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs lors de la génération
- `make logs-ui TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs UI

**Vérifications manuelles (TU vérifies)** :
- [ ] Vérifier dans le code que `processUseCaseList` stocke bien dans `data` JSONB (pas dans des colonnes séparées)
- [ ] Vérifier dans le code que `processUseCaseDetail` stocke bien dans `data` JSONB
- [ ] Vérifier dans le code que les scores totaux ne sont plus stockés (pas de `totalValueScore`/`totalComplexityScore` dans les insert/update)
- [ ] Générer une liste de cas d'usage via l'UI et vérifier :
  - Que `data.problem` et `data.solution` sont bien remplis dans la DB
  - Que toutes les données métier sont dans `data` JSONB
  - Que `name` et `description` sont bien en colonnes natives
- [ ] Vérifier via `make db-inspect-usecases` que les données sont bien structurées dans `data` JSONB
- [ ] Vérifier que les scores totaux sont calculés dynamiquement (pas stockés en DB) :
  - Regarder dans la DB qu'il n'y a pas de `total_value_score`/`total_complexity_score`
  - Vérifier que les scores sont calculés à la volée dans l'API

### Phase 5 : Interface utilisateur

**Ce que je fais (AI)** :
- [ ] Mettre à jour le type `UseCase` pour inclure `data`
- [ ] Ajouter `problem` et `solution` dans les champs éditables
- [ ] Adapter l'affichage pour montrer les trois sections distinctement
- [ ] Mettre à jour la logique de sauvegarde

**Vérifications automatiques (AI exécute)** :
- `make build-ui` - Vérifier que le build UI passe
- `make test-ui` - Exécuter les tests unitaires UI
- `make dev` puis `make logs-ui TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs UI
- `make logs-api TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs API

**Vérifications manuelles (TU vérifies - UAT partiel)** :
- [ ] Vérifier dans le code que le type `UseCase` inclut bien `data?: { problem?: string, solution?: string }`
- [ ] Vérifier dans le code que la logique de sauvegarde gère bien `data.problem` et `data.solution`
- [ ] Ouvrir l'UI en mode dev (`make dev`)
- [ ] Naviguer vers un cas d'usage existant et vérifier :
  - Que les trois sections (Description, Problème, Solution) s'affichent distinctement
  - Que chaque section a son propre titre/header
  - Que les sections sont visuellement séparées
- [ ] Tester l'édition de chaque champ :
  - Éditer la description et sauvegarder
  - Éditer le problème et sauvegarder
  - Éditer la solution et sauvegarder
- [ ] Vérifier que les modifications sont persistées :
  - Recharger la page et vérifier que les modifications sont toujours là
  - Vérifier via `make db-inspect-usecases` que les données sont bien enregistrées dans `data` JSONB
- [ ] Tester avec un cas d'usage sans `problem` ou `solution` (rétrocompatibilité) :
  - Vérifier que l'UI gère gracieusement l'absence de ces champs
  - Vérifier qu'on peut les ajouter via l'édition

### Phase 6 : Migration des données
- [ ] Exécuter le script de migration sur une copie de la DB
- [ ] Vérifier l'intégrité des données
- [ ] Supprimer les anciennes colonnes (après vérification)

**Vérification** :
- `make db-backup` - Faire un backup avant migration
- Exécuter le script de migration
- `make db-status` - Vérifier la structure après migration
- `make db-inspect-usecases` - Vérifier que toutes les données sont migrées
- `make db-inspect` - Vérifier manuellement quelques cas d'usage
- `make dev` puis `make logs-api TAIL=50` - Vérifier qu'il n'y a pas d'erreurs après migration
- `make logs-ui TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs UI

**Test manuel** :
- Vérifier que tous les cas d'usage existants sont toujours accessibles
- Vérifier que les données métier sont bien dans `data` JSONB
- Vérifier que `name` et `description` sont toujours en colonnes natives
- Tester l'affichage et l'édition de cas d'usage existants dans l'UI

### Phase 7 : Tests (selon testing.mdc)
- [ ] Mettre à jour les tests unitaires
- [ ] Mettre à jour les tests d'intégration
- [ ] Mettre à jour les tests E2E si nécessaire
- [ ] Exécuter `make test-api` et `make test-ui`
- [ ] Valider les performances des requêtes

**Vérification** :
- `make test-api-unit` - Tests unitaires API
- `make test-api` - Tous les tests API (unit + intégration)
- `make test-ui` - Tests unitaires UI
- `make test-api-smoke` - Tests smoke API
- `make test-api-endpoints` - Tests endpoints CRUD
- `make build-ui-image build-api` puis `make test-e2e` - Tests E2E complets

**Test manuel** :
- Vérifier que tous les tests passent
- Vérifier les performances avec des requêtes en masse sur `name` et `description`

### Phase 8 : GitHub CI execution check
- [ ] Push vers GitHub
- [ ] Vérifier que GitHub Actions passe
- [ ] Corriger les éventuels problèmes CI
- [ ] Valider que tous les tests passent en CI

**Vérification** :
- `make build` - Build complet avant push
- `make test-api test-ui` - Tous les tests avant push
- `make build-ui-image build-api` puis `make test-e2e` - Tests E2E avant push
- Push vers GitHub et vérifier les GitHub Actions

**UAT Final (User Acceptance Testing)** :
- ✅ **Génération** : Générer une nouvelle liste de cas d'usage et vérifier que `description`, `problem`, `solution` sont bien générés
- ✅ **Affichage** : Vérifier que les trois sections s'affichent correctement dans l'UI
- ✅ **Édition** : Tester l'édition de chaque champ (description, problem, solution) et la sauvegarde
- ✅ **Données existantes** : Vérifier que les cas d'usage existants fonctionnent toujours
- ✅ **Performance** : Vérifier que les requêtes en masse sur `name` et `description` sont rapides
- ✅ **Scores** : Vérifier que les scores totaux sont calculés dynamiquement et correctement
- ✅ **Recherche** : Tester la recherche dans `problem` et `solution` (si implémentée)
- ✅ **Migration** : Vérifier que les données migrées sont correctes et accessibles

## Commits & Progress

- [x] **Commit 1** : Refactorisation du schéma DB + migration + indexation
  - [x] Schéma modifié : ajout de `data` JSONB, suppression de `totalValueScore` et `totalComplexityScore`
  - [x] Migration Drizzle générée (0007_handy_morlocks.sql) - ajout colonne `data`, suppression colonnes calculées
  - [x] Migration appliquée avec `make db-migrate`
  - [x] Script de migration des données créé (`migrate-usecases-to-data.ts`)
  - [x] Commande `make db-migrate-data` ajoutée
  - [x] Module `api/src/db/run-migrations.ts` créé (logique centralisée)
  - [x] Module `api/src/db/ensure-indexes.ts` créé (logique centralisée, idempotente)
  - [x] Indexation intégrée au démarrage de l'API (`index.ts`)
  - [x] Script `db-create-indexes.ts` refactorisé pour utiliser `db/ensure-indexes.ts`
  - [x] Script `db-migrate.ts` refactorisé pour utiliser `db/run-migrations.ts`
  - [x] Build API vérifié (`make build-api` passe)
- [ ] **Commit 2** : Types TypeScript et calcul dynamique des scores
- [ ] **Commit 3** : Mise à jour des prompts de génération
- [ ] **Commit 4** : Mise à jour des services de génération
- [ ] **Commit 5** : Mise à jour de l'interface utilisateur
- [ ] **Commit 6** : Migration des données existantes (quand données réelles disponibles)
- [ ] **Commit 7** : Mise à jour des tests
- [ ] **Commit 8** : Validation CI

## Status

- **Progress**: Phase 1 terminée ✅
- **Current**: Phase 1 complétée - Schéma DB + Migration + Indexation
- **Next**: Phase 2 - Types TypeScript et calcul dynamique des scores

## Make Commands for Development & Testing

**⚠️ MANDATORY**: All development and testing MUST go through `make` commands (Docker-first architecture). Never run npm/python commands directly.

### Development Environment

```bash
# Start full stack in development mode (watch mode)
make dev

# Start only UI or API
make dev-ui
make dev-api

# Start full stack in detached mode
make up

# Start only API (for testing)
make up-api
make up-api-test  # With DISABLE_RATE_LIMIT=true

# Stop all services
make down

# View logs
# ⚠️ NEVER use head/grep/tail directly - always use make commands
make logs              # All services
make logs-api         # API only
make logs-ui          # UI only
make logs-db          # Database only
TAIL=100 make logs-api # Last 100 lines (use TAIL variable, not tail command)

# Access container shell
make sh-api           # API container shell
make sh-ui            # UI container shell
```

### Database Management

```bash
# Generate migration from schema.ts changes
make db-generate

# Apply pending migrations
make db-migrate

# Check database status
make db-status

# Reset database (⚠️ DESTRUCTIVE - destroys all data)
make db-reset [SKIP_CONFIRM=true]

# Backup database
make db-backup

# Restore database (⚠️ approval required)
make db-restore BACKUP_FILE=filename.dump [SKIP_CONFIRM=true]

# Seed database with sample data
make db-seed

# Inspect database
make db-inspect           # Direct postgres access
make db-inspect-usecases  # Use cases and folders
make db-inspect-folders   # Folders with use cases count
make db-inspect-users     # Users and roles
```

### Build & Quality

```bash
# Build all (UI + API)
make build

# Build individually
make build-ui
make build-api
make build-ui-image      # Docker image for production
make build-api-image      # Docker image for production

# Code quality
make typecheck           # TypeScript type checking (UI + API)
make lint                # Linting (UI + API)
make format              # Format code (UI + API)
make format-check        # Check formatting without modifying
```

### Testing (MANDATORY before commit)

**⚠️ Always run tests before commit - no exceptions** (see `workflow.mdc` and `testing.mdc`)

#### Main Test Commands

```bash
# On TARGET=development (default):
make test-ui [SCOPE=tests/test.ts]    # UI unit tests (Vitest)
make test-api [SCOPE=tests/test.ts]   # API unit + integration tests (Vitest)

# On TARGET=production (⚠️ MANDATORY: build images first to ensure prod images are up-to-date):
make build-ui-image build-api            # Build production images FIRST
make test-e2e [E2E_test=tests/test.ts]   # E2E tests (Playwright) - uses production images
make test-smoke                          # Quick E2E subset - uses production images
```

#### API Test Commands (with filters)

```bash
make test-api-smoke [SCOPE=tests/test.ts]      # API smoke tests
make test-api-endpoints [SCOPE=tests/test.ts]  # API CRUD tests
make test-api-ai [SCOPE=tests/test.ts]         # AI generation tests
make test-api-queue [SCOPE=tests/test.ts]     # Queue job tests
make test-api [SCOPE=tests/test.ts]            # All API tests (without e2e)
```

#### Security Tests

```bash
make test-security              # All security tests
make test-security-sast         # SAST scanning
make test-security-sca          # Dependency scanning
make test-security-container    # Container scanning
make test-security-iac          # Infrastructure as Code scanning
```

#### Testing Workflow (per workflow.mdc)

1. **Before commit**: Always run `make test-api` and/or `make test-ui` (depending on changes)
2. **Before PR**: Run `make build-api build-ui-image test-e2e` to validate consistency
3. **Quality gates**: All tests must pass before merge

### Package Management

```bash
# Install npm package (API)
make install-api ${NPM_LIB}

# Install npm package (UI)
make install-ui ${NPM_LIB}

# Install dev dependency
make install-api-dev ${NPM_LIB}
make install-ui-dev ${NPM_LIB}

# Update package-lock.json
make lock-api
```

### Queue Management

```bash
make queue-status    # Show current queue status
make queue-clear     # Clear all pending jobs
make queue-reset     # Reset queue (alias for queue-clear)
```

### Important Notes

- **Docker-first**: All commands execute in Docker containers - no native npm/python on developer machine
- **Consistent environment**: Same commands work locally and in CI
- **No git add .**: Use selective staging (`git add <specific-files>`) - see workflow.mdc
- **Test before commit**: MANDATORY - always run `make test-api` or `make test-ui` before committing
- **Quality gates**: All tests must pass before merge (see testing.mdc)
- **E2E tests require build**: Always run `make build-ui-image build-api` before `make test-e2e` to ensure production images are up-to-date
- **⚠️ NEVER use head/grep/tail directly**: Always use make commands for logs:
  - ✅ `TAIL=100 make logs-api` (correct)
  - ❌ `make logs-api | tail -100` (wrong - loses time and context)
  - ❌ `make logs-api | grep "error"` (wrong - use make commands)

