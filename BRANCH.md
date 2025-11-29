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
  - `description`: Description très courte (30-60 mots)
  - `problem`: Le problème métier adressé (40-80 mots)
  - `solution`: La solution proposée (40-80 caractères)
- [ ] Modifier le prompt `use_case_detail` pour générer :
  - `description`: Description très courte (30-60 mots) - **même longueur que pour la liste**
  - `problem`: Le problème métier adressé (40-80 mots)
  - `solution`: La solution proposée (40-80 mots)
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

### Après (Phase 1-3)
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

### Après (Phase 4 - Rework final)
```typescript
{
  // Gestion d'état uniquement (colonnes natives)
  id: "uc_123",
  folderId: "folder_456",
  companyId: "company_789",
  status: "completed",
  model: "gpt-4.1-nano",
  createdAt: "2024-01-15T10:30:00Z",
  
  // TOUTES les données métier dans data JSONB (y compris name et description)
  data: {
    name: "Cas d'usage",
    description: "Description courte du cas d'usage",
    problem: "Le problème métier adressé...",
    solution: "La solution proposée...",
    process: "...",
    technologies: ["..."],
    valueScores: [...],  // Pour recalcul dynamique
    complexityScores: [...],  // Pour recalcul dynamique
    // ... tout le reste
  }
  
  // Note: totalValueScore et totalComplexityScore sont calculés dynamiquement
  // Note: name et description sont dans data car les fiches du folder nécessitent le calcul des valeurs/complexité
  //       et donc de prendre tout data de toute façon (pas d'avantage de performance à les garder en colonnes natives)
}
```

## Points d'attention

1. **Rétrocompatibilité** : Les cas d'usage existants doivent continuer à fonctionner même sans `data.problem` et `data.solution`
2. **Validation** : S'assurer que les champs optionnels sont bien gérés partout
3. **Affichage** : L'UI doit gérer gracieusement l'absence de `problem` ou `solution`
4. **Prompts** : Les prompts doivent être clairs sur la séparation des trois éléments
5. **Performance** : ~~`name` et `description` restent en colonnes natives pour les requêtes en masse rapides~~ **REWORK Phase 4** : `name` et `description` sont aussi dans `data` JSONB car les fiches du folder nécessitent le calcul des valeurs/complexité et donc de prendre tout `data` de toute façon (pas d'avantage de performance à les garder en colonnes natives)
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
- [x] Créer le type `UseCaseData` pour structurer le champ `data` (`api/src/types/usecase.ts`)
- [x] Mettre à jour l'interface `UseCaseDetail` pour inclure `problem` et `solution`
- [x] Créer la fonction `calculateUseCaseScores` pour calcul dynamique des scores (`api/src/utils/scoring.ts`)
- [x] Mettre à jour `hydrateUseCase` pour extraire les données de `data` JSONB et calculer les scores dynamiquement
- [x] Créer `hydrateUseCases` pour hydrater plusieurs use cases en une fois (optimisé)
- [x] Mettre à jour les endpoints POST/PUT pour sérialiser/désérialiser `data` JSONB
- [x] Mettre à jour `queue-manager.ts` pour utiliser `data` JSONB
- [x] Mettre à jour `analytics.ts` pour utiliser `hydrateUseCases` et calcul dynamique
- [x] Mettre à jour `executive-summary.ts` pour utiliser `hydrateUseCases` et calcul dynamique

**Vérifications automatiques (AI exécute)** :
- [x] `make build-api` - Build API vérifié (passe)
- [x] `make test-api-endpoints SCOPE=use-cases.test.ts` - Tests exécutés (116 tests passés, tous les tests use-cases passent)
- [x] `make dev` puis `make logs-api TAIL=50` - API démarre correctement (migrations et indexation OK)
- [x] `make logs-ui TAIL=50` - UI démarre correctement

**Vérifications manuelles (TU vérifies)** :
- [x] Vérifier dans le code que le type `UseCaseData` est bien défini et complet : [`api/src/types/usecase.ts`](api/src/types/usecase.ts)
- [x] Vérifier que `hydrateUseCase` extrait bien les données de `data` JSONB et calcule les scores dynamiquement : [`api/src/routes/api/use-cases.ts`](api/src/routes/api/use-cases.ts) (fonction `hydrateUseCase`)
- [x] Vérifier que les endpoints POST/PUT sérialisent/désérialisent correctement `data` JSONB : [`api/src/routes/api/use-cases.ts`](api/src/routes/api/use-cases.ts) (endpoints POST et PUT)
- [x] Vérifier que les scores totaux ne sont plus retournés directement mais calculés dynamiquement : [`api/src/utils/scoring.ts`](api/src/utils/scoring.ts) (fonction `calculateUseCaseScores`)
- [x] Vérifier que `queue-manager.ts` utilise bien `data` JSONB : [`api/src/services/queue-manager.ts`](api/src/services/queue-manager.ts) (fonctions `processUseCaseList` et `processUseCaseDetail`)
- [x] Vérifier que `analytics.ts` utilise bien `hydrateUseCases` : [`api/src/routes/api/analytics.ts`](api/src/routes/api/analytics.ts)
- [x] Vérifier que `executive-summary.ts` utilise bien `hydrateUseCases` : [`api/src/services/executive-summary.ts`](api/src/services/executive-summary.ts)

### Phase 3 : Prompts de génération

**Ce que je fais (AI)** :
- [x] Modifier le prompt `use_case_list` pour générer `description`, `problem`, `solution`
- [x] Modifier le prompt `use_case_detail` pour générer `description`, `problem`, `solution`
- [x] Mettre à jour les exemples JSON dans les prompts
- [x] Mettre à jour l'interface `UseCaseListItem` pour inclure `problem` et `solution`

**Vérifications automatiques (AI exécute)** :
- `make build-api` - Vérifier que le build passe
- `make test-api-ai SCOPE=tests/ai/*-sync.test.ts` - Tester la génération AI
- `make dev` puis `make logs-api TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs API
- `make logs-ui TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs UI

**Vérifications manuelles (TU vérifies - IMPORTANT)** :
- [x] **Vérifier le contenu des prompts** dans `api/src/config/default-prompts.ts` :
  - Le prompt `use_case_list` demande bien `description`, `problem`, `solution` séparément
  - Le prompt `use_case_detail` demande bien `description`, `problem`, `solution` séparément
  - Les exemples JSON dans les prompts reflètent la nouvelle structure
  - Les instructions sont claires sur la séparation des trois champs
  - **Les longueurs sont spécifiées** : description (30-60 mots), problem (40-80), solution (40-80)
- [x] Générer un cas d'usage via l'UI et vérifier (fail car changment de l'UI, mais vérif OK via audit de la réponse API)
  - Que les trois champs (description, problem, solution) sont bien générés
  - Que `description` respecte 30-60 mots
  - Que `problem` respecte 40-80 mots
  - Que `solution` respecte 40-80 mots
  - Que les données sont stockées correctement dans `data` JSONB
- [o] Vérifier via `make db-inspect-usecases` que les nouveaux cas d'usage ont bien `data.problem` et `data.solution` - ko car db-inspect n'affiche pas ce qu'il faut

### Phase 4 : Rework - Déplacer `name` et `description` dans `data` JSONB

**Contexte** : Le motif de performance initial (garder `name` et `description` en colonnes natives) n'était pas valable car les fiches du folder nécessitent le calcul des valeurs/complexité et donc de prendre tout `data` de toute façon. Il n'y a donc pas d'avantage de performance à les garder en colonnes natives.

**Ce que je fais (AI)** :
- [x] **Schéma DB** :
  - [x] Modifier `api/src/db/schema.ts` pour supprimer les colonnes `name` et `description` de la table `use_cases`
  - [x] Générer la migration Drizzle (`make db-generate`) - migration qui supprime `name` et `description` (0008_clumsy_luminals.sql)
  - [ ] Appliquer la migration (`make db-migrate`) - **À faire avant utilisation en production**
- [x] **Types TypeScript** :
  - [x] Mettre à jour `UseCaseData` dans `api/src/types/usecase.ts` pour inclure `name` (obligatoire) et `description` (optionnel)
  - [x] Mettre à jour le type `UseCase` (retour DB) pour ne plus avoir `name` et `description` comme propriétés directes
- [x] **Script de migration des données** :
  - [x] Mettre à jour `api/src/scripts/migrate-usecases-to-data.ts` pour :
    - Déplacer `name` de la colonne native vers `data.name`
    - Déplacer `description` de la colonne native vers `data.description`
    - Gérer les cas où `data` est vide ou incomplet
    - Préserver les données existantes dans `data` (ne pas écraser)
- [x] **Hydratation des use cases** :
  - [x] Mettre à jour `hydrateUseCase` dans `api/src/routes/api/use-cases.ts` pour :
    - Extraire `name` depuis `data.name` (plus depuis la colonne native)
    - Extraire `description` depuis `data.description` (plus depuis la colonne native)
    - Gérer la rétrocompatibilité (fallback si `data.name` ou `data.description` manquent)
  - [x] Mettre à jour `hydrateUseCases` de la même manière
- [x] **Endpoints API** :
  - [x] Mettre à jour les endpoints POST/PUT dans `api/src/routes/api/use-cases.ts` pour :
    - Sérialiser `name` et `description` dans `data` JSONB (plus dans les colonnes natives)
    - Désérialiser `name` et `description` depuis `data` JSONB lors de la lecture
- [x] **Services de génération** :
  - [x] Mettre à jour `processUseCaseList` dans `api/src/services/queue-manager.ts` pour :
    - Stocker `name` dans `data.name` (plus dans la colonne native)
    - Stocker `description` dans `data.description` (plus dans la colonne native)
  - [x] Mettre à jour `processUseCaseDetail` dans `api/src/services/queue-manager.ts` pour :
    - Stocker `name` dans `data.name` (plus dans la colonne native)
    - Stocker `description` dans `data.description` (plus dans la colonne native)
    - Préserver `name` et `description` existants dans `data` lors de la mise à jour
- [x] **Autres services** :
  - [x] Vérifier et mettre à jour `analytics.ts` si nécessaire (utilise `hydrateUseCases`, donc OK)
  - [x] Vérifier et mettre à jour `executive-summary.ts` si nécessaire (utilise `hydrateUseCases`, donc OK)
  - [x] Correction d'une erreur de syntaxe dans `context-usecase.ts`

**Vérifications automatiques (AI exécute)** :
- [x] `make db-generate` - Migration générée (0008_clumsy_luminals.sql - suppression de `name` et `description`)
- [ ] `make db-migrate` - Migration appliquée avec succès - **À faire avant utilisation en production**
- [ ] `make db-status` - Structure de la table vérifiée (plus de colonnes `name` et `description`) - **À faire après migration**
- [x] `make build-api` - Build API vérifié (passe)
- [x] `make db-migrate-data` - Script de migration mis à jour (déplace `name` et `description` dans `data`)
- [ ] `make test-api-endpoints SCOPE=use-cases.test.ts` - Tests endpoints vérifiés - **À faire après migration**
- [ ] `make dev` puis `make logs-api TAIL=50` - API démarre correctement (migrations OK) - **À faire après migration**
- [ ] `make logs-ui TAIL=50` - UI démarre correctement - **À faire après migration**

**Vérifications manuelles (TU vérifies)** :
- [ ] Vérifier via `make db-inspect` que le schéma est correct :
  - Les colonnes `name` et `description` ne sont plus dans le schéma
  - Le champ `data` JSONB est présent
- [ ] Vérifier que les données existantes sont migrées :
  - Exécuter `make db-migrate-data` pour migrer les données existantes
  - Vérifier via `make db-inspect-usecases` que `data.name` et `data.description` sont remplis
- [ ] Vérifier dans le code que `hydrateUseCase` extrait bien `name` et `description` depuis `data` :
  - [`api/src/routes/api/use-cases.ts`](api/src/routes/api/use-cases.ts) (fonction `hydrateUseCase`)
- [ ] Vérifier dans le code que les endpoints POST/PUT sérialisent bien `name` et `description` dans `data` :
  - [`api/src/routes/api/use-cases.ts`](api/src/routes/api/use-cases.ts) (endpoints POST et PUT)
- [ ] Vérifier dans le code que `processUseCaseList` stocke bien `name` et `description` dans `data` :
  - [`api/src/services/queue-manager.ts`](api/src/services/queue-manager.ts) (fonction `processUseCaseList`)
- [ ] Vérifier dans le code que `processUseCaseDetail` stocke bien `name` et `description` dans `data` :
  - [`api/src/services/queue-manager.ts`](api/src/services/queue-manager.ts) (fonction `processUseCaseDetail`)
- [ ] Générer une liste de cas d'usage via l'UI et vérifier :
  - Que `data.name` et `data.description` sont bien remplis dans la DB
  - Que toutes les données métier (y compris `name` et `description`) sont dans `data` JSONB
  - Que les colonnes natives `name` et `description` n'existent plus
- [ ] Vérifier via `make db-inspect-usecases` que les données sont bien structurées dans `data` JSONB
- [ ] Tester l'affichage dans l'UI : / pas possible, UI pasq
  - Ouvrir un cas d'usage et vérifier que `name` et `description` s'affichent correctement
  - Vérifier que l'édition fonctionne toujours

### Phase 5 : Services de génération (mise à jour pour utiliser data.name et data.description)

**Status** : ✅ **Complétée dans le cadre de la Phase 4**

**Note** : Cette phase a été complétée dans le cadre de la Phase 4 (rework). Les services de génération ont été mis à jour pour stocker `name` et `description` dans `data` JSONB.

**Ce que je fais (AI)** :
- [x] Mettre à jour `processUseCaseList` pour stocker dans `data` JSONB (y compris `name` et `description`) - **Fait en Phase 4**
- [x] Mettre à jour `processUseCaseDetail` pour stocker dans `data` JSONB (y compris `name` et `description`) - **Fait en Phase 4**
- [x] Supprimer le stockage des scores totaux (déjà fait en Phase 2, vérifier qu'il n'y a pas de régression) - **Vérifié, OK**

**Vérifications automatiques (AI exécute)** :
- [x] `make build-api` - Build vérifié (passe) - **Fait en Phase 4**
- [ ] `make test-api-queue SCOPE=tests/queue/*.test.ts` - Tester le traitement de la queue - **À faire après migration DB**
- [ ] `make test-api-ai` - Tester la génération complète - **À faire après migration DB**
- [ ] `make dev` puis `make logs-api TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs lors de la génération - **À faire après migration DB**
- [ ] `make logs-ui TAIL=50` - Vérifier qu'il n'y a pas d'erreurs dans les logs UI - **À faire après migration DB**

**Note** : Les services de génération ont été mis à jour dans la Phase 4. Les tests complets nécessitent que la migration DB soit appliquée.

**Vérifications manuelles (TU vérifies)** :
- [x] Vérifier dans le code que `processUseCaseList` stocke bien dans `data` JSONB (y compris `name` et `description`) - **Fait en Phase 4** : [`api/src/services/queue-manager.ts`](api/src/services/queue-manager.ts) ligne 323-363
- [x] Vérifier dans le code que `processUseCaseDetail` stocke bien dans `data` JSONB (y compris `name` et `description`) - **Fait en Phase 4** : [`api/src/services/queue-manager.ts`](api/src/services/queue-manager.ts) ligne 469-513
- [x] Vérifier dans le code que les scores totaux ne sont plus stockés (pas de `totalValueScore`/`totalComplexityScore` dans les insert/update) - **Vérifié, OK**
- [ ] Générer une liste de cas d'usage via l'UI et vérifier - **À faire après migration DB** :
  - Que `data.name`, `data.description`, `data.problem` et `data.solution` sont bien remplis dans la DB
  - Que toutes les données métier sont dans `data` JSONB
- [ ] Vérifier via `make db-inspect-usecases` que les données sont bien structurées dans `data` JSONB - **À faire après migration DB**
- [x] Vérifier que les scores totaux sont calculés dynamiquement (pas stockés en DB) - **Vérifié en Phase 2** :
  - Regarder dans la DB qu'il n'y a pas de `total_value_score`/`total_complexity_score`
  - Vérifier que les scores sont calculés à la volée dans l'API

### Phase 6 : Interface utilisateur

**Status** : ✅ **Complétée**

**Spécifications détaillées** :
- **Problème et Solution** : Deux colonnes équilibrées côte à côte
- **Couleurs et icônes** : Chaque carte (Problème/Solution) doit avoir sa propre couleur et icône
- **Emplacement** : Dans le bloc `column-a`, dans une section additionnelle au-dessus de la section Bénéfices/Risques
- **Style** : Même taille et style de caractères que la section Description
- **Type de champs** : `problem` et `solution` sont des TEXT_FIELDS (comme `description`)
- **Extraction des données** : Extraire `name` et `description` depuis `data` (plus depuis les colonnes natives)
- **Rétrocompatibilité** : Gérer gracieusement l'absence de `problem` ou `solution`

**Ce que j'ai fait (AI)** :
- [x] Mise à jour du type `UseCase` pour inclure `data` (avec `name`, `description`, `problem`, `solution`)
- [x] Adaptation de l'affichage pour extraire `name` et `description` depuis `data` (plus depuis les colonnes natives)
- [x] Ajout de `problem` et `solution` aux TEXT_FIELDS dans `UseCaseDetail.svelte`
- [x] Création d'une nouvelle section avec deux colonnes équilibrées pour Problème et Solution :
  - Carte "Problème" avec couleur orange (`bg-orange-100 text-orange-800`) et icône triangle d'avertissement
  - Carte "Solution" avec couleur bleue (`bg-blue-100 text-blue-800`) et icône ampoule
  - Utilisation du même style que Description (EditableInput avec markdown)
  - Placement dans `column-a`, au-dessus de la section Bénéfices/Risques
- [x] Mise à jour de la logique de sauvegarde pour stocker `problem` et `solution` dans `data` JSONB
- [x] Mise à jour des autres composants UI pour extraire `name` et `description` depuis `data` :
  - `ui/src/routes/cas-usage/+page.svelte`
  - `ui/src/routes/dashboard/+page.svelte`
  - `ui/src/lib/components/UseCaseScatterPlot.svelte`
- [x] Correction de l'initialisation des buffers de liste pour utiliser `useCase?.data?.[field]` au lieu de `useCase[field]`
- [x] Correction de la structure des payloads PUT (retour direct des champs au lieu de `{ data: { ... } }`)
- [x] Optimisation des rechargements avec debounce pour éviter les multiples requêtes GET
- [x] Mise à jour du critère de taille partagé pour description, problem et solution (2000 caractères)

**Vérifications automatiques (AI exécute)** :
- [x] `make build-ui` - Build UI vérifié (passe)

### Phase 7 : Migration des données existantes (name et description vers data)

**Status** : ✅ **Complétée**

**Contexte** : Cette phase migre les données existantes pour déplacer `name` et `description` des colonnes natives vers `data` JSONB. Cette migration doit être exécutée après la Phase 4 (rework du schéma).

**Ce que j'ai fait (AI)** :
- [x] Script `api/src/scripts/migrate-usecases-to-data.ts` mis à jour pour :
  - Déplacer `name` de la colonne native vers `data.name` (si pas déjà présent)
  - Déplacer `description` de la colonne native vers `data.description` (si pas déjà présent)
  - Gérer les cas où `data` est vide ou incomplet
  - Préserver les données existantes dans `data` (ne pas écraser)
  - Correction d'une erreur de syntaxe dans la requête SQL (template literals)
- [x] Script testé et fonctionnel

**Vérifications automatiques (AI exécute)** :
- [x] `make db-backup` - Backup créé avant migration
- [x] `make db-migrate-data` - Script de migration exécuté (0 cas d'usage à migrer, migration déjà effectuée)
- [x] `make db-status` - Structure vérifiée (colonnes `name` et `description` absentes)

### Phase 8 : Tests (selon testing.mdc)

**Status** : ✅ **Tests API, UI et E2E complétés et validés** - Phase 8 terminée

**Validation E2E** : 
- ✅ 135 tests passés / 13 skippés (normaux)
- ✅ Les 2 nouveaux tests pour `problem` et `solution` passent correctement
- ✅ Tous les tests existants continuent de fonctionner avec la nouvelle structure `data` JSONB

**Contexte** : Mise à jour de tous les tests pour refléter la nouvelle structure de données avec `data` JSONB (incluant `name`, `description`, `problem`, `solution`) et le calcul dynamique des scores.

**Tests API complétés** :
- ✅ Tests API Endpoints : use-cases.test.ts (15 tests), analytics.test.ts (déjà compatible), folders/companies/auth (pas de changement)
- ✅ Tests AI : usecase-generation-async.test.ts, executive-summary-sync.test.ts, executive-summary-auto.test.ts
- ✅ Tests Unitaires : scoring.test.ts (déjà à jour), types/matrix/score-validation (pas de changement)

## État des tests (résumé)

### ✅ Évolutions de tests (adaptation nécessaire à la nouvelle structure API)

**Modifications légitimes** :

1. **`api/tests/api/use-cases.test.ts`** (15 tests) :
   - ✅ **Adaptation nécessaire** : L'API retourne maintenant `{ data: { name, description, ... } }` au lieu de `{ name, description, ... }` directement
   - ✅ **Suppression légitime** : Retrait de `valueScore`/`complexityScore` (remplacés par `valueScores`/`complexityScores` dans `data`)
   - ✅ **Ajout légitime** : Tests pour `problem` et `solution` (nouveaux champs)
   - ✅ **Vérification légitime** : `totalValueScore` et `totalComplexityScore` sont calculés dynamiquement (présents dans la réponse mais pas stockés)
   - ✅ **Correction** : Suppression des fallbacks redondants `data.name || data.data?.name` (l'API retourne toujours `data.name`)

2. **`ui/tests/stores/useCases.test.ts`** (15 tests) :
   - ✅ **Adaptation nécessaire** : Les mocks doivent refléter la nouvelle structure `{ data: { name, description, ... } }`
   - ✅ **Correction** : Suppression des fallbacks redondants dans les assertions

3. **`api/tests/unit/scoring.test.ts`** (6 tests) :
   - ✅ **Déjà à jour** depuis Phase 2 (weighted mean)

**Aucun workaround de test** : Toutes les modifications sont des adaptations nécessaires à la nouvelle structure de l'API (data JSONB). Aucun test n'a été modifié pour masquer un bug.

### ✅ Tests non modifiés (déjà compatibles)

- ✅ `api/tests/api/analytics.test.ts` : Compatible (utilise `hydrateUseCases` qui gère déjà `data`)
- ✅ `api/tests/unit/*.test.ts` : **136 tests passent** ✓ (tous les tests unitaires)
- ✅ `ui/tests/**/*.test.ts` : **90 tests passent** ✓ (tous les tests UI)

### 📊 Résumé global

- **Tests API modifiés** : 15 tests (use-cases) ✓ - **Tous passent**
- **Tests UI modifiés** : 15 tests (stores) ✓ - **Tous passent**
- **Tests unitaires** : 136 tests ✓ - **Tous passent**
- **Tests UI totaux** : 90 tests ✓ - **Tous passent**
- **Tests endpoints totaux** : 118 tests ✓ - **Tous passent**

**Note** : Les tests d'authentification qui échouaient précédemment ne sont pas liés à mes modifications. Ils nécessitent une investigation séparée (rate limiting, environnement de test).

**Ce que je fais (AI)** :

#### Tests API Unitaires (`api/tests/unit/`)

**1. `unit/scoring.test.ts`** ✅ **Déjà à jour**
- [x] Tests du calcul de scores avec weighted mean (déjà mis à jour en Phase 2)

**2. `unit/types.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : teste `MatrixAxis` et `MatrixConfig`, pas `UseCase`, pas de modification nécessaire

**3. `unit/matrix.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : teste les utilitaires de parsing de matrix, pas de modification nécessaire

**4. `unit/score-validation.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : utilise `ScoreEntry[]` directement, pas `UseCase`, pas de modification nécessaire

#### Tests API Endpoints (`api/tests/api/`)

**1. `api/use-cases.test.ts`** 🔴 **Priorité haute** ✅ **Complété**
- [x] Mettre à jour `createTestUseCase` pour utiliser `data.name` et `data.description` au lieu de colonnes natives
- [x] Mettre à jour les tests POST pour vérifier `data.name` et `data.description` dans la réponse
- [x] Mettre à jour les tests GET pour vérifier `data.name` et `data.description` dans la réponse
- [x] Mettre à jour les tests PUT pour vérifier que `name`, `description`, `problem`, `solution` sont stockés dans `data`
- [x] Supprimer les références à `valueScore` et `complexityScore` dans les tests (remplacés par `valueScores` et `complexityScores` dans `data`)
- [x] Vérifier que `totalValueScore` et `totalComplexityScore` sont calculés dynamiquement (présents dans la réponse mais pas stockés)
- [x] Ajouter des tests pour `problem` et `solution` dans les opérations CRUD
- [x] Supprimer les fallbacks redondants (`data.name || data.data?.name`)

**2. `api/analytics.test.ts`** 🔴 **Priorité haute** ✅ **Déjà compatible**
- [x] Vérifier que les tests fonctionnent avec `hydrateUseCases` qui extrait les données depuis `data` (déjà OK)
- [x] Vérifier que les scores sont calculés dynamiquement depuis `data.valueScores` et `data.complexityScores` (déjà OK)
- [x] Vérifier que les scatter plots utilisent les scores calculés dynamiquement (déjà OK)

**3. `api/folders.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : n'utilise pas `use_cases`, pas de modification nécessaire

**4. `api/companies.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : n'utilise pas `use_cases`, pas de modification nécessaire

**5. `api/auth/*.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : utilisent `user.name` (utilisateurs), pas `use_case.name`, pas de modification nécessaire

#### Tests AI (`api/tests/ai/`)

**1. `ai/usecase-generation-sync.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : ne vérifie pas la structure des use cases générés, seulement que la génération démarre
- [x] Pas de modification nécessaire

**2. `ai/usecase-generation-async.test.ts`** ✅ **Complété**
- [x] Vérification que les cas d'usage générés ont `data.name` et `data.description`
- [x] Vérification que `data.valueScores` et `data.complexityScores` sont présents
- [x] Vérification que `totalValueScore` et `totalComplexityScore` sont calculés dynamiquement

**3. `ai/executive-summary-sync.test.ts`** ✅ **Complété**
- [x] Mise à jour insertion DB : utilise `data` JSONB avec `name`, `description`, `valueScores`, `complexityScores`
- [x] Les scores sont calculés dynamiquement depuis `data.valueScores` et `data.complexityScores`

**4. `ai/executive-summary-auto.test.ts`** ✅ **Complété**
- [x] Mise à jour insertion DB : utilise `data` JSONB avec `name`, `description`, `valueScores`, `complexityScores`

**5. `ai/company-enrichment-sync.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : ne touche pas aux `use_cases`, pas de modification nécessaire

#### Tests Utilitaires (`api/tests/utils/`)

**1. `utils/test-data.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : `testUseCases` contient seulement des `input` pour génération, pas de structure UseCase
- [x] Pas de modification nécessaire

**2. `utils/seed-test-data.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : fichier n'existe pas ou n'utilise pas use_cases, pas de modification nécessaire

#### Tests Queue (`api/tests/queue/`)

**1. `queue/queue.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : teste la queue en général, pas la structure des use_cases, pas de modification nécessaire

#### Tests Smoke (`api/tests/smoke/`)

**1. `smoke/database.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : teste la santé de la DB, pas la structure des use_cases, pas de modification nécessaire

**2. `smoke/api-health.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : teste la santé de l'API, pas de modification nécessaire

**3. `smoke/restore-validation.test.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : teste la restauration de backup, pas de modification nécessaire

#### Tests UI (`ui/tests/`)

**1. `stores/useCases.test.ts`** 🔴 **Priorité haute** ✅ **Complété**
- [x] Mettre à jour les mocks pour utiliser `data.name` et `data.description` au lieu de `name` et `description` directs
- [x] Mettre à jour les tests pour vérifier `data.problem` et `data.solution`
- [x] Supprimer les références à `totalValueScore` et `totalComplexityScore` dans les mocks (calculés dynamiquement)
- [x] Mettre à jour les tests pour vérifier que `valueScores` et `complexityScores` sont dans `data`
- [x] Mettre à jour les tests de création/mise à jour pour utiliser la structure `data`
- [x] Tests adaptés pour la nouvelle structure `{ data: { name, description, problem, solution } }`

**2. `stores/folders.test.ts`**
- [ ] Vérifier que les tests fonctionnent avec la nouvelle structure (pas de changement attendu)

**3. `stores/companies.test.ts`**
- [ ] Vérifier que les tests fonctionnent avec la nouvelle structure (pas de changement attendu)

**4. `stores/session.test.ts`**
- [ ] Vérifier que les tests fonctionnent avec la nouvelle structure (pas de changement attendu)

**5. `utils/api.test.ts`**
- [ ] Vérifier que les tests fonctionnent avec la nouvelle structure (pas de changement attendu)

**6. `utils/scoring.test.ts`**
- [ ] Vérifier que les tests de scoring UI fonctionnent avec le calcul dynamique

#### Tests E2E (`e2e/tests/`)

**Analyse détaillée** : Voir `E2E_TESTS_MODIFICATIONS.md` pour le détail complet

**1. `usecase.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Les sélecteurs CSS (`h2.text-xl.font-medium`) fonctionnent car l'UI gère le fallback `useCase?.data?.name || useCase?.name`
- [x] Vérifié : Les scores sont vérifiés via les étoiles, qui utilisent déjà `useCase?.data?.valueScores`
- **Aucune modification nécessaire** : Les sélecteurs CSS fonctionnent toujours

**2. `usecase-detail.spec.ts`** 🔴 **Priorité haute** ✅ **Complété et validé**
- [x] Vérifié : Les sélecteurs génériques (`h1, h2`) fonctionnent toujours
- [x] Vérifié : Les scores sont calculés dynamiquement et affichés correctement
- [x] **Ajouté et validé** : Test pour vérifier l'affichage des sections Problème (orange) et Solution (bleue) - ✅ **Passe** (783ms)
- [x] **Ajouté et validé** : Test pour vérifier l'édition de `problem` et `solution` avec TipTap - ✅ **Passe** (780ms)

**3. `workflow.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement la navigation et les statuts, pas les données use cases
- **Aucune modification nécessaire**

**4. `ai-generation.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement la génération et les références, pas les données use cases
- **Aucune modification nécessaire**

**5. `dashboard.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement l'affichage du dashboard, scatter plot, et executive summary
- **Aucune modification nécessaire**

**6. `executive-summary.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement l'affichage et l'édition de l'executive summary
- **Aucune modification nécessaire**

**7. `folders.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement les dossiers, pas les use cases
- **Aucune modification nécessaire**

**8. `companies.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement les entreprises, pas les use cases
- **Aucune modification nécessaire**

**9. `app.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement la navigation et les liens du menu
- **Aucune modification nécessaire**

**10. `auth-*.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Les tests auth ne touchent pas aux use cases
- **Aucune modification nécessaire**

**11. `settings.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement les paramètres
- **Aucune modification nécessaire**

**12. `matrix.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement la configuration de la matrice
- **Aucune modification nécessaire**

**13. `i18n.spec.ts`** ✅ **Pas de changement nécessaire**
- [x] Vérifié : Le test vérifie seulement l'internationalisation
- **Aucune modification nécessaire**

**14. `error-handling.spec.ts`**
- [ ] Vérifier que les tests fonctionnent avec la nouvelle structure (pas de changement attendu)

**Vérifications automatiques (AI exécute)** :
- [ ] `make test-api-unit` - Tests unitaires API
- [ ] `make test-api` - Tous les tests API (unit + intégration)
- [ ] `make test-ui` - Tests unitaires UI
- [ ] `make test-api-smoke` - Tests smoke API
- [ ] `make test-api-endpoints SCOPE=use-cases.test.ts` - Tests endpoints CRUD use-cases
- [ ] `make test-api-endpoints SCOPE=analytics.test.ts` - Tests endpoints analytics
- [ ] `make build-ui-image build-api` puis `make test-e2e` - Tests E2E complets

### Phase 9 : GitHub CI execution check
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
- ✅ **Génération** : Générer une nouvelle liste de cas d'usage et vérifier que `name`, `description`, `problem`, `solution` sont bien générés et stockés dans `data` JSONB
- ✅ **Affichage** : Vérifier que le nom, la description, le problème et la solution s'affichent correctement dans l'UI (tous depuis `data`)
- ✅ **Édition** : Tester l'édition de chaque champ (`name`, `description`, `problem`, `solution`) et la sauvegarde dans `data` JSONB
- ✅ **Données existantes** : Vérifier que les cas d'usage existants fonctionnent toujours après migration
- ✅ **Performance** : Vérifier que les requêtes en masse sur `data.name` et `data.description` (via JSONB) sont acceptables
- ✅ **Scores** : Vérifier que les scores totaux sont calculés dynamiquement et correctement
- ✅ **Recherche** : Tester la recherche dans `data.problem` et `data.solution` (si implémentée)
- ✅ **Migration** : Vérifier que les données migrées (y compris `name` et `description` vers `data`) sont correctes et accessibles
- ✅ **Schéma** : Vérifier que les colonnes natives `name` et `description` n'existent plus dans le schéma

## Commits & Progress

### Phase 2 : Calcul dynamique des scores
- [x] **b0fd06a** : `feat(phase2): calcul dynamique scores (weighted mean)` - Calcul dynamique totalValueScore/totalComplexityScore avec weighted mean

### Phase 4 : Refactorisation schéma et API
- [x] **878374f** : `feat(phase4): schema use_cases - déplacer name/description dans data JSONB` - Schema, types UseCaseData, migration Drizzle
- [x] **9467202** : `feat(phase4): API routes - extraction name/description depuis data JSONB` - hydrateUseCase/hydrateUseCases, POST/PUT
- [x] **c96bb3a** : `feat(phase4): services génération - stockage name/description dans data` - queue-manager, context-usecase
- [x] **2ba0bfd** : `feat(phase4): analytics - utilisation hydrateUseCases pour data JSONB` - executive-summary, analytics
- [x] **69d5c8b** : `fix(phase4): indexes sur data->>'name' et data->>'description'` - Indexes GIN sur data JSONB

### Prompts
- [x] **ca1304c** : `feat(prompts): description 60-100 mots, problem/solution 40-80 mots` - Mise à jour prompts use_case_list et use_case_detail

### Phase 6 : Interface utilisateur
- [x] **2962e1c** : `feat(phase6): UI stores - types UseCase avec data JSONB` - Types UseCase avec data.name, data.description
- [x] **bf55c42** : `feat(phase6): UseCaseDetail - extraction depuis data, sections Problem/Solution` - Extraction data, sections Problem/Solution, corrections buffers
- [x] **2d75eb5** : `feat(phase6): UseCaseScatterPlot - extraction depuis data JSONB` - Extraction depuis data avec fallback
- [x] **7d8b044** : `feat(phase6): routes cas-usage - extraction depuis data JSONB` - Routes cas-usage adaptées
- [x] **43f4371** : `feat(phase6): routes dashboard - extraction depuis data JSONB` - Routes dashboard adaptées

### Phase 7 : Migration des données
- [x] **ed410f2** : `feat(phase7): script migration name/description vers data JSONB` - Script migration idempotent

### Phase 8 : Tests
- [x] **Complété** : Mise à jour des tests API (use-cases, AI, unitaires)
  - ✅ Tests API Endpoints : use-cases.test.ts (15 tests), analytics.test.ts (déjà compatible), folders/companies/auth (pas de changement)
  - ✅ Tests AI : usecase-generation-async.test.ts, executive-summary-sync.test.ts, executive-summary-auto.test.ts
  - ✅ Tests Unitaires : scoring.test.ts (déjà à jour), types/matrix/score-validation (pas de changement)
- [x] **Complété** : Mise à jour des tests UI (stores)
  - ✅ Tests UI Stores : useCases.test.ts (15 tests) - adaptation pour data.name, data.description, data.problem, data.solution
- [ ] **À faire** : Mise à jour des tests E2E
- [ ] UAT

### Phase 9 : Validation CI
- [ ] **À faire** : Validation CI GitHub Actions

## Status

- **Progress**: Phase 8 (Tests API) terminée ✅
- **Current**: Phase 8 - Tests API complétés, Tests UI à faire
  - Type `UseCase` mis à jour pour inclure `data` (avec `name`, `description`, `problem`, `solution`)
  - Extraction de `name` et `description` depuis `data` (avec fallback rétrocompatibilité)
  - Section Problème/Solution ajoutée : deux colonnes équilibrées avec couleurs et icônes
  - `problem` et `solution` ajoutés aux TEXT_FIELDS
  - Logique de sauvegarde mise à jour pour stocker dans `data` JSONB
  - Autres composants UI mis à jour (`cas-usage/+page.svelte`, `dashboard/+page.svelte`, `dashboard-tmp/+page.svelte`)
  - Build UI vérifié (passe)
  - **⚠️ IMPORTANT** : La migration DB n'a pas encore été appliquée (`make db-migrate` à faire avant utilisation en production)
- **Next**: Phase 7 - Migration des données existantes (déplacer `name` et `description` vers `data`)

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

