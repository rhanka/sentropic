# Feature: Dashboard Executive Summary Enhancement

## Objective
Transform the dashboard into an executive summary view with improved visualization, ROI quadrant (relative to medians), executive summary generation (automatic after use case completion), and print-ready report with CSS.

## Scope
- **UI Changes**: Dashboard layout, scatter plot improvements, ROI quadrant, executive summary section, dashboard configuration accordion
- **API Changes**: New endpoint for executive summary generation (AI-powered), automatic generation after use case completion
- **Data Storage**: Executive summary stored in database (folders table), dashboard config in localStorage initially
- **No Breaking Changes**: Existing functionality remains intact

## Plan / Todo

### Phase 1: UI Improvements (Scatter Plot & Layout)
- [x] **Task 1.1**: Adjust scatter plot to max 50% screen width and increase height
  - Modify `UseCaseScatterPlot.svelte` component styling
  - Update container classes to limit width (max 50%) and increase height
  - Test responsive behavior

- [x] **Task 1.2**: Display use case labels directly on scatter plot (no hover required)
  - Modify Chart.js configuration to show labels by default
  - Adjust label positioning to avoid overlaps
  - Ensure labels are readable

- [x] **Task 1.3**: Update tooltip to show description, value, and complexity (not status)
  - Modify tooltip callbacks in `UseCaseScatterPlot.svelte`
  - Display: description, value score, complexity score
  - Remove status from tooltip

### Phase 2: ROI Quadrant (Relative to Medians)
- [x] **Task 2.1**: Calculate medians for value and complexity scores
  - Calculate median value score from all use cases
  - Calculate median complexity score from all use cases
  - Only display quadrant if > 2 use cases exist

- [x] **Task 2.2**: Add ROI quadrant visualization (top-left quadrant, green)
  - Design ROI quadrant overlay on scatter plot (value > median, complexity < median)
  - Identify use cases in ROI quadrant (high value, low complexity)
  - Add visual indicator (green background/shading) for ROI quadrant
  - Hide quadrant if ≤ 2 use cases

- [x] **Task 2.3**: Add ROI statistics card
  - Create new KPI card showing count of use cases in ROI quadrant
  - Display average value and complexity for ROI quadrant
  - Position in dashboard layout

- [x] **Task 2.4**: Create dashboard configuration accordion
  - Add accordion component in top-right corner of scatter plot container with gear icon (⚙️)
  - Store configuration in localStorage (initialized to median values)
  - Allow configuration of ROI quadrant boundaries (value/complexity thresholds)
  - Configuration will be stored in backend later (not in this phase)
  - Accordéon déplacé du composant scatter plot vers le dashboard pour meilleure séparation des responsabilités

### Phase 3: Executive Summary Generation
- [x] **Task 3.1**: Add executive summary prompt to default-prompts.ts
  - Create prompt template with 4 markdown sections:
    - Introduction
    - Analyse
    - Recommandation (including prochaines étapes)
    - Synthèse exécutive
  - Prompt takes: use cases, company info (if available), folder info, top cases (list of priority use case names)
  - Top cases are provided as input (calculated by API using ROI quadrant thresholds or medians)
  - Return JSON with 4 markdown sections (top_cas removed from output, provided as input)

- [x] **Task 3.2**: Create API endpoint for executive summary generation
  - New endpoint: `POST /api/v1/analytics/executive-summary`
  - Input: `folder_id`, optional `value_threshold`, `complexity_threshold`, `model`
  - Queue job instead of direct generation (asynchronous processing)
  - Update folder status to 'generating' when job is queued
  - Return jobId and status immediately
  - Fetch folder description, company context, and all use cases
  - Calculate top cases (use cases in ROI quadrant: value >= threshold AND complexity <= threshold)
  - Use custom thresholds if provided, otherwise use medians
  - Format top cases as list of use case names
  - Generate prompt for OpenAI with all context (including top cases)
  - Return JSON with 4 markdown sections
  - Store result in database (folders table - new field `executive_summary`)

- [x] **Task 3.3**: Add database field for executive summary
  - Add `executive_summary` JSON field to folders table (migration)
  - Store JSON with 4 sections: { introduction, analyse, recommandation, synthese_executive }

- [x] **Task 3.4**: Integrate automatic generation after use case completion
  - Modify `QueueManager.processUseCaseDetail` to check if all use cases are completed
  - When all use cases completed, automatically trigger executive summary generation
  - Add new job type: `executive_summary` to queue
  - Update folder status to show executive summary generation in progress

- [x] **Task 3.5**: Add executive summary display in Dashboard
  - Integrate executive summary sections directly in `dashboard/+page.svelte` (no separate component)
  - Display sections in order: Synthèse exécutive FIRST, then Dashboard (scatter plot), then Introduction/Analyse/Recommandations
  - Fetch executive summary from folder data (stored in `folders.executiveSummary` JSON field)
  - Show loading state when generating (check folder status === 'generating')
  - Add manual "Generate Summary" and "Régénérer" buttons
  - Parse and render markdown sections using existing markdown rendering (marked library)
  - Add markdown styling for h2, h3, ul, ol, li elements
  - Parse citations [1], [2] with links to references section
  - Add References section at the end using References.svelte component
  - Automatic refresh monitoring for job status (every 2s when generating)
  - Hide Introduction/Analyse/Recommandations sections during generation
  - Add responsive margins (px-4 md:px-8 lg:px-16 xl:px-24 2xl:px-32) for document-like layout

### Phase 4: Print Report Generation (CSS-based)
- [x] **Task 4.1**: Print CSS styling and layout
  - Complete print CSS with @page rules for cover and annex pages
  - Page de garde with background image and executive summary
  - Table of contents with dynamic page numbers
  - One page per use case with footer image
  - Proper page breaks and margins

- [x] **Task 4.2**: Fix print layout issues
  - Fix layout-bottom 50/50 grid (switched to flexbox)
  - Fix annex margins (0.6cm padding on containers, 0 margin on @page)
  - Fix overflow issues for axes sections
  - Unify structure between dashboard and individual view

- [x] **Task 4.3**: Dynamic content scaling
  - Scaling for references (base 8), data sources (base 5), data objects (base 5), technologies (base 7)
  - Aggressive scaling for executive summary with margin reduction
  - Proportional font-size, line-height, gap, and icon scaling

- [x] **Task 4.4**: Page numbering and structure
  - Dynamic page number calculation based on section heights
  - Simplified calculation: each use case = 1 page exactly
  - Footer image for use case pages with gradient overlay
  - Complete print structure: cover, summary, TOC, sections, annexes

### Phase 5: Testing & Validation
- [x] **Task 5.0**: UAT
  - [x] debug heavy priorisation chart: add weight 2000 to avoid labels to go out of the chart
  - [x] decorrelate waiting data and simulated annealing: first render chart without labels, then add labels after simulation
  - [x] debug reg in cover pages (backround image + filter not in the right place)
  - [x] add print button in dashboard
  - [x] bug -0.6cm in usecase printed in annex after 1st use case
  - [x] add back cover page
  - [x] fix bug: don't display usecase in dashboard view in display (non print) mode
  - [x] Introduction (dans dashboard) devrait avoir un style de carte (en mode non impression), comme synthèse exécutive, analyse et recommandation
  - [x] Reduit les espacement entre paragraphes, li, et titres pour faire tenir chacune des section Analyses et Reco en une page
  - [x] Fix on ne voit plus les numero de page des cas d'usage en annexe - simplifie le calcul des pages, maintenant il est statique (1 page par cas, une page pour annexe reco ref)
  - [x] fix responsiveness of usecase cards
  - [x] propagate usage of usecase cards to dossier and enterprise
  - [x] add edit mode in dashboard
    - [x] Align EditableInput with Dahsboard UI (synthese executive, introduction, analyse, recommandation) using dashboard-tmp view for interactive visual testing
        - [x] config tiptap to apply tiptap classes (config TipTap extension)
        - [x] align css including prose, remove css simplifications
        - [x] add parserRefrencesInmarkdown() pour TipTap
        - [x] align html structures
        - [x] handle impression mode (avoid reg)
        - [x] visual testing (display & impression)
    - [x] including api addition path to enable executive report modification
        - [x] Ajout schéma zod executiveSummaryDataSchema pour validation structure
        - [x] Ajout executiveSummary au folderInput avec .optional()
        - [x] Création parseExecutiveSummary() similaire à parseMatrix()
        - [x] Modification PUT /folders/:id pour stringify/parse executiveSummary comme matrixConfig
        - [x] Branchement EditableInput avec apiEndpoint="/folders/${id}" et fullData
        - [x] Gestion sauvegarde avec rechargement folder et mise à jour store
    - [x] Rendre éditable le titre du dossier dans le dashboard
    - [x] Amélioration UX boutons imprimer et régénérer
        - [x] Boutons avec icônes uniquement (sans texte)
        - [x] Déplacement boutons imprimer et régénérer à droite du titre "Synthèse exécutive"
        - [x] Suppression boutons du header principal (à côté du titre du dossier)
        - [x] Ajout attributs title pour accessibilité
  - [x] Fix additionnal non volontary empty paragraph in TipTap after list (hide it)
  - [ ] Detailed Usecase UI relying on editable inputs in markdown mode for all fields
    - [x] Phase 1: Description (markdown) alignée Dashboard (EditableInput + normalisation Markdown + API PUT stable)
    - [ ] Phase 2: Listes simples (Bénéfices, Risques, Mesures, Prochaines étapes) avec conversion array↔markdown et traitement références
    - [ ] Phase 3: Justifications axes valeur/complexité (texte simple) avec traitement références
    - [ ] Phase 4: Listes avec icônes (Sources, Données) avec scaling dynamique (`dataSourcesScaleFactor`, `dataObjectsScaleFactor`), post-processing icônes SVG et traitement références
    - [ ] Phase 5: Technologies avec scaling dynamique (`technologiesScaleFactor`)
    - [x] Phase 6: Champs texte simples (Contact, Domaine, Délai) 

- [ ] **Task 5.1**: Update unit tests for new API endpoints
  - Test executive summary generation and update endpoint
  - Test error handling
  - Test with various folder/company combinations
  - Test automatic generation trigger

- [ ] **Task 5.2**: Update E2E tests for dashboard
  - Test scatter plot improvements
  - Test ROI quadrant display (with > 2 use cases and ≤ 2 use cases)
  - Test dashboard configuration accordion
  - Test executive summary generation flow (automatic and manual)
  - Test print report generation and formatting

- [ ] **Task 5.3**: Manual testing and validation
  - Verify all UI changes work correctly
  - Test responsive design
  - Validate AI-generated summaries quality
  - Test print report generation and formatting (Chrome print preview and actual print)

## Commits & Progress
- [x] **Initial commit**: Branch creation and BRANCH.md
- [x] **Commit 1**: Phase 1 - Improve scatter plot UI (50% width, labels, tooltip)
- [x] **Commit 2**: Phase 1 - Implémentation recuit simulé par cliques pour placement optimal des labels
  - Refonte complète de l'algorithme de placement : recuit simulé par cliques au lieu de label-par-label
  - Détection exhaustive des collisions : label↔label, label↔point (avec couverture partielle), trait↔label, trait↔point, trait↔trait
  - Moves aléatoires avec jusqu'à 20 tentatives par clique (layout alternatif, déplacement vectoriel, swap Y)
  - Rendu en couches : labels (fond 30% opacité) → traits → points (au top)
  - Paramètres configurables centralisés : runs, itérations, température, magnitudes, coûts
  - Cache des layouts pour éviter recalculs au hover
  - Signature aléatoire pour forcer nouveau layout à chaque refresh
  - Mise à jour dynamique du placement des traits selon position finale
- [x] **Commit 3**: Phase 1 & 2 - Prise en compte des boîtes de quadrant dans le recuit et uniformisation des couleurs
  - Ajout de la détection des collisions avec les boîtes fixes de quadrant (Gains rapide, Projets majeurs, Attendre, Ne pas faire) dans le recuit simulé
  - Coût paramétrable `QUADRANT_LABEL_COST` pour l'évitement des boîtes de quadrant
  - Centralisation des couleurs dans des constantes : `THEME_BLUE` (#475569), `THEME_BLUE_RGB`, `THEME_TEXT_DARK`
  - Uniformisation de toutes les couleurs (cadres, traits, points, texte) en bleu-gris foncé (#475569)
  - Correction du problème de recalcul des labels au hover (utilisation de `raw.x/y` au lieu de `element.x/y` dans la signature)
  - Uniformisation du texte (labels, légendes des axes, labels de quadrant) avec la couleur bleu-gris
- [x] **Commit 4**: Phase 2 - Finalisation du dashboard et configuration ROI
  - Ajout de l'accordéon de configuration du quadrant ROI en haut à droite du graphique
  - Déplacement de la logique de configuration du composant scatter plot vers le dashboard
  - Titre du dashboard affiche maintenant le nom du dossier sélectionné
  - Statistiques ROI utilisent maintenant la médiane au lieu de la moyenne pour valeur et complexité
  - Correction du filtre ROI pour utiliser `>=` et `<=` au lieu de `>` et `<` (inclusion des points sur les lignes de seuil)
  - Changement de l'icône "Gains rapides" pour une flèche de croissance
  - Retrait du sélecteur de dossier (remplacé par le titre dynamique)
  - Simplification du composant scatter plot (retrait de la logique de configuration)
- [x] **Commit 5**: Phase 3 - Executive Summary Database Schema
  - Ajout du champ `executiveSummary` JSONB à la table `folders`
  - Migration 0006_low_riptide.sql
- [x] **Commit 6**: Phase 3 - Executive Summary Generation Service
  - Service de génération avec calcul des top cases basé sur les seuils ROI
  - Support des seuils personnalisés et médianes par défaut
  - Intégration OpenAI avec prompt executive summary
- [x] **Commit 7**: Phase 3 - Web Extract Tool & Prompts Update
  - Ajout du tool `web_extract` pour extraction de contenu web
  - Mise à jour du prompt executive summary avec références
- [x] **Commit 8**: Phase 3 - Queue Manager Integration
  - Intégration de la génération automatique après complétion des use cases
  - Nouveau job type `executive_summary`
- [x] **Commit 9**: Phase 3 - API Endpoints
  - Endpoint POST /analytics/executive-summary avec job queue
  - Mise à jour GET /folders/:id pour inclure executiveSummary
- [x] **Commit 10**: Phase 5 - Tests
  - Tests de validation et génération de synthèse exécutive
  - Tests de génération automatique
- [x] **Commit 11**: Phase 3 - UI Refresh Manager Enhancement
  - Amélioration du refresh manager pour intervalles personnalisés
- [x] **Commit 12**: Phase 3 - Dashboard Integration
  - Intégration complète de l'affichage de la synthèse exécutive
  - Monitoring automatique du statut de génération
  - Parsing markdown avec styles et citations
  - Marges responsives pour aspect document
- [x] **Commit 13**: Phase 4 - Corrections impression - layout-bottom 50/50, marges annexes, overflow axes
  - Fix layout-bottom: passage de grid à flexbox pour garantir 50/50 en preview et print
  - Fix marges annexes: @page annex margin 0, padding 0.6cm reporté sur conteneurs
  - Fix overflow axes valeur/complexité: dédoublonnage space-y-6, page-break-after pour sections
  - Structure unifiée: usecase-annex-section pour dashboard et cas-usage/[id]
- [x] **Commit 14**: Phase 4 - Scaling dynamique références, données, technologies, sources
  - Scaling proportionnel pour références (base 8), données (base 5), technologies (base 7), sources (base 5)
  - Réduction font-size, line-height, gap et icônes SVG proportionnellement
  - Détection mode impression via beforeprint/afterprint events
- [x] **Commit 15**: Phase 4 - Footer image pour fiches cas d'usage et styles associés
  - Ajout footer.jpg en background des fiches cas d'usage (position absolute bottom)
  - Gradient blanc overlay (opaque top → transparent bottom) pour fusion avec contenu
  - min-height 27.3cm sur usecase-print pour garantir footer au bas de page
  - Page de garde annexe: même structure que page de garde principale
- [x] **Commit 16**: Phase 4 - Scaling agressif sommaire exécutif et calcul numéros de page
  - Scaling plus agressif: minFontSize 5pt, step 0.2pt
  - Réduction proportionnelle marges titre h3 et padding boîte
  - Suppression marge dernier paragraphe
  - Calcul numéros de page: chaque cas d'usage = 1 page exactement (currentPage += 1)
  - Fonction calculatePageNumbers avec calcul dynamique hauteurs sections
  - Structure impression complète: page de garde, synthèse, sommaire, sections, annexes
  - Affichage numéros de page dans sommaire avec liens vers sections
- [x] **Commit 18**: Phase 5 - Tentative réorganisation plugin Chart.js pour tooltip hover
  - Tentative de déplacer le calcul des labels dans `afterLayout` au lieu de `beforeDatasetsDraw`
  - Objectif: permettre l'interaction (tooltip) sur les points dès le chargement, avant calcul des labels
  - Note: solution non fonctionnelle, nécessite investigation supplémentaire
- [x] **Commit 19**: Phase 5 - Fix cover page background image and filter positioning
  - Isolation du background image et du filter dans un pseudo-élément `::after` dédié
  - Correction du problème de positionnement après calculs longs (labels) - plus besoin de Ctrl+Shift+R
  - Retrait du style inline `background-image` du composant Svelte
  - Utilisation de `background-size: cover` pour préserver le ratio d'aspect sans étirement
  - Positionnement correct: marges 2cm haut/bas, image centrée horizontalement, filter appliqué uniquement sur background
- [x] **Commit 20**: Phase 5 - Add print button in dashboard
  - Ajout du bouton "Imprimer" dans le header du dashboard (à côté du titre)
  - Icône SVG d'impression identique à celle utilisée dans les cas d'usage
  - Bouton visible uniquement si `executiveSummary` existe (pas de rapport sans synthèse)
  - Classe `print-hidden` pour masquer le bouton en impression
  - Appel à `window.print()` pour lancer l'impression du rapport
  - Renommage du texte du bouton de "Exporter en PDF" à "Imprimer" dans cas-usage/[id] pour cohérence
- [x] **Commit 21**: Phase 5 - Fix annex print layout (footer overflow and missing top margin)
  - Correction du positionnement du footer dans les annexes du dashboard : `bottom: -0.6cm` (aligné sur vue individuelle) au lieu de `-1.2cm` (incorrect)
  - Correction de la disparition de la marge haute après saut de page : remplacement de `padding-top` par `border-top` (transparent)
  - Résolution du débordement de 0.6cm sur la page suivante et du contenu collé en haut de page
- [x] **Commit 22**: Phase 5 - Simplification CSS et résolution page blanche après back cover
  - Suppression des règles CSS redondantes et surcharges inutiles
  - Simplification du positionnement de la back cover : utilisation de `bottom: 4cm` au lieu de `top` avec transform
  - Retrait des `!important` bloquant l'ajustement dynamique de la taille de police du sommaire exécutif
  - Correction définitive du problème de page blanche après la back cover
  - Simplification des règles `page-break` pour les annexes (remplacement de `auto` par `avoid` pour la dernière section)
- [x] **Commit 23**: Phase 5 - Simplification calcul pages statique et ajustements espacements
  - Simplification calcul numéros de page : valeurs statiques (Intro p2, Sommaire p3, Analyse p4, Reco p5, Ref p6, Annexes p7)
  - Cas d'usage : page annexes + index + 1 (1 page par cas d'usage)
  - Suppression fonction calculatePageNumbers() et tous ses appels (180+ lignes supprimées)
  - Ajustement espacements sections Analyse et Recommandations pour faire tenir chaque section sur une page
  - Gestion cas avec plus de 23 cas d'usage : saut de page forcé au 24ème, incrémentation de 1 pour toutes les pages suivantes
- [x] **Commit 24**: Phase 5 - API et UI pour édition executiveSummary et améliorations UX
  - API : Ajout schéma zod executiveSummaryDataSchema pour validation structure (introduction, analyse, recommandation, synthese_executive, references)
  - API : Ajout executiveSummary au folderInput avec .optional() et parseExecutiveSummary()
  - API : Modification PUT /folders/:id pour stringify/parse executiveSummary comme matrixConfig
  - UI : Branchement EditableInput pour executiveSummary avec apiEndpoint="/folders/${id}" et fullData
  - UI : Rendu éditable du titre du dossier dans le dashboard avec EditableInput
  - UI : Amélioration UX boutons - icônes uniquement, déplacés à droite du titre "Synthèse exécutive"
  - UI : Suppression boutons du header principal, ajout attributs title pour accessibilité

## Status
- **Progress**: 19/20 tasks completed
- **Current**: Phase 1 completed, Phase 2 completed, Phase 3 completed, Phase 4 completed, Phase 5 partially completed (Task 5.1 completed)
- **Next**: Phase 5 - Testing & Validation (E2E tests and manual validation)

## Specifications Confirmed

### ROI Quadrant
- **Boundaries**: Relative to medians (value > median AND complexity < median)
- **Display**: Only if > 2 use cases exist
- **Configuration**: Stored in localStorage initially, configurable via accordion with gear icon
- **Visual**: Green background/shading for top-left quadrant

### Executive Summary
- **Format**: JSON with 4 markdown sections:
  - `introduction` (markdown)
  - `analyse` (markdown)
  - `recommandation` (markdown, includes prochaines étapes)
  - `synthese_executive` (markdown)
- **Input**: Top cases (list of priority use case names) calculated using ROI quadrant thresholds or medians
- **Storage**: JSON field in folders table (`folders.executiveSummary`)
- **Generation**: Automatic after all use cases completed, manual button for historical folders
- **UI Integration**: 
  - Integrated directly in `dashboard/+page.svelte` (no separate component)
  - Display order: **Synthèse exécutive FIRST**, then **Dashboard (scatter plot)**, then **Introduction/Analyse/Recommandations**
  - Fetch from folder data, parse JSON, render markdown with `marked` library
  - Show loading state when `folder.status === 'generating'`
  - Manual generation button for folders without summary

### Print Report
- **Format**: CSS-based print (Chrome print to PDF)
- **Structure**:
  1. Page de garde (folder name, company, background image, executive summary)
  2. Table of contents (with dynamic page numbers)
  3. Introduction
  4. Analyse
  5. Recommandations
  6. Références
  7. Page de garde annexes
  8. One page per use case (with footer image)
- **Features**:
  - Dynamic page numbering
  - Content scaling for long lists (references, data sources, technologies)
  - Aggressive scaling for executive summary
  - Footer image on use case pages
  - Proper page breaks and margins

### Dashboard Configuration
- **UI**: Accordion in top-right corner of scatter plot container with gear icon (⚙️)
- **Storage**: localStorage initially (no DB changes in this phase)
- **Initial Values**: Median-based thresholds
- **Future**: Will be stored in backend (not in this phase)

## Technical Notes

- **UI Framework**: SvelteKit 5 with Tailwind CSS
- **Chart Library**: Chart.js (already in use)
- **API Framework**: Hono with TypeScript
- **AI Service**: OpenAI Node.js SDK (existing integration)
- **Print**: CSS @media print with @page rules
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Database**: PostgreSQL 16 with Drizzle ORM

## Dependencies
- OpenAI service already available
- No additional dependencies for print (CSS-based)

