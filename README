## SPÉCIFICATION TECHNIQUE – Svelte (UI) + API TypeScript + OpenAI + SQLite/Litestream + DevOps Docker/Make

Ce document spécifie une application web composée de:
- UI: Svelte 5 (SvelteKit; pas de SSR, build statique)
- API: TypeScript (serveur Node, framework léger recommandé: Hono ou Fastify)
- LLM: OpenAI (SDK Node officiel)
- Base de données: SQLite (fichier local) + Litestream pour backup vers un bucket S3 compatible (Scaleway Object Storage)
- Tooling: Makefile (build/test/deploy), Docker et docker-compose pour dev local only (zéro npm/yarn/pip local), GitHub Actions pour CI/CD
- Déploiements: UI sur GitHub Pages, API sur Scaleway Container (PaaS)
- Variables d’environnement/Secrets: OPENAI_API_KEY, SCW_ACCESS_KEY, SCW_SECRET_KEY, SCW_DEFAULT_ORGANIZATION_ID, SCW_DEFAULT_PROJECT_ID, SCW_NAMESPACE_ID, S3_BUCKET_NAME, S3_ENDPOINT, S3_REGION

Le scaffolding suit strictement l’exemple `rhanka/nc-fullstack` (front Svelte + backend + Make + Docker + GitHub Actions), adapté avec API TypeScript et SQLite/Litestream.

### Architecture globale (mermaid)

```
flowchart LR
  User((Browser)) -- UI --> SvelteKit
  SvelteKit -- REST/JSON --> API_TS
  API_TS -- SQLite file --> app.db
  API_TS -- Litestream --> S3(Scaleway Object Storage)
  API_TS -- HTTPS --> OpenAI
  OIDC[Google/LinkedIn] -- OIDC --> API_TS
  CI(CI GitHub Actions) -- deploy --> GH_Pages & Scaleway
```


### 1) Cartographie fonctionnelle et écrans

Les écrans et leurs responsabilités sont implémentés en Svelte avec SvelteKit (routing fichiers) et des Svelte stores pour l’état partagé. L’API REST TypeScript est la source de vérité (pas de persistance critique en localStorage).

1. Accueil `Index` (/)
   - CTA pour démarrer et rediriger vers `/home`.
   - Sous-jacent: pas d’état, toasts UI.

2. Génération `Home` (/home)
   - Champs: `currentInput` (texte libre), sélection d’`entreprise` (facultative), option `createNewFolder`.
   - Actions: `generateUseCases(input, createNewFolder)` → crée éventuellement un dossier + génère une liste de cas puis leurs détails via OpenAI.
   - Dépendances: `companies`, `currentCompanyId`, `folders`, `currentFolderId`, toasts.
   - Navigation: redirige vers `/cas-usage` après succès.

3. Dossiers `Folders` (/dossiers)
   - CRUD de dossiers: `addFolder(name, description)`, `updateFolder`, `deleteFolder`, `setCurrentFolder`.
   - Affiche nombre de cas d’usage par dossier, association éventuelle à une `companyId`.
   - Navigation: sélectionner un dossier redirige vers `/cas-usage`.

4. Liste des cas `UseCaseList` (/cas-usage)
   - Filtre par `currentFolderId`.
   - Actions: voir détail, supprimer (boîte de dialogue), future création manuelle.
   - Affiche des notes synthétiques valeur/complexité selon `matrixConfig`.

5. Détail d’un cas `UseCaseDetail` (/cas-usage/:id)
   - Affiche les champs d’un `UseCase` et permet l’édition: description, benefits, metrics, risks, nextSteps, sources, relatedData, process, technology, deadline, contact.
   - Tableaux d’évaluation par axes de `valueScores` et `complexityScores` avec recomputation de `totalValueScore`/`totalComplexityScore`.
   - Suppression du cas.

6. Dashboard `Dashboard` (/dashboard)
   - Visualisation scatter Valeur vs Facilité d’implémentation (inverse de complexité), légende par `process`.
   - Comptes/bornes basés sur `matrixConfig` et cas du `currentFolder`.

7. Matrice `Matrix` (/matrice)
   - Configuration des axes de valeur/complexité (poids), seuils (points, threshold, cases) et descriptions de niveaux (1..5).
   - Met à jour les scores des cas du dossier courant.

8. Entreprises `Companies` (/entreprises, /entreprises/:id)
   - CRUD d’entreprises, sélection d’une `currentCompanyId`.
   - Utilisée pour contextualiser les prompts de génération (OpenAI) et l’association dossier→entreprise.

9. Paramètres `Settings` (/parametres)
   - Stocker via l’API backend: prompts, modèles (liste/détail/dossier/entreprise), paramètres avancés `maxRetries`, `parallelQueue`. La clé `OPENAI_API_KEY` reste côté serveur (jamais côté client).

10. Configuration métier `BusinessConfiguration` (/configuration-metier)
   - Liste/modification basique des secteurs et processus.
   - Sert de référentiel pour la cohérence des prompts détaillés.

11. 404 `NotFound`
   - Page d’erreur simple.


### Header (Navigation principale)

- Intention: fournir une barre de navigation cohérente, accès rapide aux vues principales, statut d’auth, sélecteur de langue FR/EN.
- Items:
  - Accueil `/`
  - Dossiers `/dossiers`
  - Entreprises `/entreprises`
  - Secteurs et processus `/configuration-metier`
  - Cas d'usage `/cas-usage`
  - Matrice `/matrice`
  - Dashboard `/dashboard`
  - Design `/design`
  - Données `/donnees`
  - Paramètres `/parametres`
- Comportements:
  - Mise en évidence de l’onglet actif.
  - À droite: bouton Connexion (Google/LinkedIn) si non connecté; avatar + menu (Déconnexion) si connecté; sélecteur FR/EN.
  - Responsive (pile vertical sur mobile, horizontal desktop).


### 1.1) Détails par écran: flux, API et données

1) Accueil `Index` (/)
- Intention: onboarding minimal; introduit l’outil et conduit l’utilisateur vers la génération.
- UI: Titre + CTA “Commencer” → redirige `/home`.
- API: aucun appel.
- État: aucun.

2) Génération `Home` (/home)
- Intention: point d’entrée métier pour décrire le contexte et lancer une génération encadrée (dossier + cas d’usage). 
- UI:
  - Zone de texte `currentInput` (obligatoire).
  - Sélecteur d’entreprise (optionnel) alimenté par `/companies`.
  - Case `createNewFolder` (par défaut: true).
  - Bouton “Générer vos cas d’usage”.
- Stores utilisés: `companiesStore`, `foldersStore` (lecture), `useCasesStore` (aucune écriture directe ici).
- API:
  - GET `/api/v1/companies`
    - Response 200: `{ items: Company[] }`
  - POST `/api/v1/use-cases/generate`
    - Request JSON: `{ input: string; create_new_folder: boolean; company_id?: string }`
    - Response 200: `{ created_folder_id?: string; created_use_case_ids: string[]; summary: string }`
    - Effets serveur: création éventuelle d’un dossier, génération titres + détails via OpenAI, validation JSON, calcul de scores (voir 2.1), persistance.
  - Erreurs: 400 si `input` vide, 429/5xx pour OpenAI/serveur; UI affiche toasts d’erreur.
- États/UI:
  - Loading pendant génération; toasts d’avancement.
  - Succès → navigation `/cas-usage`.

3) Dossiers `Folders` (/dossiers)
- Intention: organiser la production par périmètre; associer un dossier à une entreprise; gérer le dossier actif.
- UI:
  - Liste des dossiers avec: nom, description, date, entreprise associée (si présente), nombre de cas.
  - Actions: Créer, Éditer, Supprimer, Sélectionner (définit le dossier actif côté store).
- Stores: `foldersStore` (list + currentFolderId), `companiesStore` (pour nom d’entreprise), `useCasesStore` (compter par dossier côté front ou via count API optionnelle).
- API:
  - GET `/api/v1/folders` → `{ items: Folder[] }`
  - POST `/api/v1/folders` body `{ name, description, company_id? }` → `{ id, ... }`
  - PUT `/api/v1/folders/{id}` body `{ name?, description?, company_id?, matrix_config? }` → `{ id, ... }`
  - DELETE `/api/v1/folders/{id}` → 204 (cascade `use_cases`)
  - Optionnel (count): GET `/api/v1/use-cases/count?folder_id=...` → `{ count: number }`
- États/UI: modales de création/édition/suppression; confirmations; toasts.

4) Liste des cas `UseCaseList` (/cas-usage)
- Intention: visualiser rapidement les cas du dossier actif, accéder au détail, faire du tri basique, préparer la priorisation.
- UI:
  - Grille/liste des cas filtrés par dossier actif.
  - Actions: Voir détail, Supprimer, (future Création manuelle).
- Stores: `useCasesStore` (liste), `matrixStore` (seuils pour rendu des ratings), `foldersStore` (dossier actif).
- API:
  - GET `/api/v1/use-cases?folder_id={currentFolderId}` → `{ items: UseCase[] }`
  - DELETE `/api/v1/use-cases/{id}` → 204
- États/UI: empty state si aucun dossier actif ou liste vide; toasts succès/erreur.

5) Détail d’un cas `UseCaseDetail` (/cas-usage/:id)
- Intention: permettre l’édition enrichie et la qualification complète d’un cas avec traçabilité du scoring.
- UI:
  - Affiche/édite: `name`, `description`, `benefits[]`, `metrics[]`, `risks[]`, `next_steps[]`, `sources[]`, `related_data[]`, `process`, `technology`, `deadline`, `contact`.
  - Tables de notation: `value_scores[]`, `complexity_scores[]` avec changements de `rating` (1..5) et `description` par niveau.
  - Affiche `total_value_score`, `total_complexity_score` et niveaux agrégés sous forme étoiles/croix.
  - Actions: Enregistrer, Supprimer, Retour à la liste.
- Stores: `useCasesStore` (lecture/écriture après PUT), `matrixStore` (axes/thresholds).
- API:
  - GET `/api/v1/use-cases/{id}` → `UseCase`
  - PUT `/api/v1/use-cases/{id}` body `Partial<UseCase>` → `UseCase`
    - Serveur: recalcule les scores (2.1) en fonction de la `matrix_config` du dossier lié; renvoie l’objet final.
  - DELETE `/api/v1/use-cases/{id}` → 204
- États/UI: gestion des champs liste via textarea (1 item/ligne); toasts sauvegarde/suppression.

6) Dashboard `Dashboard` (/dashboard)
- Intention: offrir une vue portfolio priorisée par valeur/facilité et des KPIs synthétiques par dossier.
- UI:
  - Cartes KPI: nombre de cas, moyenne valeur, moyenne complexité.
  - Scatter Valeur (%) vs Facilité (% = 100−complexité_norm) coloré par `process`.
- Stores: `foldersStore` (dossier actif), `matrixStore` (pour bornes si besoin).
- API (agrégation côté serveur):
  - GET `/api/v1/analytics/summary?folder_id=...`
    - Response: `{ total_use_cases: number; avg_value: number; avg_complexity: number }`
  - GET `/api/v1/analytics/scatter?folder_id=...`
    - Response: `{ items: { id: string; name: string; process: string; value_norm: number; ease: number; original_value: number; original_ease: number }[] }`
- États/UI: loading; empty state si aucun cas.

7) Matrice `Matrix` (/matrice)
- Intention: gouverner la méthode d’évaluation (axes, poids, seuils, descriptions) et recalculer les scores des cas.
- UI:
  - Tables d’édition des poids `weight` pour axes valeur/complexité.
  - Tables d’édition des `thresholds` (points, threshold) pour niveaux 1..5 (valeur et complexité).
  - Dialogue pour éditer `level_descriptions` (par axe, 5 niveaux).
  - Action “Enregistrer configuration”.
- Stores: `matrixStore`, `foldersStore` (dossier actif).
- API:
  - GET `/api/v1/folders/{id}/matrix` → `MatrixConfig`
  - PUT `/api/v1/folders/{id}/matrix` body `MatrixConfig` → `MatrixConfig`
  - POST `/api/v1/folders/{id}/recalculate` → 202/200 (recalcule tous les scores du dossier)
- États/UI: confirmation d’impact (recalcul); toasts succès/erreur.

8) Entreprises `Companies` (/entreprises, /entreprises/:id)
- Intention: créer/maintenir des profils d’entreprise riches pour contextualiser la génération et l’analyse.
- UI:
  - Liste des entreprises; fiche avec `name`, `industry`, `size`, `products`, `processes`, `challenges`, `objectives`, `technologies`.
  - Actions: Créer/Éditer/Supprimer; Définir “active” côté store si besoin pour `/home`.
  - Option: auto-remplissage via OpenAI sur saisie du nom.
- Stores: `companiesStore` (list + currentCompanyId).
- API:
  - GET `/api/v1/companies` → `{ items: Company[] }`
  - POST `/api/v1/companies` body `CompanyInput` → `Company`
  - GET `/api/v1/companies/{id}` → `Company`
  - PUT `/api/v1/companies/{id}` body `Partial<Company>` → `Company`
  - DELETE `/api/v1/companies/{id}` → 204
  - POST `/api/v1/companies/ai-enrich` body `{ name: string }` → `Partial<Company>` (champs enrichis)
- États/UI: feuille latérale (sheet) de création/édition; toasts.

9) Paramètres `Settings` (/parametres)
- Intention: industrialiser la génération (prompts, modèles, limites), séparer secrets et tuning côté serveur.
- UI:
  - Édition des prompts: `useCaseListPrompt`, `useCaseDetailPrompt`, `folderNamePrompt`, `companyInfoPrompt`.
  - Sélection des modèles: `listModel`, `detailModel`, `folderModel`, `companyInfoModel`.
  - Limites: `maxRetries`, `parallelQueue`.
  - Actions: Sauvegarder, Réinitialiser.
- Store: `settingsStore`.
- API:
  - GET `/api/v1/settings` → `Settings`
  - PUT `/api/v1/settings` body `SettingsInput` → `Settings`
- États/UI: validations simples; toasts.

10) Configuration métier `BusinessConfiguration` (/configuration-metier)
- Intention: maîtriser le référentiel secteurs/processus utilisé par les prompts et l’analyse.
- UI:
  - Tables éditables des secteurs et processus; actions Ajouter/Éditer/Supprimer.
- Store: `businessStore`.
- API:
  - GET `/api/v1/business-config` → `{ sectors: Sector[]; processes: Process[] }`
  - PUT `/api/v1/business-config` body `{ sectors: Sector[]; processes: Process[] }` → même objet
- États/UI: toasts succès/erreur.

11) 404 `NotFound`
- Aucun appel; lien retour `/`.

12) Design `/design`
- Intention: espace d’exploration UI (bibliothèque de composants, prototypes visuels).
- API: aucun appel métier.

13) Données `/donnees`
- Intention: vue technique/outillage (tableaux, prévisualisation de données).
- API: endpoints utilitaires si nécessaire (facultatif), sinon mock/démo.


Variables sous-jacentes clés côté backend/API:
- Gestion des entités: `Company`, `Folder`, `UseCase`, `MatrixConfig` (axes, poids, thresholds, descriptions), `BusinessConfig` (sectors, processes).
- Contexte de génération: `currentCompanyId`, association dossier→entreprise, prompts/configs.
- Agrégations: comptages par niveaux, scoring, normalisation pour graphiques.


### 2) Modèle de données (SQLite + Litestream)

Base: un fichier SQLite unique (ex: `data/app.db`) persistant. Sauvegarde continue via Litestream vers un bucket S3 (Scaleway). Restauration automatique au démarrage si nécessaire.

Schéma initial (simplifié, colonnes en snake_case):
- companies
  - id (uuid, pk)
  - name (text)
  - industry (text)
  - size (text)
  - products (text)
  - processes (text)
  - challenges (text)
  - objectives (text)
  - technologies (text)
  - created_at (timestamptz)
  - updated_at (timestamptz)

- folders
  - id (uuid, pk)
  - name (text)
  - description (text)
  - company_id (uuid, fk → companies.id, nullable)
  - matrix_config (json)   // configuration complète par dossier
  - created_at (timestamptz)

- use_cases
  - id (uuid, pk)
  - folder_id (uuid, fk → folders.id)
  - company_id (uuid, fk → companies.id, nullable)
  - name (text)
  - description (text)
  - process (text)
  - technology (text)
  - deadline (text)
  - contact (text)
  - benefits (json)                // tableau de strings
  - metrics (json)                 // tableau de strings
  - risks (json)                   // tableau de strings
  - next_steps (json)              // tableau de strings
  - sources (json)                 // tableau de strings
  - related_data (json)            // tableau de strings
  - value_scores (json)            // [{ axisId, rating, description }]
  - complexity_scores (json)       // idem
  - total_value_score (real)
  - total_complexity_score (real)
  - created_at (timestamptz)

- settings
  - id (uuid, pk)
  - openai_models (json)
  - prompts (json)
  - generation_limits (json)

- business_config 
  - id (uuid, pk)
  - sectors (json)
  - processes (json)

Notes:
- `matrix_config` est stocké par dossier pour permettre des matrices différentes selon le contexte.
- Indices à prévoir: (folder_id), (company_id). Pour les champs JSON, prévoir des vues matérialisées pour filtres complexes si besoin.


### 2.1) Méthode de calcul des scores (serveur)

Définitions:
- Soit `value_axes = [{ name, weight, level_descriptions? }]` et `complexity_axes = [...]`.
- Soit `value_thresholds = [{ level ∈ {1..5}, points, threshold }, ...]` et `complexity_thresholds = [...]`.
- Chaque cas d’usage possède `value_scores = [{ axisId: name, rating ∈ {1..5}, description }]` et `complexity_scores = [...]`.

Calcul des points par axe:
- Pour chaque axe de valeur `a` avec poids `w_a` et note `r_a`, on récupère `points(r_a)` dans `value_thresholds` (l’entrée où `level = r_a`).
- Contribution axe valeur: `c_a = points(r_a) × w_a`.
- Total valeur: `total_value_score = Σ_a c_a`.

- Pour la complexité, idem: `d_c = points(r_c) × w_c` et `total_complexity_score = Σ_c d_c`.

Niveaux agrégés (1..5):
- On détermine le niveau agrégé en trouvant le plus grand `level` tel que `total_score ≥ threshold(level)` dans le tableau de thresholds correspondant.

Bornes et normalisation (Dashboard):
- `max_possible_value = Σ_a points(level=5) × w_a`.
- `max_possible_complexity = Σ_c points(level=5) × w_c`.
- Normalisation valeur: `value_norm = round(100 × total_value_score / max_possible_value)`.
- Normalisation complexité: `complexity_norm = round(100 × total_complexity_score / max_possible_complexity)`.
- Facilité d’implémentation: `ease = 100 − complexity_norm`.

Remarques d’implémentation API:
- À la création/mise à jour d’un `use_case`, l’API recalcule systématiquement `total_value_score` et `total_complexity_score` à partir des `..._scores` fournis et de la `matrix_config` du dossier.
- En cas de mise à jour de `matrix_config` (poids, thresholds), l’API expose une route de recalcul en masse des cas du dossier.


### 3) API backend (TypeScript) – Contrats

Base: `/api/v1` (Node + TypeScript; framework: Hono ou Fastify; ORM recommandé: Drizzle ou Kysely sur SQLite; migrations intégrées)

Auth OIDC (Google, LinkedIn) sans SSR:
- Flow Authorization Code + PKCE côté backend (endpoints `/auth/{provider}/login`, `/auth/{provider}/callback`).
- Création de session serveur (cookie `HttpOnly`, `Secure`, `SameSite=Lax`), stockage sessions en SQLite.
- Variables requises: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `AUTH_CALLBACK_BASE_URL`.

Endpoints principaux:
- Companies
  - GET `/companies` → list
  - POST `/companies` → create (body = Company sans id)
  - GET `/companies/{id}` → retrieve
  - PUT `/companies/{id}` → update
  - DELETE `/companies/{id}` → delete

- Folders
  - GET `/folders` → list (+ filtre company_id)
  - POST `/folders` → create (name, description, company_id?)
  - GET `/folders/{id}` → retrieve (incl. `matrix_config`)
  - PUT `/folders/{id}` → update (name, description, company_id, matrix_config)
  - DELETE `/folders/{id}` → delete (cascade use_cases)

- Use Cases
  - GET `/use-cases?folder_id=...` → list by folder
  - POST `/use-cases` → create
  - GET `/use-cases/{id}` → retrieve
  - PUT `/use-cases/{id}` → update
  - DELETE `/use-cases/{id}` → delete
  - POST `/use-cases/generate` → génère N cas: body { input, create_new_folder, company_id? } → crée dossier si demandé, appelle OpenAI, stocke cas (recalcul des scores serveur)

- Matrix Config (par dossier)
  - GET `/folders/{id}/matrix` → retourne `matrix_config`
  - PUT `/folders/{id}/matrix` → met à jour `matrix_config` (axes, weights, thresholds, levelDescriptions)

- Settings/Prompts
  - GET `/settings` → config unique (ou multi-profil si besoin)
  - PUT `/settings` → met à jour `prompts`, `openai_models`, `generation_limits`

- Business Config
  - GET `/business-config`
  - PUT `/business-config`

Schémas (Zod/TypeBox) alignés avec les types front, `camelCase` en JSON, `snake_case` en DB.

Règles de calcul:
- Scores recalculés côté serveur conformément à 2.1.
- Endpoints d’agrégation pour le dashboard renvoient directement `value_norm`, `ease`, et bornes max.


### 4) Génération LLM (OpenAI, Node)

Service TypeScript dédié (ex: `api/src/services/openai.ts`):
- `generateFolderNameAndDescription(input, model, company?)`
- `generateUseCaseList(input, model, company?)`
- `generateUseCaseDetail(title, input, matrix_config, model, company?)` → renvoie un JSON strict; l’API valide (Zod), calcule les scores et persiste.

Paramètres: prompts, modèles, limites (retries/file parallèle) stockés en DB (`/settings`). `OPENAI_API_KEY` uniquement côté serveur. Concurrence contrôlée (p-limit) + retries exponentiels.


### 4.1) Prompts et orchestration

Prompts exacts (avec placeholders) — ces textes sont utilisés tels quels côté serveur:

Use case list prompt (clé: `use_case_list_prompt`):
```
Génère une liste de 5 cas d'usage d'IA innovants pour le domaine suivant: {{user_input}}.
Pour chaque cas d'usage, propose un titre court et explicite.
Format: liste numérotée sans description.
```

Use case detail prompt (clé: `use_case_detail_prompt`):
```
Génère un cas d'usage détaillé pour "{{use_case}}" dans le contexte suivant: {{user_input}}. 
Les processus disponibles sont: ${defaultBusinessConfig.processes.map(p => p.name).join(', ')}.
Utilise la matrice valeur/complexité fournie: {{matrix}} pour évaluer chaque axe de valeur et complexité.

La réponse doit impérativement contenir tous les éléments suivants au format JSON:
{
  "name": "{{use_case}}",
  "description": "Description détaillée du cas d'usage sur 5-10 lignes",
  "process": "Le processus d'entreprise concerné (DOIT correspondre à un des processus listés)",
  "technology": "Technologies d'IA à utiliser (NLP, Computer Vision, etc.)",
  "deadline": "Estimation du délai de mise en œuvre (ex: Q3 2025)",
  "contact": "Nom du responsable suggéré",
  "benefits": [
    "Bénéfice 1",
    "Bénéfice 2",
    "Bénéfice 3",
    "Bénéfice 4",
    "Bénéfice 5"
  ],
  "metrics": [
    "KPI ou mesure de succès 1",
    "KPI ou mesure de succès 2",
    "KPI ou mesure de succès 3"
  ],
  "risks": [
    "Risque 1",
    "Risque 2",
    "Risque 3"
  ],
  "nextSteps": [
    "Étape 1",
    "Étape 2",
    "Étape 3",
    "Étape 4"
  ],
  "sources": [
    "Source de données 1",
    "Source de données 2"
  ],
  "relatedData": [
    "Donnée associée 1",
    "Donnée associée 2",
    "Donnée associée 3"
  ],
  "valueScores": [
    {
      "axisId": "Nom du 1er axe de valeur",
      "rating": 4,
      "description": "Justification du score"
    },
    {
      "axisId": "Nom du 2ème axe de valeur",
      "rating": 3,
      "description": "Justification du score"
    }
    // Complète pour les autres axes de valeur présents dans la matrice
  ],
  "complexityScores": [
    {
      "axisId": "Nom du 1er axe de complexité",
      "rating": 2,
      "description": "Justification du score"
    },
    {
      "axisId": "Nom du 2ème axe de complexité",
      "rating": 4,
      "description": "Justification du score"
    }
    // Complète pour les autres axes de complexité présents dans la matrice
  ]
}

IMPORTANT: Réponds UNIQUEMENT avec le JSON, sans texte avant ou après. Veille à ce que chaque axe de la matrice fournie ait bien son score correspondant dans les sections valueScores et complexityScores.
```

Folder name prompt (clé: `folder_name_prompt`):
```
Génère un nom et une brève description pour un dossier qui contiendra des cas d'usage d'IA pour le contexte suivant: {{user_input}}.
Le nom doit être court et représentatif du domaine ou secteur d'activité principal.
La description doit expliquer en 1-2 phrases le contenu du dossier.
Format de réponse en JSON:
{
  "name": "Nom du dossier (4-6 mots max)",
  "description": "Description concise du dossier (20-30 mots max)"
}
```

Company info prompt (clé: `company_info_prompt`):
```
Recherchez et fournissez des informations complètes sur l'entreprise {{company_name}}. 
Les secteurs d'activité disponibles sont: ${defaultBusinessConfig.sectors.map(s => s.name).join(', ')}.
Normalisez le nom de l'entreprise selon son usage officiel.

Retournez les informations UNIQUEMENT au format JSON suivant:
{
  "normalizedName": "Nom normalisé de l'entreprise",
  "industry": "Secteur d'activité (DOIT correspondre à un des secteurs listés)",
  "size": "Taille en nombre d'employés et chiffre d'affaires si disponible",
  "products": "Description détaillée des principaux produits ou services",
  "processes": "Description des processus métier clés",
  "challenges": "Défis principaux auxquels l'entreprise est confrontée actuellement",
  "objectives": "Objectifs stratégiques connus de l'entreprise",
  "technologies": "Technologies ou systèmes d'information déjà utilisés"
}
```

Association prompts ↔ endpoints:
- `/api/v1/use-cases/generate`:
  - Si `create_new_folder=true`: utilise `folder_name_prompt` avec `{ user_input }` → crée dossier.
  - Génère titres avec `use_case_list_prompt` et `{ user_input }`.
  - Pour chaque titre: `use_case_detail_prompt` avec `{ use_case, user_input, matrix }` (et contexte `company` si présent).
  - Validation JSON + calcul des scores + persistance.
- `/api/v1/companies/ai-enrich`: `company_info_prompt` avec `{ company_name }` → renvoie champs enrichis.

Workflow prompts (mermaid):

```
flowchart TD
  A[Home form submit] -->|input, create_new_folder, company_id?| B{create_new_folder?}
  B -- yes --> C[Prompt: folder_name_prompt]
  C --> D[POST /folders]
  B -- no --> D
  D --> E[Prompt: use_case_list_prompt]
  E --> F{N titres}
  F -->|for each| G[Prompt: use_case_detail_prompt]
  G --> H[Validate JSON + Compute scores]
  H --> I[POST /use-cases]
  I --> J[Return summary + IDs]
```

### 5) UI SvelteKit (build statique, i18n FR/EN)

Routing (adapter-static):
- `/` → Index
- `/home` → Home (génération)
- `/dossiers` → Folders
- `/cas-usage` → UseCaseList
- `/cas-usage/[id]` → UseCaseDetail
- `/dashboard` → Dashboard
- `/matrice` → Matrix
- `/entreprises` (+ `/entreprises/[id]`) → Companies
- `/parametres` → Settings
- `/configuration-metier` → BusinessConfiguration
- `+error.svelte` → NotFound

State management:
- Stores Svelte: `companiesStore`, `foldersStore`, `useCasesStore`, `matrixStore`, `settingsStore`, `businessStore`.
- Les stores synchronisent via l’API backend; aucune persistance locale critique. Des caches peuvent exister en `sessionStorage` si besoin UX.

Composants clés:
- Éditeurs (textarea/input) pour tous champs du `UseCaseDetail` avec mise à jour optimiste et sauvegarde sur PUT.
- Tableaux `RatingsTable` pour axes valeur/complexité; binding direct aux stores + recalcul (serveur côté API ou client côté affichage seulement).
- `Matrix` page: formulaires poids/thresholds, dialogue d’édition des descriptions de niveaux.
- `Dashboard`: graphiques (Recharts → alternatives Svelte: `layercake`, `apexcharts` svelte, ou `recharts` via wrapper si nécessaire); le backend peut fournir des données pré-normalisées.


### 6) DevOps & Outillage (Docker, Make, CI/CD, Litestream)

Structure de repo (inspirée `nc-fullstack`):
- `/ui` (SvelteKit)
- `/api` (TypeScript: Hono/Fastify)
- `Makefile` à la racine avec cibles: `make build`, `make test`, `make lint`, `make up`, `make down`, `make deploy-ui`, `make deploy-api`.
- `docker-compose.yml` dev local: services `ui`, `api`, `sqlite` (volume), `litestream` (sidecar) avec réplication vers S3.
- `Dockerfile` séparés `ui/` et `api/` (prod-ready, multi-stage build). L’API intègre Litestream (sidecar ou process séparé) en prod.
- `.github/workflows/ci.yml` + `deploy.yml`: exécutent `make build`/`test` et `make deploy-*`.
- Déploiement:
  - UI: build statique SvelteKit → publication GitHub Pages.
  - API: build image → push Scaleway Container Registry → déploiement Container PaaS (SCW_*). Volume persistant pour `app.db` + Litestream configuré pour backup S3 (`S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`, `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`).

Variables/Secrets CI:
- `OPENAI_API_KEY` (secret)
- `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `SCW_DEFAULT_ORGANIZATION_ID`, `SCW_DEFAULT_PROJECT_ID`, `SCW_NAMESPACE_ID` (secrets)
 - `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION` (secrets)


### 7) Décisions actées

1. Authentification/ACL: OIDC Google et LinkedIn. Sessions serveur en cookie HttpOnly.
2. Scores: calcul strictement côté serveur (source de vérité) selon 2.1.
3. OpenAI: gestion de quotas, retries exponentiels, limite de parallélisme configurable.
4. Historisation: versionner `matrix_config`, `use_cases` (timestamps, journaux d’audit), conserver les prompts utilisés.
5. Observabilité: logs structurés, tracing minimal, métriques basiques. Intégration Scaleway Logs possible.
6. Supabase: supprimer toute référence et code associé (intégration retirée).
7. Dashboard: endpoints d’agrégation dédiés (pré-normalisés) côté API.
8. i18n: FR + EN via `svelte-i18n`. FR par défaut.
9. Pas de SSR: build statique (ultra low-cost). UI = GitHub Pages.


### 8) Plan d’exécution (itératif, « one-shot codex friendly »)

Étape 0 – Scaffolding
- Créer structure: `/ui` (SvelteKit + adapter-static + svelte-i18n), `/api` (TS Hono/Fastify + Drizzle/Kysely + Zod), `Makefile`, `docker-compose.yml`, `Dockerfile.ui`, `Dockerfile.api`, `.github/workflows/*`, `data/` (montage volume), config Litestream (`/api/litestream.yml`).

Étape 1 – Données & API
- Schéma SQLite (migrations Drizzle/Kysely).
- CRUD: companies, folders (+ matrix_config), use_cases, settings, business_config.
- Génération OpenAI (list/detail/folder) + `/use-cases/generate` (validation Zod, recalcul des scores).
- Auth OIDC Google/LinkedIn (login/callback, sessions cookies).
- Agrégations Dashboard pré-normalisées.

Étape 2 – UI SvelteKit
- Implémenter pages et navigation, stores et appels API.
- Écrans: `Home`, `Folders`, `UseCaseList`, `UseCaseDetail`, `Matrix`, `Dashboard`, `Companies`, `Settings`, `BusinessConfiguration`, `NotFound`.
- i18n FR/EN pour libellés UI.

Étape 3 – Qualité/CI/CD
- Tests unitaires API (Vitest/Jest), schéma OpenAPI auto, lint (eslint/prettier), e2e léger (Playwright).
- GitHub Actions: `make build test`, `make deploy-ui`, `make deploy-api`.

Étape 4 – Durcissement
- Politique gouvernance LLM, observabilité, optimisation coût/perf.


### 9) Schéma d’architecture (README)

À ajouter dans `README.md` en Mermaid, p.ex.:
```
flowchart LR
  User((Browser)) -- UI --> SvelteKit
  SvelteKit -- REST/JSON --> API_TS
  API_TS -- SQLite file --> app.db
  API_TS -- Litestream --> S3(Scaleway Object Storage)
  API_TS -- HTTPS --> OpenAI
  CI(CI GitHub Actions) -- deploy --> GH_Pages & Scaleway
```


### 10) Critères d’acceptation

- Génération de cas (liste et détails) via OpenAI, avec validation stricte JSON côté API.
- Calculs de scores et niveaux effectués côté serveur (voir 2.1), endpoints d’agrégation fournis.
- CRUD complet: entreprises, dossiers (avec `matrix_config`), cas d’usage, settings, business config.
- UI complète SvelteKit (pages listées), i18n FR/EN, build statique, appels API sécurisés.
- Auth Google/LinkedIn opérationnelle (sessions cookies HttpOnly).
- SQLite persistant + Litestream configuré vers S3 (Scaleway), restauration validée.
- CI/CD GitHub Actions: build/test et déploiements (UI GitHub Pages, API Scaleway Container).


### 11) Check-list de mise en place

- [ ] Structure repo `/ui`, `/api`, Makefile, Dockerfiles, docker-compose
- [ ] Schéma SQLite + migrations (Drizzle/Kysely) appliqués
- [ ] API TypeScript (Hono/Fastify) avec schémas Zod, OpenAPI généré
- [ ] Service OpenAI (Node) et endpoint `/use-cases/generate`
- [ ] Calculs serveur et endpoints d’agrégation Dashboard
- [ ] UI SvelteKit pages et stores, i18n FR/EN
- [ ] Auth Google/LinkedIn, sessions cookies HttpOnly
- [ ] Litestream config S3 (Scaleway) validée (backup/restore)
- [ ] CI GitHub Actions (build/test/deploy) OK
- [ ] Déploiements: UI (GitHub Pages), API (Scaleway Container)


### 12) Règles MDC: tests, Make targets, sécurité, cycle de vie composants, workflow Git/IA

Source de référence: [règles .cursor MDC](https://github.com/rhanka/assistant/tree/main/.cursor/rules). Les items ci-dessous reprennent la majorité des règles et cibles prescrites, adaptées au contexte Svelte + API TypeScript + SQLite.

12.1 Pyramide de tests et exigences
- Couches et objectifs
  - Unitaires UI (Svelte) et API (services, handlers): rapides, isolés, mocking strict des I/O.
  - Intégration API: routes réelles → SQLite test, migrations appliquées en setup, rollback par test.
  - Contrats: validation OpenAPI (schéma), compat UI ↔ API (génération client, types stricts).
  - E2E (Playwright): parcours critiques; headless par défaut; artefacts (traces, vidéos) en CI.
  - Charge (k6) et smoke (rapides) sur endpoints critiques et LLM mock.
- Seuils et blocages CI
  - Lint + typecheck + unit + intégration requis pour merge.
  - Couverture minimale: API ≥ 80%, UI ≥ 70%. Rapport Cobertura/LCOV publié.
  - E2E obligatoires sur branches release et main; optionnels sur petites PR.

12.2 Cibles Make – exhaustives

Build & qualité
```
make install            # installe deps via Docker (no local install)
make build              # build global (ui+api)
make build-ui           # build SvelteKit (adapter-static)
make build-api          # build API TypeScript (tsc) + bundle si besoin
make typecheck          # typecheck global
make typecheck-ui       # typecheck UI
make typecheck-api      # typecheck API
make lint               # lint global
make lint-ui            # lint UI
make lint-api           # lint API
make format             # format write
make format-check       # format check
make audit              # audit deps (UI+API)
```

Tests
```
make test               # tests unit+int agrégés
make test-ui            # tests unit Svelte
make test-api           # tests unit API
make test-int           # tests intégration API
make test-contract      # contrats OpenAPI + client-gen vérifiés
make test-e2e           # Playwright
make test-smoke         # smoke suite rapide
make test-load          # k6 (mock LLM)
make coverage           # calcule couverture
make coverage-report    # génère rapports HTML/LCOV
```

Dev & exécution locale (Docker Compose)
```
make dev                # up + logs suiveurs
make dev-ui             # UI seule
make dev-api            # API seule
make up                 # docker compose up -d
make down               # docker compose down -v
make logs               # logs agrégés
make sh-ui              # shell conteneur UI
make sh-api             # shell conteneur API
```

Base de données & migrations (SQLite via Drizzle/Kysely)
```
make db-generate        # génère migrations
make db-migrate         # applique migrations
make db-reset           # drop/create + migrate
make db-seed            # jeux de données de démo/tests
make db-lint            # lint schéma (conventions, noms snake_case)
```

OpenAPI, client et docs
```
make openapi-json       # export openapi.json
make openapi-html       # doc HTML (redoc/swagger)
make client-gen         # génère client TS côté UI à partir d’OpenAPI
```

LLM/Prompts (IA)
```
make prompts-lint       # placeholders requis présents, format strict
make prompts-test       # snapshots JSON (mock LLM) non-régression
make prompts-freeze     # fige prompts (versioning + checksum)
make prompts-diff       # compare prompts vs version précédente
make prompts-doc        # génère doc à partir des prompts (md)
```

Sécurité & conformité
```
make sast               # analyse statique (Semgrep/ESLint ruleset sécurité)
make secrets-scan       # détection secrets
make sbom               # génère SBOM (syft)
make license-check      # conformité licences deps
make dast               # scan DAST (ZAP) sur env de test
```

Docker & déploiements
```
make docker-build       # construit images ui/api
make docker-push        # push vers registre (Scaleway)
make deploy-ui          # publie UI sur GitHub Pages
make deploy-api         # déploie API sur Scaleway Container
make release            # release orchestrée (tag, changelog)
make tag                # génère tag version
make version-bump       # bump version (semver)
```

12.3 Sécurité (consolidée)
- Secrets & config: jamais côté client; variables via CI/CD et compose; rotation planifiée.
- Sessions cookies: `HttpOnly`, `Secure`, `SameSite=Lax`; durée limitée; invalidation logout.
- OIDC (Google/LinkedIn): code+PKCE; limiter scopes; anti-rejeu; stockage sessions côté SQLite.
- CORS: origines whitelist (Pages); headers sécurité (CSP, Referrer-Policy, X-Content-Type-Options, etc.).
- Validation stricte Zod; sanitation; paginations/limites; rate-limit endpoints sensibles.
- Logs sans PII; traçage corrélé requête; retention contrôlée.
- Supply chain: audit, SAST, secret scan, SBOM, licences.

12.4 Cycle de vie des composants Svelte (MDC)
- Règles de hooks
  - `onMount`: idempotent; annulation via `AbortController`; pas de longue logique – déplacer en services/stores.
  - `beforeUpdate/afterUpdate`: éviter side-effects lourds; préférer stores dérivés (`derived`).
  - `onDestroy`: cleanup complet (subscriptions, timers, listeners, fetch en cours).
- Stores & dérivations
  - Un store “source de vérité” par domaine; dérivés pour calcul; pas de duplication d’état.
  - Éviter les `subscribe` manuels dans composants – préférer `$store` réactif; si `subscribe` => unsubscribe en `onDestroy`.
- Accessibilité & i18n
  - i18n FR/EN via `svelte-i18n`; clés stables; chargement lazy des bundles; ARIA et navigation clavier.
- Erreurs & UX
  - Placeholders de chargement; repli “empty state”; toasts non verbeux; redirections contrôlées.

12.5 Workflow Git/IA (basé MDC)
- Branching & conventions
  - Branches: `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`, `perf/*`, `ai/*`.
  - Commits: Conventional Commits; tag `AI:` si change prompt/modèle.
- PR Checklist (extraits obligatoires)
  - Changements prompts ? (diff inclus) – oui/non
  - Modèles/paramètres LLM modifiés ? – oui/non
  - Couverture ok ? (seuils ci-dessus) – oui/non
  - Tests prompts (snapshots) passés ? – oui/non
  - Impacts sécurité (secrets, scopes OIDC, CORS) ? – oui/non
- CI Pipeline (gates)
  - Lint → Typecheck → Unit (ui/api) → Int (api) → Contract → Prompts-lint/test → E2E (sélectif) → Security (sast/secrets) → Build images → Deploy (sur main/release).

Workflow Git/IA (mermaid)
```
flowchart TD
  A[feature/*, ai/*] --> B[PR]
  B --> C[CI: lint + typecheck + unit + int + contract]
  C --> D[prompts-lint + prompts-test]
  D --> E[e2e (selon label)]
  E --> F[security: sast + secrets + sbom]
  F -->|all green| G[review]
  G -->|approve| H[merge]
  H --> I[build images]
  I --> J[deploy ui/pages + api/scw]
```


