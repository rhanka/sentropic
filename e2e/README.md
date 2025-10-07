# Tests E2E - Top AI Ideas

## Vue d'ensemble

Ce répertoire contient tous les tests end-to-end (E2E) pour l'application Top AI Ideas, utilisant Playwright pour l'automatisation des navigateurs.

## Structure des tests

### Tests par page/fonctionnalité

- **`app.spec.ts`** - Tests de base de l'application (navigation, i18n, erreurs 404)
- **`companies.spec.ts`** - Tests de gestion des entreprises (CRUD, enrichissement IA)
- **`folders.spec.ts`** - Tests de gestion des dossiers (CRUD, navigation)
- **`cas-usage.spec.ts`** - Tests de la liste des cas d'usage (affichage, statuts, actions)
- **`cas-usage-detail.spec.ts`** - Tests des pages de détail des cas d'usage
- **`entreprises-detail.spec.ts`** - Tests des pages de détail des entreprises
- **`dossiers-detail.spec.ts`** - Tests des pages de détail des dossiers
- **`dashboard.spec.ts`** - Tests du dashboard (métriques, graphiques, sélecteur de dossier)
- **`matrice.spec.ts`** - Tests de configuration de la matrice d'évaluation
- **`parametres.spec.ts`** - Tests de la page des paramètres
- **`ai-generation.spec.ts`** - Tests de la génération IA (processus asynchrone, statuts)
- **`workflow-complet.spec.ts`** - Test du workflow métier complet
- **`error-handling.spec.ts`** - Tests de gestion des erreurs
- **`i18n.spec.ts`** - Tests d'internationalisation (FR/EN)
- **`api-integration.spec.ts`** - Tests d'intégration API

## Workflow métier testé

Le test `workflow-complet.spec.ts` suit le flux logique de l'application :

1. **Création d'entreprise** → Enrichissement IA
2. **Génération de cas d'usage** → Processus asynchrone
3. **Consultation des dossiers** → Suivi de l'avancement
4. **Visualisation des cas d'usage** → Statuts en temps réel
5. **Dashboard** → Métriques et graphiques

## Fonctionnalités testées

### Navigation et interface
- Navigation entre les pages
- Changement de langue (FR/EN)
- Gestion des erreurs 404
- Responsive design

### Gestion des données
- CRUD complet pour entreprises, dossiers, cas d'usage
- Validation des formulaires
- Gestion des erreurs de validation
- Persistance des données

### Génération IA
- Enrichissement des entreprises
- Génération de cas d'usage
- Suivi des statuts (génération, détail, terminé)
- Gestion des erreurs de génération

### Dashboard et métriques
- Affichage des statistiques
- Graphiques scatter plot
- Sélection de dossier
- Mise à jour en temps réel

### Configuration
- Matrice d'évaluation (axes, seuils, poids)
- Paramètres de l'application
- Sauvegarde des configurations

### API et intégration
- Endpoints de santé
- CRUD via API
- Validation des données
- Headers CORS
- Pagination et filtres

## Exécution des tests

### Via Make (recommandé)
```bash
# Tous les tests E2E
make test-e2e

# Tests en mode headed (avec interface graphique)
make test-e2e-headed

# Tests en mode debug
make test-e2e-debug
```

### Via Playwright directement
```bash
cd e2e
npm install
npx playwright test
```

## Configuration

Les tests sont configurés pour :
- S'exécuter sur plusieurs navigateurs (Chrome, Firefox, Safari)
- Utiliser Docker Compose pour l'environnement de test
- Prendre des captures d'écran en cas d'échec
- Générer des traces pour le debugging
- S'exécuter en parallèle pour optimiser les performances

## Bonnes pratiques

### Sélecteurs
- Utiliser des sélecteurs robustes (text, roles, labels)
- Éviter les sélecteurs CSS fragiles
- Préférer les data-testid quand disponibles

### Attentes
- Utiliser `waitForLoadState('networkidle')` après navigation
- Attendre les éléments avec `toBeVisible()`
- Gérer les cas conditionnels avec `if (await element.isVisible())`

### Gestion des erreurs
- Tester les cas d'erreur (validation, API, réseau)
- Vérifier les messages d'erreur appropriés
- Tester les fonctionnalités de récupération

### Performance
- Utiliser `page.waitForTimeout()` avec parcimonie
- Préférer les attentes conditionnelles
- Optimiser les tests pour l'exécution en parallèle

## Maintenance

### Ajout de nouveaux tests
1. Créer un nouveau fichier `.spec.ts`
2. Suivre la convention de nommage existante
3. Utiliser les sélecteurs robustes
4. Tester les cas d'erreur

### Mise à jour des tests
1. Vérifier que les sélecteurs sont toujours valides
2. Adapter les tests aux changements d'interface
3. Mettre à jour les workflows si nécessaire

### Debugging
1. Utiliser `--debug` pour les tests interactifs
2. Examiner les captures d'écran en cas d'échec
3. Utiliser les traces Playwright pour analyser les problèmes
