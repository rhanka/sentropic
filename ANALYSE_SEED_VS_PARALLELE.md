# Analyse : Pourquoi les tests passent individuellement mais échouent ensemble

## Observation

**Les tests passent individuellement** mais **échouent en parallèle**, même si le seed de données est fait **une seule fois avant tous les tests**.

## Explication

### Le seed fonctionne correctement
- Le seed (`db-seed-test`) crée **toutes les données nécessaires** : workspaces, users, memberships, organizations, folders
- Le seed est exécuté **une seule fois avant tous les tests** (dans `Makefile` : `test-e2e: ... db-seed-test ...`)
- **Les données sont présentes** quand les tests commencent

### Pourquoi les tests échouent en parallèle ?

#### Problème 1 : Race conditions dans les `beforeAll` hooks

**Scénario** :
1. Le seed crée `Workspace A (E2E)` avec `workspaceId = E2E_WS_A`
2. **9 fichiers de tests** ont des `beforeAll` qui s'exécutent **en parallèle** (4 workers)
3. Tous ces `beforeAll` cherchent le workspace `Workspace A (E2E)` en même temps :
   ```typescript
   const res = await userAApi.get('/api/v1/workspaces');
   const workspaceA = items.find((ws) => ws.name.includes('Workspace A (E2E)'));
   ```

**Conflits possibles** :
- Plusieurs `beforeAll` lisent la liste des workspaces **simultanément**
- Ils trouvent tous le même `workspaceAId`
- **Ensuite**, ils essaient tous d'ajouter des membres **en parallèle** sur le même workspace :
  ```typescript
  await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
    data: { email: 'e2e-user-b@example.com', role: 'editor' },
  });
  ```

#### Problème 2 : Conflits sur les membres

**Scénario** :
- `organizations-detail.spec.ts` ajoute `e2e-user-b` en `editor`
- `folders.spec.ts` ajoute `e2e-user-b` en `viewer`
- `usecase-detail.spec.ts` ajoute `e2e-user-victim` en `editor`
- **Tous en parallèle** sur le même workspace `Workspace A (E2E)`

**Conséquences** :
- Si un `beforeAll` ajoute `e2e-user-b` en `editor`, puis un autre essaie de l'ajouter en `viewer`, cela peut causer un conflit
- Les requêtes peuvent échouer avec 404 si le workspace n'est pas encore complètement initialisé (timing)
- Ou 409 si le membre existe déjà mais que la logique de conflit ne gère pas bien la concurrence

#### Problème 3 : Ordre d'exécution non déterministe

**Scénario** :
- Les `beforeAll` s'exécutent **en parallèle** entre les fichiers de tests
- L'ordre d'exécution n'est **pas garanti**
- Si un test consomme/modifie des données avant qu'un autre ne les lise, cela peut causer des incohérences

**Exemple** :
- Test A : `beforeAll` ajoute `e2e-user-b` en `editor`
- Test B : `beforeAll` ajoute `e2e-user-b` en `viewer` (écrase le rôle)
- Test A : S'attend à ce que `e2e-user-b` soit `editor` → **échoue**

### Pourquoi les tests passent individuellement ?

**Quand un seul fichier de test est exécuté** :
- **Un seul** `beforeAll` s'exécute
- **Pas de conflits** avec d'autres tests
- **Pas de race conditions** sur les ressources partagées
- **Données cohérentes** : le test modifie les données, puis les utilise, sans interférence

## Conclusion

Le problème n'est **pas** un problème de seed de données. C'est un **problème de conception des tests** :

1. **Les tests partagent les mêmes ressources** (workspace, membres)
2. **Les `beforeAll` modifient ces ressources en parallèle**
3. **Pas d'isolation** entre les tests
4. **Conflits** : plusieurs tests modifient la même ressource en même temps

## Solutions

### Solution 1 : Isolation des ressources (recommandée)

**Chaque fichier de test crée son propre workspace** dans `beforeAll` :
- Plus de conflits
- Tests isolés et reproductibles
- Pas de dépendance aux données d'autres tests

### Solution 2 : Utiliser le seed global uniquement (lecture seule)

**Les `beforeAll` ne font que lire** les données du seed, pas les modifier :
- Pas de conflits (lecture seule)
- Données cohérentes
- Mais moins de flexibilité

### Solution 3 : Sérialiser les `beforeAll` critiques

**Utiliser `test.describe.serial`** pour les tests qui modifient les mêmes ressources :
- Pas de conflits (séquentiel)
- Mais plus lent
