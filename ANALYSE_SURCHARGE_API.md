# Analyse approfondie : Surcharge API et Conception des Tests E2E

## Résumé exécutif

### Problème principal identifié : Pool PostgreSQL saturé
- **Pool limité à 10 connexions** (`api/src/db/client.ts`)
- **4 workers** exécutent des `beforeAll` en parallèle
- **12-20 connexions nécessaires** mais seulement **10 disponibles**
- **Résultat** : Timeouts dans les `beforeAll` hooks (30s dépassés)

### Problème secondaire : Conflits de ressources
- **9 fichiers de tests** modifient le même workspace `Workspace A (E2E)`
- **Tous** ajoutent/modifient le même utilisateur `e2e-user-b` avec des rôles différents
- **Conflits** : Requêtes concurrentes sur les mêmes ressources → verrous de base de données

### Solutions immédiates
1. **Augmenter le pool PostgreSQL** à 20-30 connexions pour les tests E2E
2. **Réduire le parallélisme** à 2 workers (au lieu de 4)
3. **Isoler les ressources** : Chaque fichier de test crée son propre workspace

## 1. Analyse de la surcharge API

### Charge estimée
- **12 fichiers** avec `beforeAll` hooks
- **4 workers** en parallèle (par défaut)
- **2-5 appels API** par `beforeAll` hook (séquentiels)
- **Maximum théorique** : 4 `beforeAll` × 5 appels = **20 appels API simultanés**

### Conclusion
**20 appels API simultanés n'est PAS une charge élevée**. Une API moderne devrait pouvoir gérer cela sans problème.

### Pourquoi l'API est surchargée ?

#### ✅ PROBLÈME IDENTIFIÉ : Pool de connexions PostgreSQL saturé

**Configuration actuelle** (`api/src/db/client.ts`) :
```typescript
const pool = new Pool({ 
  connectionString, 
  ssl, 
  max: 10,  // ← LIMITE À 10 CONNEXIONS
  idleTimeoutMillis: 10_000 
});
```

**Analyse** :
- Pool limité à **10 connexions maximum**
- Avec 4 workers en parallèle, on peut avoir :
  - 4 `beforeAll` × 3-5 appels API = **12-20 connexions nécessaires**
  - Mais seulement **10 connexions disponibles**
  - **Résultat** : Les appels API attendent qu'une connexion se libère → **timeouts**

**Preuve** :
- Les timeouts dans `beforeAll` (30s) correspondent à des appels API qui attendent une connexion
- Les tests passent individuellement (moins de concurrence) mais échouent en parallèle (saturation du pool)

#### Hypothèse 2 : Verrous de base de données
- Les `beforeAll` modifient les mêmes ressources (workspace, membres)
- PostgreSQL peut avoir des verrous sur les tables `workspaces` et `workspace_memberships`
- Les requêtes concurrentes peuvent attendre la libération des verrous
- **Vérification nécessaire** : Voir si des transactions longues bloquent les autres

#### Hypothèse 3 : Seed de données
- Le `global.setup.ts` seed les données au démarrage
- Si plusieurs `beforeAll` essaient d'accéder aux données pendant le seed, cela peut causer des conflits
- **Vérification nécessaire** : Voir le timing entre le seed et les `beforeAll`

## 2. Analyse des conflits de ressources dans les tests

### Problème identifié : Conflits sur `Workspace A (E2E)`

**9 fichiers de tests** modifient le même workspace `Workspace A (E2E)` en parallèle :

| Fichier | Action | Utilisateur | Rôle |
|---------|--------|-------------|------|
| `organizations-detail.spec.ts` | Ajoute membre | `e2e-user-b` | `editor` |
| `usecase-detail.spec.ts` | Ajoute membre | `e2e-user-b` | `editor` |
| `folders.spec.ts` | Ajoute membre | `e2e-user-b` | `viewer` |
| `usecase.spec.ts` | Ajoute membre | `e2e-user-b` | `viewer` |
| `dashboard.spec.ts` | Ajoute membre | `e2e-user-b` | `viewer` |
| `organizations.spec.ts` | Ajoute membre | `e2e-user-b` | `viewer` |
| `matrix.spec.ts` | Ajoute membre | `e2e-user-b` | `editor` |
| `dossiers-reload-draft.spec.ts` | Ajoute membre | `e2e-user-b` | `editor` |
| `documents-ui-actions.spec.ts` | Ajoute membre | `e2e-user-b` | `editor` |

### Problèmes de conception

#### Problème 1 : Même ressource partagée
- **9 tests** modifient le même workspace `Workspace A (E2E)`
- **Tous** ajoutent/modifient le même utilisateur `e2e-user-b`
- **Conflits** : Si plusieurs tests ajoutent `e2e-user-b` en parallèle avec des rôles différents, cela peut causer :
  - Des erreurs 409 (conflit) si le membre existe déjà
  - Des incohérences si un test change le rôle pendant qu'un autre lit les membres
  - Des timeouts si les requêtes attendent des verrous de base de données

#### Problème 2 : Rôles différents pour le même utilisateur
- Certains tests ajoutent `e2e-user-b` en `viewer`
- D'autres en `editor`
- Si ces tests s'exécutent en parallèle, le dernier à s'exécuter écrase le rôle précédent
- **Impact** : Les tests peuvent échouer car ils s'attendent à un rôle spécifique

#### Problème 3 : Dépendance au seed de données
- Tous les tests dépendent du seed initial (`global.setup.ts`)
- Si le seed n'est pas terminé quand les `beforeAll` s'exécutent, les données peuvent être manquantes
- **Erreurs observées** : "Aucun dossier trouvé pour Workspace A", "Aucune organisation Workspace A"

#### Problème 4 : Pas d'isolation entre tests
- Les tests partagent les mêmes ressources (workspace, membres, organisations)
- Un test peut modifier l'état que d'autres tests attendent
- **Impact** : Tests flaky qui passent individuellement mais échouent en parallèle

## 3. Solutions proposées

### Solution 1 : Isolation des ressources par test

**Principe** : Chaque fichier de test devrait utiliser ses propres ressources (workspace, membres).

**Implémentation** :
- Créer un workspace unique par fichier de test dans `beforeAll`
- Utiliser un timestamp ou un UUID pour garantir l'unicité
- Nettoyer les ressources créées dans `afterAll`

**Avantages** :
- Pas de conflits entre tests
- Tests isolés et reproductibles
- Pas de dépendance au seed global

**Inconvénients** :
- Plus de setup par test
- Plus de données créées (mais nettoyées après)

### Solution 2 : Utiliser le seed global uniquement

**Principe** : Tous les tests utilisent les données du seed global sans les modifier.

**Implémentation** :
- Le `global.setup.ts` crée tous les workspaces et membres nécessaires
- Les `beforeAll` ne font que lire les données, pas les modifier
- Les tests utilisent les données existantes

**Avantages** :
- Pas de conflits (lecture seule)
- Setup plus rapide
- Données cohérentes

**Inconvénients** :
- Moins de flexibilité (tous les tests doivent utiliser les mêmes données)
- Dépendance au seed global

### Solution 3 : Verrous de test (test serial)

**Principe** : Utiliser `test.describe.serial` pour les tests qui modifient les mêmes ressources.

**Implémentation** :
- Regrouper les tests qui modifient `Workspace A` dans un seul fichier avec `test.describe.serial`
- Ou utiliser des verrous au niveau de l'API pour sérialiser les modifications

**Avantages** :
- Pas de conflits (exécution séquentielle)
- Peut garder la structure actuelle

**Inconvénients** :
- Plus lent (séquentiel au lieu de parallèle)
- Moins de parallélisme

### Solution 4 : Améliorer la robustesse de l'API

**Principe** : L'API devrait gérer la concurrence correctement.

**Implémentation** :
- Utiliser des transactions avec isolation appropriée
- Gérer les conflits 409 gracieusement (idempotence)
- Augmenter le pool de connexions PostgreSQL si nécessaire
- Ajouter des retries avec backoff exponentiel

**Avantages** :
- API plus robuste
- Tests plus fiables

**Inconvénients** :
- Modifications côté API nécessaires

## 4. Recommandations

### 🔴 URGENT : Résoudre la saturation du pool PostgreSQL

**Solution immédiate** : Augmenter le pool de connexions pour les tests E2E

**Options** :
1. **Augmenter le pool à 20-30 connexions** pour les tests E2E
   - Modifier `api/src/db/client.ts` : `max: process.env.NODE_ENV === 'test' ? 30 : 10`
   - Ou via variable d'environnement : `DB_POOL_MAX=30`

2. **Réduire le parallélisme des tests** (2 workers au lieu de 4)
   - Modifier `e2e/playwright.config.ts` : `workers: process.env.WORKERS ? parseInt(process.env.WORKERS) : 2`
   - Réduit la charge : 2 `beforeAll` × 5 appels = 10 connexions max

3. **Combinaison** : Pool à 20 + 2 workers = marge de sécurité

### Court terme (pour faire passer les tests)
1. ✅ **Augmenter le pool PostgreSQL** à 20-30 connexions pour les tests
2. ✅ **Augmenter les timeouts** des `beforeAll` hooks (60s au lieu de 30s)
3. ✅ **Réduire le parallélisme** (2 workers au lieu de 4) pour réduire les conflits
4. ✅ **Ajouter des retries** dans les `beforeAll` pour gérer les conflits temporaires

### Moyen terme (améliorer la conception)
1. **Isoler les ressources** : Chaque fichier de test crée son propre workspace
2. **Utiliser le seed global** : Les `beforeAll` ne font que lire, pas modifier
3. **Sérialiser les tests critiques** : Utiliser `test.describe.serial` pour les tests qui modifient les mêmes ressources

### Long terme (robustesse)
1. **Améliorer l'API** : Gérer la concurrence correctement (transactions, verrous, retries)
2. **Pool de connexions** : Vérifier et ajuster la taille du pool PostgreSQL
3. **Monitoring** : Ajouter des métriques pour identifier les goulots d'étranglement

## 5. Actions immédiates

1. ✅ Analyser les logs de l'API pour identifier les goulots d'étranglement
2. ✅ Vérifier la configuration du pool de connexions PostgreSQL
3. ✅ Identifier les requêtes lentes ou bloquantes
4. ✅ Implémenter l'isolation des ressources par test (Solution 1)
