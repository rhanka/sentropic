# TODO - Top AI Ideas

## Check-list de mise en place

**✅ Terminé :**
- [x] Structure repo `/ui`, `/api`, Makefile, Dockerfiles, docker-compose
- [x] Schéma SQL + migrations (Drizzle) appliqués
- [x] API TypeScript (Hono) avec schémas Zod, OpenAPI généré
- [x] Service OpenAI (Node) et endpoint `/use-cases/generate`
- [x] Calculs serveur et endpoints d'agrégation Dashboard
- [x] UI SvelteKit pages et stores, i18n FR/EN
- [x] Système de queue PostgreSQL avec QueueManager
- [x] Compléter les tests unitaires (121 tests API)
- [x] Compléter les tests E2E (91/101 tests Playwright)
- [x] CI GitHub Actions (build/test/deploy)
- [x] Migration SQLite → PostgreSQL 16
- [x] Déploiements: UI (GitHub Pages), API (Scaleway Container)
- [x] Fix UI deployment (api url harcoding > VITE_API_BASE_URL)
- [x] Fix CORS - enable front from *.sent-tech.ca and localhost
- [x] Fix 404 enterprises/[id] path in production
- [x] Auth Webauth with mail chck + minimal RBAC
- [x] Usecase UI: card with headers/footer, model tag, citations
- [x] Améliorer Dashboard en tant que synthèse exécutive
  - [x] ajouter une zone de ROI (top left quadrant, vert, to be discussed)
  - [x] le graphique devrait remplir max 50% de l'écran, et devrait être plus haut
  - [x] le label du cas doit être inscrit sans hover, et au hover la description doit être affichée, valeur complexité et non le statut
  - [x] ajouter un prompt pour synthèse exécutive de l'ensemble des cas : introduction incluant description du dossier et enjeux de l'entreprise, une analyse générale présentant une mise en exergue les tops cas - format à challenger / discuter
  - [x] Génération d'un rapport reprenant synthèse exécutive et dashboard et l'ensemble des cas (une page par cas ?)
- [x] Séparer dans la génération la description en: description (plus courte), problème, solution
- [x] Fixer les cibles make pour linting et de typecheck puis les appliqur progressivement, cible par cible en faisant un plan
- [x] Chatbot Lot A — Mise à jour ciblée d'un objet ✅ Fonctionnellement fini (cf. spec/SPEC_CHATBOT.md)
  - [x] API : POST `/api/v1/chat/messages` + SSE global
  - [x] Tools : `read_usecase`, `update_usecase_field`, `web_search`, `web_extract`
  - [x] UI : `ChatWidget`, `ChatPanel`, `StreamMessage`
  - [x] Détection automatique du contexte depuis la route
  - [x] Tests unitaires et d'intégration
  - [x] Tests E2E Playwright
  - [x] Extension aux autres objets (folder, company, executive_summary)
  - [x] Tool calls parallèles fonctionnels (boucle itérative dans `runAssistantGeneration`)
  - [x] Affichage des tool calls dans `StreamMessage` (accordéon par tool_call_id)
  - [x] Générations classiques streamées via `chat_stream_events` (message_id null)
  - [x] Snapshots `snapshot_before` et `snapshot_after` dans `chat_contexts` (infrastructure prête)
  - [x] Resync SSE fonctionnel (via `historySource` et endpoints batch)
- [x] Ajouter une fonction de validation des droits utilisateurs, avec un des profils. Ce profil doit permettre d'avoir accès à toutes les fonctions sans limite d'usage. Mais il n'a accès qu'à ses propres artefacts
- [x] Licence
- [x] Chatbot lot B1
  - [x] améliorer la responsiveness du widget flottant (bulle unique Chat/Queue + panneau)
    - [x] gérer mobile (panneau plein écran / bottom-sheet)
    - [x] gérer desktop (tailles max + scroll internes stables, pas de débordement, possibilité de basculer en panel)
    - [x] accessibilité (focus trap, ESC, aria, navigation clavier)
  - [x] chat / gérer le streaming "markdown" cf spec/MARKDOWN_STREAMING.md
- [x] Utiliser une lib d'icones digne de ce nom (@lucide/svelte)
- [x] Ajouter GPT 5.2
- [x] UI Fix streaming (change postgres prod + update stream for local mode)
- [x] Améliorer la vue cas d'usage
  - [x] Afficher le nom du dossier (branche: `feat/usecase-show-folder-organization`)
  - [x] Afficher l'entreprise (branche: `feat/usecase-show-folder-organization`)
  - [x] UI Fix post stream 'blink' (when message finished in chat) (branche: `feat/usecase-show-folder-organization`)
- [x] **Chatbot Lot B — Contexte documentaire (ingestion + résumé + consultation)** (cf. spec/SPEC_CHATBOT.md - source de vérité)
  - [x] API : POST `/api/documents` (upload) ; GET `/api/documents` (liste) ; GET `/api/documents/:id` (meta+résumé) ; GET `/api/documents/:id/content` (download)
  - [x] Job queue "document_summary" déclenché à l'upload ; statut dans `context_documents` ; events `document_added` / `document_summarized`
  - [x] Tables `context_documents` (+ option `context_document_versions`) ; stockage S3/MinIO
  - [x] UI : Bloc "Documents" dans les pages objets (dossiers, cas d'usage, organization) : upload, liste, statut, résumé
  - **Couverture CU** : CU-022
- [x] Fix: le refresh dans github pages (CTRL+R) des pages cas-usage|entreprise/[id] génère un 404 (c'est une régression)
- [x] Fix: Dans matrix, le nombre de cas n'est pas décompté (nombre par seuil de valeur pour configuration des seuils de valeur et complexité).
- [x] Feat: Dans matrice, il faut pouvoir ajouter et supprimer des axes de valeur complexité
- [x] Feat: dans EditableInput, pour les input markdown, mettre en exergue les champs édités avec un point orange (comme les inputs normaux) + hover avec bord gauche en gris
- [x] Feat: dans les fiches entreprise (vue /entreprises), tronquet taille au meme nombre de caractères que produits et services (...)
- [x] Fix: NavigationGuard: sauver automatiquement, tout simplement !
- [x] Fix webauthn : in prod web auth is both ok for register and login, but in localhost for dev, webauthn is ok for register but not for login with a smartphone (à retravailler)
- [x] Chatbot lot B2
  - [x] Feedback utilisateur (👍/👎) sur les suggestions
  - [x] icones sous le chat utilisateurs (visibles au hover sur la bulle de chat ou les icones)
    - [x] Modification d'un message utilisateur
      - [x] Propose l'annulation des modifications effectuées dans le chat (objets édités le cas échéant depuis le point du chat) ou de les garder (rollback) 
    - [x] Retry d'un message utilisateur (supprime la suite déjà effectuée) (idem propose annulation ou pas)
    - [x] Copie d'un message utilisateur
  - [x] icones soue le chat de réponse 
    - [x] Copie d'une réponse (visibles au hover sur la bulle de chat ou les icones)
  - [x] Amélioration de la bulle d'input utlisateur
    - [x] Mode monoligne
      - [x] Le texte (input est centré verticalement)
      - [x] Ajouter un + à gauche pour un pop up de menu
        - [x] Ajout d'upload de document dans la session de chat (trombone)
          - [x] Résumé automatique (court, long le cas échéant) pour attacher à la session
          - [x] Quand un doc est attaché à la session, le doc tool va pouvoir consultr le ou les docs de la session
        - [x] Liste (checkable) des tools et contextes de la session
          - [x] Ajout d'un mode multi contexte (lorsqu'on change de vue: les objets s'ajoutent) (les dernier objet est prioritaire dans l'activation des outils)
          - [x] Les contextes et tools sont listés et activables / désactivables dans le menu
    - [x] Mode multiligne
      - [x] Lorsqu'il y a plus d'une ligne, la hauteur de l'input s'étend automatiquement t maximum jusqu'à 30% de la hauteur de la box
      - [x] L'input est basculé sur Tiptap markdown (pas editableInput) pour permettre les copiers coller rich text
- [x] Collaboration part 1
  - [x] Share workspace
    - [x] User can create additionnal workspaces (in param) and is granted admin of it
    - [x] User can delete any of the workspace which he admins
    - [x] User can provide access to any other user to any of the workspace with admin rights : he provides readonly or editor or admin access
  - [x] Object editions
    - [x] When an editor (or admin) is first on a view/object, he puts a locker on dit and can only edit
    - [x] When an other editor is on it, the view is locker
    - [x] Other viewer or locked editor is on the view, he recieves updates through sse
    - [x] When a view is locked to an edit user, the UI ask to unlock It async. He recieves the answer through sse.
    - [x] When the API recieves an unlock demand, it refuses directly if another demand is already processing. Else it sends through sse to the current editor with the locker a demand.
    - [x] No timeout, no explicit refuse; request cleared when locker leaves; accept transfers lock to the requester.
- [x] Entreprise >> Organisation
  - [x] Renommer entreprise(s) / company.ies en organisation / organizations en profondeur (modèle de donnée, api, écrans).
  - [x] En profiter pour migrer vers data les données de l'entreprise
  - [x] Ajouter les références à la génération
  - [x] Ajoutr une section d'indicateurs de performance (sectoriel et spécifiques à l'entreprise)

**⏳ À faire :**
- [ ] Pivoter vers langchain (multi model provider, easier agentic / tools orchestration)
- [ ] Versionner les prompts du chat et les rendre accessible à configuration dans l'UI
- [ ] Choisir le modele GPT par prompt
- [ ] Citations objets et liens iconifiés dans le chat
- [ ] Générations: ajouter une génération pour adapter la matrice en fonction de l'entreprise, lors de la génération d'un dossier. Une matrice sera instanciée pour l'entreprise. Lorsque la génération a lieu, la matrice est stockée en template par défaut pour l'entreprise. Si un nouveau dossier est généré pour l'entreprise, par défaut il reprendra cette matrice sans nouvelle génération. Une option à la génération du dossier sera proposée pour générer une matrice spécifique au dossier (ex quand on regarde un processus spécifique comme le marketing pour l'entreprise). Les matrices seront alors attachées à l'organisation et sélectionnables lors de la génération du dossier.
- [ ] Remplacer Tavily par DataForSeo + Jina
- [ ] Enable to stop AI response in chat
- Design system
  - [ ] Créer un mdc pour le design system
  - [ ] Normaliser les couleurs primary des boutons
- API & UI Refacto
  - [ ] Handle all objects (use case, folders and orgs) as type object in one table, relations being and applicative driven relation (still relying on self join) and having easier modeling of generic configuration of prompts related to objects
  - [ ] Mutualize heavily context-generations based on lanchain workflows making wor
- [ ] Collaboration part 2
    - [ ] Fonction d'import / export de workspace (zip json + doc le cas échéant, extension topw)
    - [ ] Fonction d'import / export de dossier (zip jsons + docs le cas échéant, extension topf)
    - [ ] Fonction d'import / export de usecase(s) et organisation(s) (zip json + docs le cas échéant, extensions topu et topo)
  - [ ] Comments
    - [ ] Each object and data part of object can have on or many comments
    - [ ] There is a table of comments
    - [ ] A comment can have many consecutive answers (themselves are in the comments table), but there is only one level of answer (no sub answers)
    - [ ] A comment can be attributed to a user using @ (auto complete with users of the workspace).
    - [ ] If no attribution, the user is the initial comment creator
    - [ ] Each comment can be "closed" by the last attributed user
    - [ ] Comments are visible on the header on the card of the data part
    - [ ] Options d'export : avec ou sans commentaire
- [ ] chat / json
  - [ ] ajouter le rendu de résultat des tools et l'historiser
  - [ ] gérer le streaming json (sortie de réponse, entree et sortie de tool même si ce dernier est en bloc) avec la complexité cf spec/MARKDOWN_STREAMING.md
- [ ] **Chatbot Lot C — Tool-calls parallèles et appels structurés** (cf. spec/SPEC_CHATBOT.md - source de vérité)
  - [ ] Table `structured_generation_runs` pour traçabilité complète
  - [ ] Tables `prompts`/`prompt_versions` pour versioning des prompts
  - [ ] Endpoint POST `/api/structured/:prompt_id` pour appels structurés dédiés
  - [ ] Annulation via queue (PATCH `/api/structured/:run_id/cancel`)
  - [ ] Multi-contexte dans une session (plusieurs objets)
  - [ ] Tests : Unit/int/E2E pour appels structurés parallèles, annulation
  - **Couverture CU** : CU-008 (finalisation), CU-011 (annulation), CU-012 (multi-contexte), CU-019 (annulation queue)
- [ ] **Chatbot Lot D — Audit, diff et résilience** (cf. spec/SPEC_CHATBOT.md - source de vérité)
  - [ ] Composant `DiffViewer` pour afficher les différences avant/après
  - [ ] Rollback via snapshots (API + UI)
  - [ ] Onglet "Historique" dans les vues objets (folder, use case, company)
  - [ ] Liste des sessions ayant modifié l'objet
  - [ ] Preview des modifications avant application (diff visuel)
  - [ ] Confirmation explicite avant d'appliquer une modification (bouton "Appliquer")
  - [ ] Gestion du contexte long (limite tokens, résumé automatique)
  - [ ] Tests : Unit/int/E2E pour diff/rollback, reprise SSE
  - **Couverture CU** : CU-011 (rollback), CU-016 (onglet Historique), CU-017 (contexte long), CU-018 (validation/confirmation)
- [ ] **Chatbot Lot E — Robustesse + fonctionnalités avancées** (cf. spec/SPEC_CHATBOT.md - source de vérité)
  - [ ] Switch de modèle dans les sessions (UI + API)
  - [ ] Approfondissement avec modèle supérieur
  - [ ] Création d'objets via chat (tools)
  - [ ] Export et partage (JSON, Markdown, PDF)
  - [ ] Retry automatique avec correction pour erreurs récupérables
  - [ ] Suggestions et recommandations (IA proactive)
  - [ ] Extension voix : stub `audio_chunk` (type d'événement) côté SSE
  - [ ] Tests : Unit/int/E2E couvrant un flux complet (chat + structured + tool-calls + rollback)
  - **Couverture CU** : CU-006 (switch modèle), CU-007 (approfondissement), CU-009 (création objets), CU-013 (suggestions), CU-014 (export/partage), CU-017 (contexte long), CU-020 (feedback), CU-021 (gestion erreurs améliorée)
- [ ] Fonctions de désactivation de dossier / cas d'usage / entreprise, de partage entre utilisateurs, de publication (publique)
- [ ] Gestion des profils freemium / payant: gestion du nombre d'enrichissements / utilisateur / type de modèle
- [ ] Mise en place poker planning
- [ ] Ajouter un tool de recherche de brevets (Lens API)
- [ ] Implement security tests and add it in CI
- [ ] Backups automatisés PostgreSQL (externalisation sur S3)
- [ ] Mise en place de paiements
- [ ] Ré-activer et corriger les 2 tests E2E entreprises (création + bouton IA)
  - Raison du skip: `EditableInput` avec auto-save (5s) et enrichissement IA parfois >30s
  - Action: adapter le test pour attendre la fin d'auto-save et stabiliser l'enrichissement


## Éléments identifiés pour implémentation future (lors du linting)

- [ ] **Implémenter le système de refresh tokens**
  - Activer `REFRESH_DURATION` (30 jours) et `refreshExpiresAt` dans `session-manager.ts`
  - Ajouter endpoint pour rafraîchir les tokens
  - Gérer la rotation des refresh tokens

- [ ] **Utiliser `credentialBackedUp` pour la gestion des devices**
  - Activer la vérification si un device est sauvegardé (backup)
  - Utiliser pour améliorer la gestion des credentials WebAuthn
  - Fichier: `api/src/services/webauthn-registration.ts`

- [ ] **Réactiver l'enrichissement asynchrone des entreprises**
  - Activer la fonction `enrichCompanyAsync` dans `api/src/routes/api/companies.ts`
  - Utiliser la queue pour les enrichissements longs
  - Actuellement commentée car non utilisée

- [ ] **Réactiver le prompt de nom de dossier**
  - Activer `folderNamePrompt` dans `api/src/routes/api/use-cases.ts`
  - Utiliser pour générer automatiquement les noms de dossiers
  - Actuellement commenté car non utilisé

- [ ] **Réactiver la fonction `parseExecutiveSummary`**
  - Activer dans `api/src/routes/api/folders.ts` si nécessaire
  - Utiliser pour parser les synthèses exécutives stockées
  - Actuellement commentée car non utilisée

- [ ] **Implémenter l'annulation réelle des jobs dans la queue**
  - Actuellement juste un TODO dans `api/src/routes/api/queue.ts`
  - Nécessite d'interrompre réellement un job en cours d'exécution
  - Utiliser les AbortController déjà présents dans QueueManager

- [ ] **Normaliser l'incohérence titre/name/nom pour les UseCase**
  - **Problème identifié** : Incohérence dans le flux de données entre prompt/API/DB/UI
    - Prompt génère `"titre"` (français) dans `default-prompts.ts:69`
    - Interface API utilise `titre: string` dans `context-usecase.ts:6`
    - Conversion `titre` → `name` dans `queue-manager.ts:328-330`
    - Stockage final utilise `name` (anglais) dans `UseCaseData`
    - Code UI cherche encore `titre` ou `nom` dans `dashboard/+page.svelte:937`
  - **Actions à faire** :
    1. Vérifier si le prompt doit générer `"name"` au lieu de `"titre"` pour cohérence
    2. Vérifier le schéma Zod côté API pour validation
    3. Normaliser sur `name` partout OU documenter la rétrocompatibilité
    4. Supprimer les fallbacks `(useCase as any)?.titre || (useCase as any)?.nom` si plus nécessaires
    5. Mettre à jour l'interface `UseCaseListItem` si nécessaire

