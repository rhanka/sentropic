# SPEC_EVOL — App migration to Vue 3.6 + Vapor, 100 % design system (templater included)

Status: plan only (no product code, no commit). Revision 6, written 2026-11-13 03:05 (Montréal) for a start on 13/11 08:00 Montréal. Reviewed round 1: Astra max on revision 1, verdict REWORK (1 BLOCKER, 5 MAJOR, 1 MINOR); reconciled in section 9.7. Reviewed round 2: Astra max on revision 2, verdict REWORK (0 BLOCKER, 3 MAJOR, 1 MINOR; five round-1 findings FIXED, two NOT FIXED); the four findings and the two open items are reconciled in section 9.8. Reviewed round 3: Astra max on revision 3, verdict REWORK (0 BLOCKER, 2 MAJOR, 0 MINOR; the four round-2 findings FIXED); the two findings are reconciled in section 9.9. Reviewed round 4: Astra max on revision 4, verdict REWORK (0 BLOCKER, 2 MAJOR, 0 MINOR; the two round-3 findings FIXED); the two findings are reconciled in section 9.10. Reviewed round 5: Astra max on revision 5, verdict REWORK (0 BLOCKER, 1 MAJOR, 0 MINOR; the two round-4 findings FIXED); the finding is reconciled in section 9.11. Revision 6 corrects this finding only: the adaptation of the dependency of `cluster-mesh` on `auth-ui` moves from A11 to A1d, with its gate and its paths (sections 6.3 and 6.14) and its trace (sections 9.3, 9.4, 9.6, 9.10, 9.11); lots, hours, dependencies and dates are those of revision 5. Round 6 of the review is not done yet: this revision is `unverified` by a reviewer.
Track item: `01M79DW3RDPC2CSCGZJCXC2A81`. Author: planning lane (Claude Fable 5.2, max). Independent review: Astra max (`.tmp/rv/app-vue-plan-astra.v1.md`, `.tmp/rv/app-vue-plan-astra.v2.md`, `.tmp/rv/app-vue-plan-astra.v3.md`, `.tmp/rv/app-vue-plan-astra.v4.md`, `.tmp/rv/app-vue-plan-astra.v5.md`). Revisions 1 to 5 are kept at `.tmp/rv/SPEC_EVOL_APP_VUE_VAPOR_MIGRATION.v1.md`, `.v2.md`, `.v3.md`, `.v4.md` and `.v5.md`.

Owner request (verbatim, 13/11): « planifie la migration de app en vue + vapor stp (100% design system, y compris templater merci) ».

Owner constraint (design-system session, 13/11): Vapor templates + Composition API only, no `h()`, Vue-4-ready, pin `vue` `3.6.0-rc.15`, then 3.6.x stable.

**Conventions.**
- `[FAIT]` = read from a git tree or a public registry, with `file:line`; `[JUGEMENT]` = design choice or estimate of this plan; `unknown` / `unverified` / `source-gap` = not established, with the lot that must establish it.
- Unless stated, `file:line` references point to the `sentropic` pin `c40b8d1b56372fe1f2e8063ea6069e403dfe4942` (its `origin/main` until revision 4; read with `git show c40b8d1b5:<path>`; section 9.6 records the move of that head).
- `PLAN.md:n` = `/home/antoinefa/src/sent-tech-design-system/scratchpad/preact-baseline/PLAN.md` (DS programme plan, revision 4), line `n`.
- DS repository facts are read at the DS pin, `sent-tech-design-system` `5f57b382372a46b26745f632a2fbc406b417f2ba` (its `origin/main` when revision 1 was written; section 9.6 records the move of that head).
- Agent-hour = one wall-clock hour of one builder session (build work only). CI, review, integration and queueing are counted apart (4 h per sentropic lot, section 6.7). Estimates are in hours only, never in days or weeks.
- Grades: **X** = Sol 6.1 xhigh, **H** = Sol 6.1 high (the grades of `PLAN.md:25`). Review: an independent reviewer assigned by s-conductor; merge by s-conductor only (`PLAN.md:863`).
- Lot identifiers: `A*` app, `C*` chat-ui, `T*` templater, as in the DS plan (`PLAN.md:699-763`). A lot split by this spec keeps its name with a letter suffix. `AE*` = app enabler (no DS Vue dependency). Section 9.1 lists every difference with the DS plan.
- A tag at the head of a paragraph, a list or a table applies to all of it. Inside a `[JUGEMENT]` block, a `file:line` or `PLAN.md:n` citation marks an embedded fact.
- All times are Montréal time (EST, UTC−5).

---

## 1. Résumé owner (FR)

Statut des affirmations de cette page : les comptages sont des [FAIT] détaillés en section 2 ; la stratégie, les heures et les dates sont des [JUGEMENT] détaillés en sections 3 à 6.

**Cible.** L'application (`ui/` : 23 pages, 40 composants, 18 stores, 27 610 lignes Svelte) passe en Vue 3.6 + Vapor : templates et Composition API uniquement, aucun `h()`, version figée `3.6.0-rc.15` puis 3.6.x stable. « 100 % design system » est défini par sept règles : six vérifiées par lint (plus aucun bouton, champ, table ou modale écrit à la main, plus de Tailwind, icônes et couleurs fournies par le DS) et une vérifiée sur le DOM rendu, HTML généré compris (Markdown, citations, chat). Le résultat est publié en trois chiffres séparés : couverture DS, exceptions temporaires (4 au plus), exceptions permanentes (4). Le templater est réécrit en Vue sur le même contrat de view-template ; la feuille d'impression est réécrite sur les composants DS.

**Constat mesuré.**
- L'app n'importe aujourd'hui que 3 composants DS. Elle contient 181 `<button>` bruts et 1 607 attributs `class="` Tailwind.
- La feuille d'impression (1 948 lignes) dépend de Tailwind dans 269 de ses 441 lignes de sélecteurs : elle ne survit pas au passage au DS et doit être réécrite.
- Deux specs E2E passent en mode impression, mais aucune ne produit de PDF paginé ni ne vérifie le contenu page par page ; 152 sélecteurs E2E contiennent une classe CSS et 16 fichiers de specs citent des classes Tailwind.
- Six générateurs de HTML (liens de citation, listes et titres Markdown, contenu du chat, éditeur) écrivent des classes Tailwind hors des templates : un lint de templates ne les voit pas.
- Aucune spec existante ne tient sur la seule première route : les deux specs qui atteignent `/neutral` continuent vers le login, les organisations, le chat ou la création de dossier.
- Les lots DS annoncés convertissent des composants existants ; aucun ne les étend. Quatre compléments nécessaires (conteneur de contenu Markdown, zone de toasts, glyphes de notation, coque à panneau ancré) ont donc une solution côté sentropic qui n'attend pas le DS.
- Les modules Vue du DS sont encore en `h()` (14 composants en template sur 256 fichiers) : rien d'utilisable en Vapor pur avant la livraison DS « V10a ».
- Dans chat-ui, deux vues sur 24 assemblent les autres (`ChatPanelShell`, `ChatConversation`) : elles ne peuvent être portées qu'après leurs composants. La feuille de style actuelle du paquet pour les hôtes sans Tailwind est générée à partir des classes Tailwind : elle ne convient pas aux vues Vue.
- `ui/` n'est pas lu que par l'application : workspace npm racine, image de l'API (`ui/package.json` y est copié), scanners de sécurité, inventaires et tests CI. Le supprimer sans les modifier casse ou aveugle ces contrôles.

**Stratégie recommandée.**
- Construction route par route dans une cible candidate (`ui-vue/` + `ui-shared/`) ; l'app Svelte reste en production et sert de référence jusqu'à la recette.
- Chaque écran est écrit une seule fois, directement sur les composants DS (pas de portage Tailwind intermédiaire).
- Parité prouvée par le comportement : les 61 specs E2E existantes rejouées sur les deux cibles, appels API comparés en valeur (pas seulement en forme), navigation, impression. Chaque lot est vérifié sur ce qu'il livre : une spec n'est exigée sur la cible Vue que lorsque tous les écrans qu'elle traverse sont portés. Les écarts visuels sont classés « voulus par le DS » ou « défaut » ; vous approuvez la liste des écarts voulus.
- Une seule bascule de l'application en production, sur votre GO ; `ui/` est supprimé dans le même changement (aucun fallback), avec la mise à jour des outils du dépôt qui le lisent. L'image de l'API est reconstruite à cette occasion, à code identique. Les écrans du fournisseur d'identité, livrés dans l'image de l'API, ont leur propre bascule (A1c).
- Les styles du contenu Markdown (titres, listes, code, citations) sont livrés par le paquet chat-ui lui-même et réutilisés tels quels par l'application : un consommateur du paquet n'a besoin d'aucun fichier de l'application.
- Application statique comme aujourd'hui (pas de SSR), routeur neutre du programme DS. Nuxt est écarté (Vapor seulement en mode interop, racine en DOM virtuel) ; `vue-router` aussi (ses composants sont en `h()`).

**Lots (heures-agent de build).**

| Chantier | Lots | Heures | Dont démarrables maintenant |
|---|---|---|---|
| App (`A*`, `AE*`) | 29 | 346 | 96 |
| chat-ui (`C*`) | 9 | 112 | 34 |
| Templater (`T*`) | 6 | 68 | 22 |
| **Total passe Vue** | **44** | **526** | **152** |

S'y ajoutent environ 176 h de CI, revue et intégration (4 h par lot). Écart avec la révision 1 : +54 h et +5 lots, dont +26 h et +3 lots en révision 2 (section 9.7), +14 h et +1 lot en révision 3 (section 9.8), aucun en révision 4 (section 9.9), puis +14 h et +1 lot en révision 5 (section 9.10) : le portage du paquet `auth-ui` devient un lot séparé (A1d), placé avant les écrans du paquet `cluster-mesh` qui en importent deux composants, et les chaînes de construction et de qualification de trois paquets UI, qui ne compilent aujourd'hui aucun composant Vue, reçoivent leurs travaux (section 6.14). La passe Preact (156 h, lots `A12`, `A13`, `C5`, `T5`, `T6`) vient ensuite et n'est pas planifiée ici.

**Ce qui démarre le 13/11 à 08:00, avant V10a :** audit et cœur neutre du chat (C0, C1), contrats du templater (T0, T2), instrument de parité avec le scénario de la première route, puis référence gelée (AE1a, AE1b), liste des composants requis et demandes de compléments pour le DS, puis manifeste et lint « 100 % DS » (AE2a, AE2b), socle Vue sans écran (A0a), extraction de la logique de quatre gros fichiers — nuage de points, matrice, réglages, champ éditable (A4a, A5a, A6a, A7a).

**Jalons au plus tôt** (hypothèse non vérifiée : porte DS « G0-Vue » fermée le 14/11 à 08:00 ; tout glissement DS décale d'autant) :

| Jalon | Au plus tôt |
|---|---|
| Liste des composants requis et demandes de compléments remises au DS (AE2a) | 13/11 18:00 |
| V10a, première livraison DS Vapor | 16/11 15:00 |
| Première route réelle à parité, `/neutral` (A0b) | 17/11 17:00 |
| Rendus du templater fusionnés (T1b) ; couche impression (T1c) | 18/11 17:00 ; 20/11 11:00 |
| chat-ui Vue livré (C6a) | 19/11 05:00 |
| Tous les écrans portés | 21/11 01:00 |
| Recette complète M-APP (A10b) | 22/11 17:00 |
| Bascule en production (A15) | votre GO + 14 h |

**Chemin critique :** V10a → C2a → C2b → C7a → C6a → A8a → A8b → A10a → A10b, soit 146 h après V10a (12 h de plus qu'en révision 2 : les deux vues d'assemblage du chat attendent leurs composants). C'est le chat qui commande la date, pas le templater. Avec quatre branches simultanées, les autres chaînes ont 6 à 20 h de marge. Le calendrier est recalculé depuis un graphe unique de dépendances (section 6.8), désormais vérifié contre les imports réels des composants, imports entre paquets compris (section 6.12) ; les heures restent des estimations jusqu'à la mesure d'A0b et à la réestimation du chat par C0.

**Décisions attendues** (détail en section 8) :
1. Un seul passage direct sur le DS (recommandé) ou deux temps (portage identique, puis DS) : +110 h environ et une seconde recette.
2. Gel des évolutions fonctionnelles de `ui/` pendant la migration (recommandé : oui, correctifs seulement).
3. Nuage de points des initiatives : garder le moteur chart.js comme exception documentée à la bascule (recommandé) ou le reconstruire d'abord sur un composant DS.
4. Mode d'approbation des écarts visuels et du registre d'exceptions DS : une approbation à la recette, avec aperçus à chaque vague (recommandé), ou une approbation par lot.
5. Cinquième branche simultanée du 16/11 au 20/11 (recommandé : oui ; la marge avant la recette passe de 6 h à 16 h ; la première route et la date de recette ne changent pas).
6. Écrans de `apps/auth-idp` : migrés dans ce programme (A1b) puis basculés par un lot dédié sur votre GO (A1c) (recommandé), ou laissés en Svelte.
7. GO de bascule en production, le moment venu ; la production tournera alors sur une release candidate de Vue (déjà acté côté DS, rappelé à chaque GO). La bascule publie deux images : l'UI et l'API (reconstruite à code identique).
8. Liens de citation `[n]` dans l'éditeur : l'éditeur du DS n'accepte pas d'extension. Pendant l'édition les citations restent du texte, les liens restent actifs en lecture et à l'impression (recommandé), ou attendre une évolution de l'éditeur DS. Votre choix règle le contrôle de parité : avec l'option recommandée, il attend le texte `[n]` en édition et le lien ailleurs.

---

## 2. Inventory

### 2.0 Provenance and counting rules

Every count comes from a git tree, never from a working directory (the local checkout is on another branch).

| Repository | Commit | Ref |
|---|---|---|
| `sentropic` | `c40b8d1b56372fe1f2e8063ea6069e403dfe4942` | `origin/main`, 2026-11-13 03:26 +01:00 |
| `sent-tech-design-system` (DS) | `5f57b382372a46b26745f632a2fbc406b417f2ba` | `origin/main`, 2026-11-13 03:28 +01:00 |

Rules: files = `git ls-tree -r --name-only`; lines = newline count of the blob (`wc -l`); occurrences = `git grep -hoE`; files matching = `git grep -lE`; a test file matches `\.(test|spec)\.(ts|tsx|js|mjs)$`.

Checks of the inputs given to this plan:

| Input | Result |
|---|---|
| 66 `.svelte` files, 23 route pages, 27,610 Svelte lines | [FAIT] confirmed: 23 `+page.svelte` + 2 `+layout.svelte` + 1 `+error.svelte` + 40 files under `ui/src/lib/components` |
| 3 DS items imported by the app | [FAIT] `IconButton`, `Toggle` (`ui/src/lib/components/ChatWidget.svelte:43`), `ThemeProvider` (`ui/src/routes/auth/+layout.svelte:7`) |
| 7,052 lines of chat behaviour in host files | [FAIT] `AppChatPanel.svelte` 3,478 + `ChatWidget.svelte` 3,429 + `StreamMessage.svelte` 87 + `ChatPanel.svelte` 58 |
| chat-ui: 24 Svelte views | [FAIT] 24 `.svelte` files under `packages/chat-ui/src`, 5,735 lines |
| Figures of the DS plan (`PLAN.md:90-134`), pinned at `5be8e34f3` | [FAIT] still valid: `git diff --name-only 5be8e34f3 c40b8d1b5` lists 0 file under `ui`, `e2e`, `apps/auth-idp`, `packages/chat-ui`, `packages/chat-core`, `packages/auth-ui`, `packages/cluster-mesh/ui`, `packages/cited-source-viewer`, `packages/cowork-bridge` (28 commits, 41 files elsewhere) |

### 2.1 Routes and pages (26 files, 9,979 lines)

[FAIT] Lines, imports of `$lib/components/*` and `$lib/stores/*` read from each blob. The application is a client-only single-page application: `prerender = true`, `csr = true`, `ssr = false` (`ui/src/routes/+layout.ts:1-3`), static adapter with a `404.html` fallback (`ui/svelte.config.js:6-10`).

| Route (file under `ui/src/routes`) | Lines | Local components imported | Stores imported | Lot |
|---|---|---|---|---|
| root layout `+layout.svelte` | 416 | ChatWidget, Header, NavigationGuard, Toast | folders, initiatives, me, modelCatalog, organizations, queue, session, streamHub, themePreference, toast, unsavedChanges, workspaceScope | A0b |
| `+error.svelte` | 10 | — | — | A0b |
| `/` `+page.svelte` | 15 | — | — | A0b |
| `/home` | 16 | — (redirects to `/neutral`, line 8) | — | A0b |
| `/neutral` | 192 | ViewTemplateRenderer, WorkspaceCreateDialog | workspaceScope | A0b (first real route) |
| `/auth` layout | 17 | — (DS `ThemeProvider`) | — | A1a |
| `/auth/login` | 17 | — (`cluster-mesh/ui/LoginScreen.svelte`) | — | A1a |
| `/auth/register` | 17 | — (`cluster-mesh/ui/RegistrationScreen.svelte`) | — | A1a |
| `/auth/devices` | 36 | — (`auth-ui` AuthDevices) | — | A1a |
| `/auth/devices/pair` | 31 | — (`auth-ui` AuthDevicePair) | — | A1a |
| `/auth/magic-link/verify` | 50 | — (`auth-ui` AuthMagicLinkVerify) | session | A1a |
| `/auth/oauth/callback` | 61 | — (`auth-ui` createOAuthClient) | — | A1a |
| `/auth/oauth/consent` | 36 | — (`auth-ui` OAuthConsent) | — | A1a |
| `/folders` | 324 | FileMenu, ImportExportDialog, StreamMessage | folders, streamHub, toast, workspaceScope | A2 |
| `/folders/[id]` | 885 | CommentBadge, DocumentsBlock, EditableInput, FileMenu, ImportExportDialog, LockPresenceBadge, StreamMessage | folders, initiatives, session, streamHub, toast, workspaceScope | A2 |
| `/folder/new` | 728 | DocumentsBlock, EditableInput, MenuPopover | folders, organizations, toast, workspaceScope | A2 |
| `/organizations` | 272 | FileMenu, ImportExportDialog, StreamMessage | organizations, streamHub, toast, workspaceScope | A2 |
| `/organizations/[id]` | 713 | CommentBadge, DocumentsBlock, FileMenu, ImportExportDialog, LockPresenceBadge, OrganizationForm | folders, organizations, session, streamHub, toast, unsavedChanges, workspaceScope | A2 |
| `/organizations/new` | 266 | DocumentsBlock, OrganizationForm | organizations, toast, unsavedChanges, workspaceScope | A2 |
| `/initiative` | 27 | — (redirect) | folders | A3 |
| `/initiative/[id]` | 674 | DocumentsBlock, FileMenu, ImportExportDialog, InitiativeDetail, LockPresenceBadge, StreamMessage | initiatives, session, streamHub, toast, workspaceScope | A3 |
| `/initiative/[id]/gate` | 140 | GateReview | toast, workspaceScope | A3 |
| `/dashboard` | 1,417 | CommentBadge, EditableInput, FileMenu, InitiativeScatterPlot, LockPresenceBadge, TemplateRenderer | folders, initiatives, session, streamHub, toast, viewTemplateCache, workspaceScope | A4b |
| `/matrix` | 1,682 | EditableInput, FileMenu, ImportExportDialog, LockPresenceBadge | folders, initiatives, matrix, session, streamHub, toast, unsavedChanges, workspaceScope | A5a, A5b |
| `/settings` | 1,928 | AdminUsersPanel, GmailConnectorCard, GoogleDriveConnectorCard, TodoRuntimeConfigPanel, ViewTemplateCatalog, WorkspaceSettingsPanel | me, session, themePreference, toast | A6a, A6b |
| `/settings/memberships` | 9 | — (`cluster-mesh/ui/MembershipDecisionsScreen.svelte`) | session | A6b |

Navigation semantics to reproduce [FAIT, occurrences on `ui/src/*.svelte`]: `goto(` 48 occurrences in 22 files; `$page` 23 in 14 files; one `beforeNavigate` guard that cancels navigation (`ui/src/routes/+layout.svelte:284-335`); login redirect with a `returnUrl` query parameter (`+layout.svelte:268`); public and protected route lists (`+layout.svelte:46-70`); two navigation locks, no-workspace and hidden-workspace (`+layout.svelte:272-378`).

### 2.2 Components (40 files, 17,631 lines)

[FAIT] Lines and raw-control counts (`<button`, `<input`, `<select`, `<textarea`, `<table`) per blob. [JUGEMENT] The "Target" column is the mapping proposed for the 100 % DS rule of section 3.5; DS identifiers are catalogue entries of `packages/component-index/generated/component-index.json` (215 entries at the DS pin).

| Component | Lines | Raw controls b/i/s/t/tbl | Role today | Target under 100 % DS | Lot |
|---|---|---|---|---|---|
| `chat/AppChatPanel` | 3,478 | 9/0/0/0/0 | chat host: conversation, composer, attachments, comments, context | chat-ui Vue binding + DS chat primitives; host-only logic in `ui-shared/` | A8a |
| `ChatWidget` | 3,429 | 28/11/5/2/0 | widget shell: dock, tabs, sessions, queue, settings | chat-ui Vue (Widget, Dock, TabBar, SessionsBar) + DS `icon-button`, `toggle`, `menu`, `select`, `input` | A8b |
| `InitiativeScatterPlot` | 2,569 | 1/0/0/0/0 | chart.js scatter with a label-placement engine (`runLabelAnnealing`, line 1145) | neutral engine in `ui-shared/`; host on DS `card`, `toggle`, `tag`, `inline-loading`; canvas = exception EX-1 | A4a, A4b |
| `EditableInput` | 955 | 0/2/0/1/0 | inline editable field, autosave, unsaved-change registry | composite of DS `RichTextEditor`, `input`, `textarea`, `autosave` | A7a, A7b |
| `TodoRuntimeConfigPanel` | 833 | 5/2/0/4/0 | runtime configuration editor | composite of DS `config-item-card`, `textarea`, `input`, `button`, `modal` | A6b |
| `TemplateRenderer` | 754 | 1/0/0/0/0 | templater, family (b) | Vue renderer on DS `field-card`, `tabs`, `rating`, `table`, `skeleton-text` | T2, T1b |
| `ImportExportDialog` | 602 | 3/7/2/0/0 | import and export dialog | composite of DS `modal`, `file-uploader`, `select`, `checkbox`, `radio-group`, `button` | A9 |
| `DocumentsBlock` | 456 | 5/0/0/0/1 | document list and upload | composite of DS `table`, `file-uploader`, `icon-button`, `tag` | A9 |
| `Header` | 450 | 13/0/1/0/0 | navigation, workspace, locale and account menus | DS `app-header` / `header`, `nav-item`, `menu`, `IdentityMenu`, `language-selector`, `select` | A0b |
| `GateReview` | 373 | 1/0/0/0/0 | gate criteria review | composite of DS `card`, `status-dot`, `tag`, `unordered-list`, `button` | A3 |
| `WorkspaceSettingsPanel` | 318 | 5/0/0/0/1 | workspace settings | composite of DS form components + `cluster-mesh` WorkspaceMembersScreen (A11) | A6b |
| `InitiativeDetail` | 308 | 1/0/0/0/0 | consumer of the templater (initiative) | Vue view on T1b | A3 |
| `QueueMonitor` | 271 | 5/0/0/0/0 | job queue popover | composite of DS `menu-popover`, `structured-list`, `inline-loading`, `status-dot`, `progress-bar`, `icon-button` | A9 |
| `ContainerView` | 256 | 3/0/0/0/0 | templater, family (a) | DS `tile` / `card`, `button`, `link`, `empty-state`, `skeleton-text`, `tag`, `icon` | T1a |
| `TipTap` | 227 | 0/0/0/0/0 | rich-text host on `@tiptap/core` | DS `RichTextEditor` (DS lot V8) | A7b |
| `OrganizationForm` | 205 | 0/0/0/0/0 | consumer of the templater (organization) | Vue view on T1b | A2 |
| `LockPresenceBadge` | 203 | 4/0/0/0/0 | lock and presence; its type and state come from `lib/utils/object-lock.ts` (line 4) | DS `LockPresenceBadge` (V8); no local file; neutral twin of `object-lock.ts` (section 2.4) | A9 |
| `ViewTemplateCatalog` | 194 | 2/0/0/1/0 | templater catalogue in settings | DS `config-item-card`, `textarea`, `button`, `modal` | T1b |
| `NavigationGuard` | 163 | 3/0/0/0/0 | unsaved-change dialog | DS `modal` + `button` | A0b |
| `FileMenu` | 156 | 6/0/0/0/0 | file actions menu | DS `menu` / `overflow-menu` + `menu-trigger-button` | T1a |
| `DocumentSourceMenu` | 122 | 2/1/0/0/0 | attachment source menu | DS `menu` + `icon` | A9 |
| `ConfigItemCard` | 122 | 4/0/0/0/0 | configuration card | DS `config-item-card`; no local file | T1b, A6b |
| `WorkspaceCreateDialog` | 110 | 3/1/1/0/0 | workspace creation dialog | DS `modal`, `input`, `select`, `button` | A0b |
| `Toast` | 109 | 2/0/0/0/0 | toast stack bound to the toast store | DS `toast` in an app toaster region (DS gap G-4) | A0b |
| `MenuPopover` | 107 | 0/0/0/0/0 | popover | DS `menu-popover`; no local file | — |
| `GoogleDriveConnectorCard`, `GmailConnectorCard` | 101 each | 2/0/0/0/0 each | connector cards | DS `card`, `button`, `tag`, `icon` | A6b |
| `ScoreTable` | 92 | 0/0/0/0/0 | score rows with editable description | DS `table`, `rating` + editable field | T1b |
| `FieldCard` | 92 | 0/0/0/0/0 | field card, 3 variants, 6 colours (lines 15-26) | DS `field-card`; no local file | T1b |
| `StreamMessage` | 87 | 0/0/0/0/0 | adapter of chat-ui `StreamMessage` (line 2) to the `streamHub` store and to the i18n labels (lines 3-4, 62-64); imported by `QueueMonitor` and by four pages (section 6.12) | Vue adapter of chat-ui Vue `StreamMessage` | A9 |
| `ChatPanel` | 58 | 0/0/0/0/0 | wrapper of `AppChatPanel` | Vue wrapper | A8a |
| `ViewTemplateRenderer` | 44 | 0/0/0/0/0 | dispatcher of family (a) | Vue dispatcher | T1a |
| `CommentBadge` | 29 | 1/0/0/0/0 | comment-count button | comment count of DS `field-card`, else `icon-button` + `badge` | T1b |
| `MenuTriggerButton` | 24 | 1/0/0/0/0 | menu trigger | DS `menu-trigger-button`; no local file | — |
| `AdminUsersPanel` | 10 | 0/0/0/0/0 | wrapper of `cluster-mesh` AdminUsersScreen | Vue wrapper (A11) | A6b |
| `MatrixDetails` (72), `MaturityStageBadge` (63), `StarRating` (35), `ScoreCard` (25) | 195 | 0 | [FAIT] no importer under `ui/src`, `ui/chrome-ext`, `ui/vscode-ext` (`StarRating` is imported only by the two unused files) | not ported; deleted with `ui/` at the cutover | — |
| `ArtifactsPanel` | 28 | 0 | iframe; [FAIT] imported only by `ui/tests/cmf-panel.test.ts` | not ported unless a consumer exists at A10a; target would be DS `web-frame` (V8) | — |

### 2.3 Stores (18 files under `ui/src/lib/stores`, 1,784 lines)

[FAIT] 16 of the 18 import `svelte/store`; `streamHub.ts` and `viewTemplateCache.ts` do not.

| Store | Lines | `svelte/store` API | Browser-storage references | Lot |
|---|---|---|---|---|
| `session.ts` | 451 | writable, derived, get | 38 | A0a |
| `queue.ts` | 203 | writable | 0 | A0a |
| `workspaceScope.ts` | 165 | writable, derived, get | 6 | A0a |
| `folders.ts` | 164 | writable | 6 | A0a |
| `initiatives.ts` | 132 | writable | 0 | A0a |
| `organizations.ts` | 88 | writable | 0 | A0a |
| `unsavedChanges.ts` | 87 | writable, get | 0 | A0a |
| `me.ts` | 71 | writable | 0 | A0a |
| `streamHub.ts` | 66 | none | 0 | A0a |
| `themePreference.ts` | 57 | writable | 2 | A0a |
| `toast.ts` | 44 | writable | 0 | A0a |
| `modelCatalog.ts` | 42 | writable, derived, get | 0 | A0a |
| `matrix.ts` | 37 | writable | 0 | A0a |
| `auth.ts`, `business.ts` | 16 each | writable | 0 | A0a |
| `settings.ts` | 13 | writable | 0 | A0a |
| `viewTemplates.ts` | 80 | writable, get | 0 | T2 |
| `viewTemplateCache.ts` | 52 | none | 0 | T2 |

[FAIT] The two templater stores export a function of the same name with different signatures and query parameters: `resolveViewTemplate(workspaceType, objectType, maturityStage)` with `workspace_type` / `object_type` (`viewTemplates.ts:22-45`) and `resolveViewTemplate(workspaceId, workspaceType, objectType)` with `workspaceId` / `workspaceType` / `objectType` (`viewTemplateCache.ts:16-31`). Only `listViewTemplates` of `viewTemplates.ts` has an importer (`ViewTemplateCatalog.svelte:10`); the other two exports of `viewTemplates.ts` have none under `ui/src`. T2 records this and ports only what is imported.

### 2.4 Other TypeScript modules (55 files)

[FAIT] `ui/src` holds 73 non-test `.ts` files (6,503 lines): the 18 stores and 55 others — `lib/utils` 24, `lib/chat` 10 (1,511 lines of host adapters), `lib/services` 3, `lib/types` 3, `lib/adapters` 2, `lib/extensions` 2, `lib/upstream` 2, `src/types` 2, and 7 single files.

[FAIT] 20 of the 73 import `svelte`, `svelte/*`, `$app/*` or `svelte-i18n`: 16 stores, `lib/i18n.ts`, `lib/chat/comment-host-adapter.ts`, `lib/chat/web-host-adapter.ts`, `lib/utils/object-lock.ts`. The other 53 are framework-neutral and are reused through the `@shared/*` alias (section 3.2). Framework-neutral does not mean style-neutral: 4 of the 53 carry Tailwind class names (`git grep` for class attributes and utility tokens in the non-test `.ts` files) and are not reused as they are — `lib/utils/markdown.ts` (section 2.8, generated HTML), `lib/extensions/tailwind-classes.ts`, `lib/extensions/references.ts` and `lib/types/view-template.ts` (`colorClass`, line 42; replaced by the contract of T0).

Owner lots of the four Svelte-bound modules that are not stores [JUGEMENT; imports are FAIT]: `lib/i18n.ts` → A0a; the two chat host adapters, imported only by the chat hosts and by each other (`AppChatPanel.svelte:33`, `web-host-adapter.ts:30-37`) → A8a; `lib/utils/object-lock.ts` (150 lines; bound by `$app/environment`, line 3; imported by `LockPresenceBadge.svelte:4` and by five pages: dashboard `:38`, `folders/[id]` `:28`, `initiative/[id]` `:22`, matrix `:23`, `organizations/[id]` `:28`) → A9, as a neutral twin in `ui-shared/`.

[FAIT] `ui/src/lib/extensions/tailwind-classes.ts` (58 lines, four node extensions, lines 12-57) writes Tailwind class names into editor content and is imported by `TipTap.svelte:12`. `ui/src/lib/extensions/references.ts` (class and inline `onclick`, lines 79 and 83) has no importer under `ui/src`. Neither is carried to the candidate (A7b, section 3.5.1).

### 2.5 Stylesheets and root container

| File | Lines | Facts [FAIT] |
|---|---|---|
| `ui/src/app.css` | 1,001 | imports Tailwind (line 1) and scans `packages/chat-ui/src` for utility classes (line 5); `#svelte` selector (line 131); theme classes `.topai-theme-dark` (line 361); VS Code host overrides keyed on Tailwind classes (lines 487-999) |
| `ui/src/app.print.css` | 1,948 | `@page` rules, default, `annex` and `cover` (lines 37, 64, 70); `#svelte` selector (line 89); 441 selector lines, of which 269 name a Tailwind utility class (`.prose` 75, `.space-y-6` 44, `.grid` 27, `.rounded-lg` 27, …); 610 `!important`; 318 lines mention `.template-initiative` |
| `ui/src/tailwind-theme.css` | 97 | theme variables |
| `ui/postcss.config.cjs` | — | `tailwindcss ^4.3.3`, `@tailwindcss/postcss ^4.3.3` (`ui/package.json:50`, `:29`) |

[FAIT] Print mode is driven in script as well as in CSS: `beforeprint` / `afterprint` listeners and `matchMedia('print')` set an `isPrinting` flag (`ui/src/lib/components/InitiativeDetail.svelte:100-119`), which switches the templater from editors to rendered Markdown (`TemplateRenderer.svelte:496-500`); the scatter plot re-renders for print (`InitiativeScatterPlot.svelte:2195`, `:2339`).

### 2.6 Build targets, images and CI

| Item | Fact [FAIT] |
|---|---|
| Build script | `svelte-kit sync && npm run build:ext && npm run build:vscode-ext && vite build` (`ui/package.json:8`): three targets, the web application, the Chrome extension and the VS Code extension |
| Extension entries bound to Svelte | `ui/chrome-ext/chatwidget-entry.ts` (90 lines; mounts `ChatWidget.svelte`, lines 7 and 15) and `ui/vscode-ext/webview-entry.ts` (1,260 lines; lines 3, 9, 10). The other 17 + 12 extension files import no Svelte module |
| Image | `ui/Dockerfile`: stages `development` (line 34), `ui-tests` (40), `build` (56), `static-output` (83), `production` on nginx (87) |
| Serving | nginx static root with `error_page 404 /index.html` and `/api/v1/` proxied to the API (`ui/nginx/default.conf:9`, `:70-71`) |
| Make targets | `build-ui` (`Makefile:351`), `build-ext-chrome` (355), `build-ext-vscode` (368), `ci-build-ui` (837), `ci-test-ui` (851), `typecheck-ui` (1252), `lint-ui` (2854), `test-ui` (2995), `test-e2e` (3109) |
| CI jobs (`.github/workflows/ci.yml`) | `enforce-package-bump` (120), `typecheck-lint-ui` (949), `validate-chat-ui` (1225), `test-ui` (2160), `build-ui` (2174), `build-ui-static` (2247), `test-e2e` (2273), `e2e-vscode` (2355) |
| Scope rule | `Makefile` and `docker-compose*.yml` are forbidden paths by default; a change needs a `BRxx-EXn` exception (`rules/MASTER.md`, "Branch Scope Control") |
| Other readers of the `ui` root | root npm workspace (`package.json:6`); the API image, which copies `ui/package.json` (`api/Dockerfile:497`) and hashes it into its tag (`Makefile:86`); the UI image tag, hashed over `ui` and `packages` (`scripts/ci/ui-image-version.sh:6-8`); CI change classifier, lockfile-install scanner, security inventory, SCA gate and their tests; one API test and one chat-ui test fixture that read `ui/src`. Full list with `file:line` in section 6.13 |

### 2.7 Tests

| Item | Fact [FAIT] |
|---|---|
| Unit tests | 90 test files + 4 support files under `ui/tests`: `utils` 36, `components` 14, `vscode-ext` 14, `stores` 10, `chat` 6, others 10 |
| Unit tests bound to Svelte | 14 files reference a `.svelte` file, by import or by reading its source as text (example of the latter: `ui/tests/components/chat/ChatWidget-agents-list.test.ts:16`); 11 files import `svelte`, `svelte/*` or `@testing-library/svelte` |
| Repository rule | UI unit tests are TypeScript tests only, no component tests (`rules/testing.md:71`) |
| End-to-end | 61 specs, 15,303 lines under `e2e/tests`; Playwright |
| E2E lanes | 56 numbered specs form the default groups and the blocking CI matrix (`Makefile:3048`; `scripts/ci/browser-shards.mjs:68-71`), where every collected test must end with its expected status and a retry counts as a failure (`browser-shards.mjs:124-133`); the VS Code spec has its own lane (`.github/workflows/ci.yml:2362`); the 3 specs under `dev/` run only with `playwright.dev.config.ts` (`Makefile:458-487`); `a4/identity-cutover.spec.ts` has no lane named in `Makefile` or in the workflow (`unknown`) |
| E2E sessions | the global setup signs the four users in through the API and sets the session cookie in the browser context (`e2e/global.setup.ts:426-448`, `:485-502`); it then only checks that a protected URL does not redirect to `/auth/login` (`:454-457`). A stored session needs no login screen |
| E2E variable data | `Date.now()` 144 occurrences in 41 files under `e2e/tests` and `e2e/helpers` (example: `00-access-control.spec.ts:27`); created identifiers feed API paths (`00-access-control.spec.ts:35-38`) |
| Specs that reach `/neutral` | 2, and neither stays inside the landing page: `06-tooling-visual-parity.spec.ts:26-67` (login screen, `/home`, organizations list, organization detail, chat widget) and `00-ai-generation.spec.ts:198-220` (goes on to `/folder/new` and its editor; on the AI allowlist). `01-app.spec.ts` covers `/` and the header, and its fourth test needs the folders page (lines 72-99) |
| E2E selector styles | `getByRole` 210, `getByTestId` 35, `getByText` 36; `locator(` 771, of which 403 start with a tag name and 152 contain a `.name` class token; 79 Tailwind-like class tokens (`.bg-`, `.text-`, `.rounded`, `.flex`, …) in 16 files |
| E2E and print | 2 specs switch to print media with `emulateMedia`: `05-executive-summary.spec.ts:159-195` (annex sections, their titles and the order of the table-of-contents page numbers on `/dashboard`) and `05-usecase-detail.spec.ts:585-614` (conditional on the seeded cards; class-based locators; body height against one A4 page). 0 spec uses `page.pdf` or `window.print`: there is no paged PDF reference and no assertion of content per page |
| E2E rules | no timeout increase; AI-dependent specs are on a non-blocking allowlist of 6 files (`rules/testing.md:42`, `:103`) |

### 2.8 DS usage today and local UI primitives

[FAIT] DS usage in `ui/`: 2 import statements, 3 components (`ChatWidget.svelte:43`, `routes/auth/+layout.svelte:7`) and the `entropicTheme` theme (`routes/auth/+layout.svelte:8`). The dependency is `@sentropic/design-system-svelte ^0.34.40` (`ui/package.json:75`). Everything else on screen is local markup.

Census of local markup [FAIT, `git grep` on `ui/src/*.svelte`]:

| Pattern | Occurrences | Files | Where it concentrates |
|---|---|---|---|
| `<button` | 181 | 36 | ChatWidget 28, settings page 23, matrix page 16, Header 13 |
| `<input` | 43 | 10 | ChatWidget 11, ImportExportDialog 7, matrix page 7; `type="number"` 10, `type="checkbox"` 7, `type="radio"` 6, `type="file"` 2 |
| `<select` | 14 | 7 | ChatWidget 5, settings page 3 |
| `<textarea` | 8 | 4 | TodoRuntimeConfigPanel 4, ChatWidget 2 |
| `<table` | 7 | 3 | matrix page 5, DocumentsBlock 1, WorkspaceSettingsPanel 1 |
| `<label` | 45 | 10 | ImportExportDialog 9, ChatWidget 8 |
| `<a` | 31 | 12 | Header 9, dashboard page 5 |
| hand-made overlay (`fixed inset-0`) | 8 | 5 | matrix page 3, Header 2, ImportExportDialog, NavigationGuard, WorkspaceCreateDialog |
| spinner (`animate-spin`) | 16 | 11 | — |
| `class="` | 1,607 | 59 | settings page 208, matrix page 166, ChatWidget 163, dashboard page 115 |
| `<style` block | 9 | 9 | — |
| `{@html` | 23 | 6 | TemplateRenderer and Markdown consumers |
| `@lucide/svelte` import | 35 files | — | 67 distinct icons; `Trash2` 13, `X` 12, `Lock` 9, `Loader2` 7 |
| `$_(` (i18n call) | 960 | 43 | — |

HTML built in script and inserted as content [FAIT]. A lint on template nodes does not see these strings:

| # | Generator | Evidence | What it writes |
|---|---|---|---|
| GH-1 | citation link of the application | `ui/src/lib/utils/markdown.ts:172-175` | Tailwind classes, inline `style`, inline `onclick` |
| GH-2 | citation link, list and heading classes of chat-ui | `packages/chat-ui/src/utils/markdown-refs.ts:161-164`, `:232-241` | Tailwind classes, inline `style`, inline `onclick` |
| GH-3 | reference excerpt and reference link in the templater script | `TemplateRenderer.svelte:78`, `:83` | Tailwind classes |
| GH-4 | citation links written into the editor's DOM after each render | `EditableInput.svelte:408-470` | Tailwind classes, inline colour |
| GH-5 | editor node extensions | `ui/src/lib/extensions/tailwind-classes.ts:12-57` | Tailwind classes, inline `style` |
| GH-6 | streamed chat content | `svelte-streamdown` in `packages/chat-ui/src/components/StreamMessage.svelte:980-1017` and `ChatPanelShell.svelte:329`; Tailwind wrappers noted at `StreamMessage.svelte:1113` | Tailwind classes |

- The sanitiser of the application wrapper lets GH-1 and GH-2 through: its allow-list holds `class`, `style` and `onclick`, and every class is allowed (`ui/src/lib/utils/markdown.ts:145-148`). GH-3 to GH-6 do not pass through it.
- Consumers of the list and heading classes: `TemplateRenderer.svelte:497`, `:537`, `:578`, `:658` (locked and print modes, line 496), `ScoreTable.svelte:38`, `routes/dashboard/+page.svelte:1297`. The chat host passes the same function to the package (`AppChatPanel.svelte:3412`).

Syntax [FAIT]: `export let` 292 occurrences in 34 files, `$:` 382 in 52 files, `on:click` 199 in 37 files, `createEventDispatcher` in 12 files, `<slot` 15 in 8 files; runes (`$props` …) in 1 file.

Each local UI primitive and the DS component that replaces it [JUGEMENT; DS identifiers are catalogue entries]:

| Local primitive | Evidence [FAIT] | DS component |
|---|---|---|
| Buttons, icon buttons, link-buttons | 181 `<button`, 31 `<a` | `button`, `icon-button`, `link`, `copy-button` |
| Text, number and multi-line fields | 43 `<input`, 8 `<textarea` | `input`, `number-input`, `textarea`, `search` |
| Selects | 14 `<select` | `select`, `dropdown` |
| Checkboxes, radios, file inputs | `type="checkbox"` 7, `type="radio"` 6, `type="file"` 2 | `checkbox`, `radio-group`, `file-uploader` |
| Tables | 7 `<table` | `table`, `data-table` |
| Dialogs and overlays | 8 `fixed inset-0` | `modal`, `drawer` |
| Popovers and menus | `MenuPopover.svelte`, `FileMenu.svelte`, `DocumentSourceMenu.svelte`, `MenuTriggerButton.svelte` | `menu-popover`, `menu`, `overflow-menu`, `menu-trigger-button` |
| Tabs | hand-made tab bar, `TemplateRenderer.svelte:463-475` | `tabs` |
| Cards and tiles | `FieldCard.svelte`, `ConfigItemCard.svelte`, card grid of `ContainerView.svelte:191-253` | `field-card`, `config-item-card`, `card`, `tile` |
| Badges and pills | `CommentBadge.svelte`, badge spans of `ContainerView.svelte:215` | `badge`, `tag`, `status-dot` |
| Ratings | star loops for value, cross and dash loops for complexity: `TemplateRenderer.svelte:619-634`, `ScoreTable.svelte:54-64` | `rating` for the star scale; the cross-and-dash scale is exception EX-8 (DS gap G-8) |
| Toasts | `Toast.svelte` | `toast` (stack region: DS gap G-4) |
| Spinners and skeletons | 16 `animate-spin`; skeleton of `ContainerView.svelte:171-178` | `inline-loading`, `loading-state`, `skeleton-text` |
| Empty states and error banners | `ContainerView.svelte:182-184`, `TemplateRenderer.svelte:741-743` | `empty-state`, `alert` |
| Header and navigation | `Header.svelte` (450 lines) | `app-header` or `header`, `nav-item`, `language-selector`, `IdentityMenu` |
| Rich-text editor | `TipTap.svelte` on `@tiptap/core` (line 3) | `RichTextEditor` (DS lot V8) |
| Lock and presence badge | `LockPresenceBadge.svelte` | `LockPresenceBadge` (V8) |
| Icons | 67 lucide icons | DS `icon` on lucide data (V9) |
| Layout utilities | 1,607 `class="` (flex, grid, spacing, colours) | `stack`, `flex`, `grid`, `row`, `col`, `container`, `divider`, `panel-section`, `typography` |
| Scatter chart | `InitiativeScatterPlot.svelte` on `chart.js` | exception EX-1 at the cutover; DS `scatter-plot` / `priority-matrix` later (DS gap G-1) |

### 2.9 Dependencies without a Vue equivalent

| Dependency | Facts [FAIT] | Resolution [JUGEMENT] | Lot |
|---|---|---|---|
| `@sveltejs/kit`, `adapter-static`, `vite-plugin-svelte` (`ui/package.json:26-28`) | routing and navigation API (`$app/navigation`, `$app/stores`, `$app/environment`), build | Vite + one neutral router (section 3.3) | A0a, A0b |
| `@sentropic/chat-ui` 1.0.1 (`ui/package.json:72`, `file:` link) | 24 Svelte views; required peers `svelte`, `@lucide/svelte`, `svelte-streamdown` (`packages/chat-ui/package.json`); the app imports 23 specifiers, of which 10 `.svelte` views; 561 Tailwind-like utility tokens in 20 of the 24 views, compiled by the host stylesheet (`ui/src/app.css:5`); for hosts without Tailwind the package exports `./theme.css` (`package.json:24`), a file of 1,485 lines generated from those utility classes and scoped to `[data-st-chat-theme]` (`src/theme/chat-ui.css:1-14`); the package ships its sources (`main`, `files`: `package.json:12`, `:241-247`) and declares CSS files as side effects (`:252-255`); 20 views import no other view, 4 are compositions (section 6.5) | additive `./vue` and `./vue/vapor` subpaths on DS chat primitives, with no host Tailwind and without `./theme.css`; content styles shipped by the package as `./content.css` (section 3.5.1) | C0–C6a |
| `svelte-streamdown` (`ui/package.json:89`) | imported by 2 chat-ui files (`StreamMessage.svelte:4`, `ChatPanelShell.svelte:18`), by no file of `ui/src` | neutral streaming Markdown core on `marked` + sanitiser | C1 |
| `@sentropic/chat-core` 0.3.2 | framework-neutral except `src/runtime/stores/localTools.ts` (692 lines, `svelte/store`, line 39) | neutral twin of the store | C1 |
| `@sentropic/auth-ui` 0.9.1 | 9 Svelte components; required peers `svelte`, `design-system-svelte`; the app imports the root and 4 components; DS imports: `Alert`, `Button`, `Card`, `Input`, `Typography`; its components are also imported by two `cluster-mesh` screens and by four pages of the identity-provider front (section 6.12) | additive `./vue`, `./vue/vapor` subpaths (K27, `PLAN.md:215`) | A1d |
| `@sentropic/cluster-mesh` `ui/` 0.26.0-dev.26 | 5 Svelte screens and 3 `.ts` modules imported by the app; DS imports: `Alert`, `Button`, `Input`; `LoginScreen` and `RegistrationScreen` import `AuthLogin` and `AuthRegister` of `auth-ui`, an optional peer of the package (`packages/cluster-mesh/ui/LoginScreen.svelte:2`, `RegistrationScreen.svelte:2`; `packages/cluster-mesh/package.json:263`) | additive subpaths, after those of `auth-ui` | A11 |
| `@sentropic/cited-source-viewer` 0.2.0 | 3 Svelte files; **no importer** under `ui/`, `apps/`, `e2e/` or another package | not a dependency of the app; kept in A11 as in the DS plan, off the app's critical path | A11 |
| `@sentropic/cowork-bridge` 0.2.0 | no Svelte component; required peer `svelte`; 2 Svelte-bound modules: `src/core/context-provider.ts` (`svelte/store`, line 10; `createSvelteKitContextProvider`, line 46) and `src/core/navigation-adapter.ts` (`createSvelteKitNavigation`, line 68); used by the root layout (`+layout.svelte:13-19`, `:199`) | additive neutral factories; `svelte` becomes an optional peer | A0a |
| `@lucide/svelte` ^0.562.0 (`ui/package.json:69`) | 35 app files, 67 icons; 4 chat-ui views, 10 icons | DS `icon` on the neutral `lucide` data (K7, `PLAN.md:195`); no Vue icon package in the app | V9, then each lot |
| TipTap: `@tiptap/core`, `@tiptap/pm`, 5 extensions, `starter-kit`, `tiptap-markdown` (`ui/package.json:78-85`, `:90`) | `TipTap.svelte` uses `@tiptap/core` directly (line 3) with the node extensions of `tailwind-classes.ts` (line 12); citation links are added by rewriting the editor's DOM (`EditableInput.svelte:427-470`). DS `RichTextEditor` takes a `RichTextDocument` and a content `profile` and has no extension prop (DS `packages/components-svelte/src/lib/rich-text-editor/RichTextEditor.svelte:35-73`) | DS `RichTextEditor` behind a Markdown adapter; the local extensions and the DOM rewriting are not carried (DS gap G-12, decision D8); `@tiptap/vue-3` is not added (its Vapor compatibility is `unverified`) | A7b |
| `@simplewebauthn/browser` ^13.2.2 (`ui/package.json:77`) | framework-neutral; not imported by `ui/src`; imported by `packages/auth-ui/src/webauthn.ts` | unchanged | A1d |
| `svelte-i18n` (`ui/package.json:49`) | 960 `$_(` calls; storage key `locale`, fallback `fr` (`ui/src/lib/i18n.ts:7-8`); 2 catalogues of 1,713 lines | neutral i18n module on `intl-messageformat` (section 3.7) | A0a |
| `chart.js` (`ui/package.json:86`) | framework-neutral; one importer (`InitiativeScatterPlot.svelte:5`) | kept as engine, exception EX-1 | A4a |
| `chartjs-plugin-datalabels` (`:87`), `@types/d3` (`:34`) | no importer under `ui/` | not carried to the candidate | A0a |
| `marked`, `dompurify` (`:88`, `:39`) | framework-neutral engines; their wrapper `ui/src/lib/utils/markdown.ts` writes Tailwind classes and allows `class`, `style` and `onclick` (section 2.8) | engines kept; wrapper and allow-list re-authored for the candidate (section 3.5.1) | C1, T2 |
| `tailwindcss` (`:50`) | 1,607 `class="`; print stylesheet coupled to it | not installed in the candidate (rule DS-3) | all |

---

## 3. Target architecture

### 3.1 Runtime: Vue 3.6, Vapor first, signals

External facts [FAIT, npm registry dist-tags and GitHub release notes, read 2026-11-12 22:15 Montréal]:

| Fact | Source |
|---|---|
| `vue`: `rc` = 3.6.0-rc.15 (released 2026-11-12), `latest` = 3.5.45; no stable 3.6.0 | `registry.npmjs.org/-/package/vue/dist-tags`; `vuejs/core` releases |
| `@vitejs/plugin-vue` `latest` 6.0.11; `vue-tsc` `latest` 3.3.14; `@vue/compiler-sfc` `rc` 3.6.0-rc.15 | same registry |
| "Vapor Mode is feature-complete in Vue 3.6 RC. For now, we recommend using it in the following cases: partial usage in existing apps […]; building small new apps entirely in Vapor Mode." | release note of `v3.6.0-rc.1` (2026-07-18) |
| Unsupported in Vapor: Options API, `app.config.globalProperties`, `getCurrentInstance()` (returns `null`), `@vue:xxx` lifecycle events, `v-memo`, `$el` / `$props` / `$attrs` / `$slots` / `$refs` on component template refs | same note, "Feature Compatibility" |
| "Components authored with render functions or JSX remain VDOM components and also require interop when used in a Vapor application"; the interop plugin "pulls in the VDOM runtime" | same note |
| Vapor delegates eligible events to `document`: an ancestor calling `stopPropagation()` prevents the delegated handler; `slots.default()` is not a side-effect-free dry run; custom directives use a different interface | same note, "Important Usage Considerations" |
| Vue 3.6 reactivity is a port of `alien-signals` | same note |

Consequence [JUGEMENT]: an application of 27,610 lines is outside the use that the Vue team recommends for Vapor today. The owner has decided to run Vapor on the pinned release candidate (AD7, `PLAN.md:20`); this plan applies that decision and keeps a second build output as the only mitigation (risk R1).

Authoring rules of the candidate (owner constraint; K25, `PLAN.md:213`), all enforced by lint from lot A0a:

1. Single-file components with `<script setup lang="ts">` and a template. No `h()`, no JSX, no render function, no Options API.
2. No `vapor` attribute and no `/vapor` import written in sources: the build produces the Vapor variant. One bootstrap file selects `createVaporApp` (default) or `createApp`.
3. No `getCurrentInstance`, no `app.config.globalProperties`, no `v-memo`, no reliance on `$el` or `$refs` of a child component, no call of a slot function outside the template.
4. No `stopPropagation()` on a path that carries a delegated handler; where it is needed, the listener is attached directly (`v-on="{ click: handler }"`).
5. State: `ref`, `shallowRef`, `computed` inside components; neutral signals at module edges (section 3.4).
6. Exact pins, never ranges, for `vue`, `@vue/compiler-sfc`, `@vitejs/plugin-vue`, `vue-tsc`: the matrix delivered by DS lot V0a. Each pin bump is a reviewed PR that re-runs both entries.

Two build outputs from one source tree (K10, `PLAN.md:198`): the **Vapor entry** on the exact pin, which production runs, and the **classic entry** on `vue ^3.5`, built and tested by every lot PR. The classic entry is a second output of the same files, not a second code base and not a legacy path.

Svelte to Vue mapping used by every lot [JUGEMENT]:

| Svelte (occurrences, section 2.8) | Vue Vapor |
|---|---|
| `export let` (292) | `defineProps` with an exported props type |
| `$:` (382) | `computed`, `watch`, `watchEffect` |
| `createEventDispatcher` (12 files), `on:click` (199) | `defineEmits`, `@click` |
| `$store` | `useSignal(store)` (section 3.4) |
| `<slot>`, named slots with props (15) | `<slot>`, scoped slots |
| `<svelte:component this={icon}>` (`ContainerView.svelte:128`) | DS `icon` by name; `<component :is>` only for application views |
| `<svelte:self>` (`TemplateRenderer.svelte:714`) | recursive self-reference; Vapor support `unverified`, witnessed by T1b |
| `{@html}` (23) | `v-html` on sanitised output only (allow-list, exception EX-5) |
| `transition:` (8 in 4 files) | DS component behaviour; no local transition |
| `onMount`, `onDestroy`, `tick` | `onMounted`, `onScopeDispose`, `nextTick` |

### 3.2 Repository layout and build

The layout is the one of the DS plan (K26, `PLAN.md:433-458`) [JUGEMENT: adopted, with two differences listed in section 9.1]:

| Root | Content | Life |
|---|---|---|
| `ui/` | the Svelte application, deployed from `main` | reference until the cutover; deleted by A15 |
| `ui-shared/` | framework-neutral code: stores as neutral signals, navigation policy, i18n, templater contract and core, view-models, engines; after A14 also the neutral modules moved out of `ui/src`, locales, static assets, shared suites | permanent |
| `ui-vue/` | Vue views, the bootstrap file, the application stylesheets, build and test targets for both entries, Vue entries of the two extensions | permanent |
| `ui-preact/` | second pass, not in this plan | later |

- Candidates import shared code through one alias, `@shared/*`. Until A14 the alias also resolves the 53 neutral modules still located in `ui/src` (no copy). A candidate file never writes a path that names `ui/`.
- **No-reference check** (CI, from A14): `ui-vue/` is built and unit-tested in a checkout where `ui/` has been removed.
- Build: Vite, static output, the same nginx configuration as today (`ui/nginx/default.conf`), in a separate `ui-vue/Dockerfile` so that the cutover deletes `ui/` without touching the candidate.
- Roots and names [JUGEMENT]: `ui-vue/` is a standalone root with its own `package.json` and lockfile and is not added to the root workspaces (`package.json:4-9`), as `e2e/` and `apps/auth-idp/web` are today (the latter consumes `auth-ui` through a `file:` link with its own lockfile, `apps/auth-idp/web/package.json:30`); the candidate therefore adds no workspace to the root lockfile and no input to the API image tag. `ui-shared/` has no manifest and no lockfile: its tests run in the toolchain of the candidate that includes it. The compose service, the image, the inventory key `ui-production` and the CI filter output keep the name `ui`; only the paths behind them change, at A15. Every repository tool that reads the `ui` root is listed in section 6.13 with the lot that changes it.
- Proposed make targets [JUGEMENT, names to confirm with s-conductor]: `build-ui-vue`, `typecheck-ui-vue`, `lint-ui-vue`, `test-ui-vue`, and a `UI_TARGET=svelte|vue` variable on `test-e2e`, `dev` and `build-ui-image`, so that one UI service runs per environment and the three port variables stay unchanged. A0a owns all of them, including the candidate end-to-end lane that runs the candidate spec manifest (section 4.3.1).
- Candidate-only harness entry [JUGEMENT]: `ui-vue/harness.html` mounts one component or composite per page, without the router and without the shell, and is excluded from the production build (A0a). It is the bench of the lots that deliver components rather than routes (T1a, A7b, A9, T1b, T1c, A8a); their specs live under `e2e/tests/harness/`, outside the numbered groups of the reference matrix.
- These targets touch `Makefile`, `docker-compose*.yml`, `.github/workflows/ci.yml` and the lockfile policy: scope exceptions `BRxx-EXn` are required and are listed per lot in section 6.
- Root container: the candidate mounts on `#app`. It does not reuse `ui/src/app.css` (Tailwind) or `ui/src/app.print.css`; the `#svelte` constraint of `PLAN.md:452` therefore does not apply.

### 3.3 Router and server-side rendering

Facts [FAIT]:

| Option | Fact | Source |
|---|---|---|
| Nuxt 4.6 | "Nuxt now supports Vue 3.6's Vapor Mode in interop mode. Your app root stays on the virtual DOM, and you can opt individual components or pages into Vapor" | release note of `nuxt` v4.6.0 (2026-10-05); `latest` = 4.6.4 |
| `vue-router` 5.5.0 | `RouterView` and `RouterLink` are `defineComponent` + `h()`; `install()` registers them and writes `app.config.globalProperties.$router` | `vuejs/router` tag `v5.5.0`: `packages/router/src/RouterView.ts:61`, `:225`; `RouterLink.ts:266`, `:314`; `router.ts:1040-1046` |
| `vue-router` release notes | of the last 40 releases, only v5.5.0 mentions Vapor, as a bug fix ("Fallback to useId for vapor") | `vuejs/router` releases |
| The application | client-only, static, no server rendering (`ui/src/routes/+layout.ts:1-3`); nginx serves the shell for every path (`ui/nginx/default.conf:9-12`) | section 2.1 |

| Option | Fit with "Vapor only, no `h()`" | Server rendering | Verdict [JUGEMENT] |
|---|---|---|---|
| Nuxt | no: the root stays on the virtual DOM, Vapor is per component in interop mode | adds a server or a generation step that the application does not need | rejected |
| Vite + `vue-router` | no on the Vapor entry: its two components need the interop plugin, which brings the virtual-DOM runtime back; its installation uses an API unsupported in Vapor | none | rejected for the Vapor entry; kept only as the documented fallback on the classic entry |
| **Vite + the neutral router of the DS programme** (K17, lot L1.7, `PLAN.md:205`, `:563`) | yes: plain TypeScript on neutral signals, one router for the Vue and Preact builds | none | **recommended** |

Recommendation: a **Vite single-page application without server rendering**, routed by the neutral router. Server rendering is not introduced: the application has none today, every route except five public ones is behind authentication (`+layout.svelte:49-55`), and the static nginx image is unchanged.

What the application needs from the router (input to L1.7) [FAIT for the usages, section 2.1]:

- 23 routes, 4 of them with an `[id]` segment; a not-found route.
- History mode; reads of path, parameters and query as signals (`$page`, 23 usages).
- Programmatic navigation with replace (`ui/src/routes/home/+page.svelte:8`); 48 `goto(` call sites.
- A guard that can cancel a navigation and redirect (`+layout.svelte:284-335`), plus the unsaved-change dialog.
- The `returnUrl` round trip of the login redirect (`+layout.svelte:268`).
- Interception of in-application links rendered by DS `link` and `nav-item`.

The route table and the guard logic are written by A0a as pure functions in `ui-shared/navigation/` (public and protected lists, the two workspace locks), independent of any router; A0b binds them to L1.7. The package name and publication channel of the neutral router are a `source-gap` of the DS plan (section 5.4).

### 3.4 State: Svelte stores to neutral signals

- The 16 non-templater stores become modules of `ui-shared/stores/` built on neutral signals, with the same exported names, the same functions and the same browser-storage keys (A0a). The 2 templater stores belong to T2.
- Signal library: the choice of the DS programme, `@preact/signals-core` (K19, `PLAN.md:207`; `latest` 1.14.5 [FAIT, registry]). The DS spike S4 can replace it by `alien-signals` (`latest` 3.2.1); the store modules expose their own small API so that the library is named in one file.
- One bridge, `useSignal()`, turns a neutral signal into a Vue `Ref` through `customRef` (design in `PLAN.md:349-360`). It is the only Vue file that names the signal library.
- Inside components: `ref`, `shallowRef`, `computed`. No Pinia (it installs through the application instance and cannot be shared with the Preact build).
- The 10 store test files (`ui/tests/stores`) are copied under `ui-shared/`, re-pointed at the neutral modules, and must pass unchanged in their assertions. The originals stay with `ui/`, which A0a does not edit.
- [JUGEMENT] If the owner removed the Preact pass of the application, plain Vue reactivity modules would be simpler; the neutral choice is kept because the DS programme makes the Preact build mandatory (K13, `PLAN.md:201`).

### 3.5 DS consumption: the "100 % design system" rule

Definition [JUGEMENT]. The candidate is 100 % design system when the seven rules below hold on `ui-vue/**` and on the Vue subpaths of `chat-ui`, `auth-ui` and `cluster-mesh/ui`, with no exception outside the register. The result is always reported as three figures (below), never as one.

| Rule | Statement | Check |
|---|---|---|
| DS-1 | no raw control element in a template: `button`, `input`, `select`, `textarea`, `table`, `dialog`, `label`, `progress`, and no `a` without DS `link` | lint on template nodes |
| DS-2 | no local component whose role is covered by a DS catalogue entry; every local component is a `composite` (made of DS components and layout only) or a registered exception | coverage manifest, one row per view and local component |
| DS-3 | no utility-class styling and no `<style>` block: Tailwind is not installed; layout uses DS layout components and tokens | lint: no `class` literal outside the allow-list, no `<style>`; dependency check |
| DS-4 | icons only through DS `icon`; no `@lucide/*` or `lucide-vue-next` import | lint on imports |
| DS-5 | colours, spacing and typography only through DS tokens and `ThemeProvider` with `entropicTheme`; no colour literal | lint |
| DS-6 | a third-party rendering engine is hosted by a DS component or registered as an exception | manifest |
| DS-7 | generated content obeys the same rules: no element of the rendered DOM carries a class outside the allow-list (DS component classes and registered hooks), and generated content carries no inline `style` and no inline event handler | fixtures of the generators (section 3.5.1) and a scan of the rendered DOM on every page of the candidate specs and of the harness specs, in screen and in print media |

Exception register (each entry has a kind, an owner lot and an exit condition):

| # | Kind | Exception | Reason | Exit |
|---|---|---|---|---|
| EX-1 | temporary | `chart.js` canvas of the initiative scatter plot | label-placement engine of about 1,340 lines (`InitiativeScatterPlot.svelte:97-1440`); DS `scatter-plot` coverage of it is `unverified` | DS gap G-1 closed, then a separate convergence lot (owner decision D3) |
| EX-2 | permanent | `ui-vue/src/styles/print.css` | paged-media rules (`@page`, breaks, cover, annex) are not component styling | none: limited to `@media print`, tokens and `data-print` hooks only |
| EX-3 | temporary | `ui-vue/src/styles/shell.css`: page frame, chat-dock offsets, position of the toaster region | `+layout.svelte:385-391`; no DS region component for toasts (gap G-4) | DS gaps G-3 and G-4 closed |
| EX-4 | permanent | Google Drive Picker | interface hosted by Google (`ui/src/lib/utils/google-drive-picker.ts`) | none |
| EX-5 | permanent | `v-html` directive, only on the output of the single sanitising generator of section 3.5.1 and only in one content view per consumer (application: `ui-vue/src/components/content/`; `chat-ui`: its Vue entry), which sets the content hook | rendered Markdown is content, not markup of the application | none |
| EX-6 | permanent | editor content inside DS `RichTextEditor` | owned by the DS component | none |
| EX-7 | temporary | `@sentropic/chat-ui/content.css` (file `packages/chat-ui/src/content/content.css`, owner lot C1): typography of rendered Markdown (headings, lists, links and citations, code, quotes, tables), DS tokens only, every selector under the content hook `[data-st-content]`. One artifact, shipped by the package and loaded unchanged by the application; no copy under `ui-vue/` | the DS has no container that styles generated children (gap G-2) | DS gap G-2 closed |
| EX-8 | temporary | complexity scale (cross and dash glyphs) as a composite of DS `icon` | DS `rating` draws stars only (gap G-8); the role is covered by a catalogue entry, so this is an exception and not a composite | DS gap G-8 closed |

Bounds on the register [JUGEMENT]:

- **Three figures.** G-DS reports (1) DS coverage: manifest rows rendered by DS components, or by composites made of DS components only, over all rows; (2) temporary exceptions: count, each with its DS request and its exit; (3) permanent exceptions: count. "100 % design system" at M-APP means figure (1) = 100 % of the rows outside the register, stated with figures (2) and (3) beside it.
- **Closed list.** The register is closed when AE2a merges: 4 permanent and 4 temporary entries. The manifest check fails on a ninth entry.
- **No promotion by default.** A composite whose role is covered by a DS catalogue entry is a temporary exception, not a composite (EX-8 is the case of `rating`).
- **Owner decision to grow.** A new entry, or a temporary entry turned permanent, needs an owner decision recorded on the track item; s-conductor cannot add one alone. The owner approves the register at M-APP with the visual-difference list (decision D4).

Measured baseline and target:

| Metric (section 2.8) | Today | Target at M-APP |
|---|---|---|
| DS components imported by the application | 3 | every control on screen |
| raw `<button` / `<input` / `<select` / `<textarea` / `<table` | 181 / 43 / 14 / 8 / 7 | 0 |
| `class="` occurrences | 1,607 | 0 outside the allow-list of the register |
| `<style` blocks | 9 | 0 |
| files importing an icon package | 35 | 0 |
| generators that write styling into HTML strings (section 2.8) | 6 | 0 |
| Tailwind | installed | not installed |
| register | — | 4 permanent, at most 4 temporary |

Import rule: DS components are imported from the Vapor entry of `@sentropic/design-system-vue` through per-component subpaths and per-icon data imports as soon as the DS ships them (accepted by the DS on 12/11: `.tmp/builder-dossier/q1-findings.md:8`; the measured cost of the barrel is 4,184 modules for two components, `q1-findings.md:3`). The subpath names are a `source-gap` (DS gap G-9).

### 3.5.1 Generated HTML: one contract, checked on the DOM

[JUGEMENT] Target; the generators are the [FAIT] of section 2.8.

- **One neutral generator.** C1 adds to the neutral core of `chat-ui` a content renderer on `marked` whose output is semantic HTML without any `class`, inline `style` or inline handler: a citation is `<a href="#ref-N" data-ref="N">`, lists and headings are bare elements. Streamed content (GH-6) uses the same renderer.
- **One application wrapper.** T2 writes `ui-shared/content/markdown.ts`: the three rendering functions of today on the neutral generator, and a sanitiser allow-list without `style` and `onclick`, which also strips `class`. The neutral helpers of `ui/src/lib/utils/markdown.ts` (normalisation, list conversion) are reused through the alias.
- **The Svelte output does not move.** `packages/chat-ui/src/utils/markdown-refs.ts` and `ui/src/lib/utils/markdown.ts` are not edited, and their unit tests stay unchanged (`packages/chat-ui/tests/markdown-refs.spec.ts`, `ui/tests/utils/markdown.test.ts`). C1 adds a golden test of the HTML that the chat-ui generator returns today on the fixtures of rule DS-7. Both files leave with C6c and A15.
- **Behaviour replaces the inline handler.** The smooth scroll to a reference is one listener on the content container, not an attribute in the HTML.
- **Templater strings become data.** T2 returns reference items as title, URL and excerpt; the Vue template renders them with DS `link` (GH-3).
- **Editor.** The node extensions and the DOM rewriting (GH-4, GH-5) are not carried: DS `RichTextEditor` owns its content (exception EX-6) and has no extension prop. Citations inside the editor are gap G-12 and decision D8.
- **Styling** of the generated elements: the DS content container when gap G-2 is closed; until then exception EX-7, one stylesheet delivered by the package, so that a consumer of `chat-ui` needs no file of the application:
  - *Artifact.* `packages/chat-ui/src/content/content.css`, written by C1 with the generator whose output it styles. Tokens only (`var(--st-*)`), no utility class, no `--tw-*` variable, every selector under `[data-st-content]`. It replaces nothing on the Svelte path: `./theme.css` (generated from Tailwind utilities, section 2.9) stays the stylesheet of the Svelte entry until C6c and is not loaded by any Vue view.
  - *Export.* A subpath `./content.css` beside `./theme.css` (`packages/chat-ui/package.json:24`), entered in `export-manifest.json` and checked by `tests/export-surface.spec.ts`; CSS files are already declared as side effects (`package.json:252-255`). C1 merges before V10a, so the subpath exists before any Vue view is validated.
  - *Loading.* One explicit import per consumer, `import '@sentropic/chat-ui/content.css'`, the convention the package already documents for `./theme.css` (`src/theme/chat-ui.css:7-9`). The hook is set by the content view that applies `v-html` (exception EX-5): the Vue entry of the package has one, the application has one (`ui-vue/src/components/content/`, T1b), and that view is the only application file that imports the stylesheet.
  - *Same artifact for the application.* T1b imports the package subpath; `ui-vue/src/styles/content.css` is not created, and a lint of AE2b refuses any other rule on `[data-st-content]` outside `print.css`.
  - *Check.* C1: a stylesheet contract test (selector scope, tokens only). C2a and C2b, the two lots whose views render generated content (`StreamMessage.svelte:980`, `:1000`; `ChatPanelShell.svelte:329`): the host page without Tailwind loads this subpath and nothing else for content. C6a: the packed consumer, installed from the tarball in a directory outside the repository, asserts computed styles of a heading, a nested list, a code block and a citation link, and the same page without the import fails (section 6.5).
- **Check (rule DS-7).** Fixtures run each generator on Markdown with headings, nested lists, links, code, citations with and without a matching reference, inline Markdown and a truncated stream, and assert the contract. The rendered-DOM scan of AE2b runs on every page visited by the candidate specs and by the harness specs, in screen and in print media: locked and print modes are the ones that render generated HTML in the templater (`TemplateRenderer.svelte:496`).

### 3.6 Templater: a Vue Vapor renderer of the same view-template contract

Facts [FAIT]. Two contracts live under the name "templater" (as recorded by `PLAN.md:122-134`, re-read here):

| Family | Files | Contract | Consumers |
|---|---|---|---|
| (a) container | `ViewTemplateRenderer.svelte` (44) → `ContainerView.svelte` (256) → `FileMenu.svelte` (156) | TypeScript type `ViewTemplateDescriptor` (`ui/src/lib/types/view-template.ts:62-81`): callbacks (lines 24, 44, 54-58), a `cardRenderer` function (line 75), component-valued icons (lines 26, 40), Tailwind class strings (`iconColorClass`, `colorClass`, lines 41-42). Client-only, never serialised | `routes/neutral/+page.svelte:14` only |
| (b) tabs, rows, fields | `TemplateRenderer.svelte` (754), with `FieldCard`, `ScoreTable`, `EditableInput` | JSON descriptor served by the API (`viewTemplateCache.ts:31`) and seeded in `api/src/services/view-template-service.ts:391-604`: 5 common descriptors (lines 409-492) and 2 initiative descriptors (lines 509-552 and 554-604), that is 7 shapes and 17 seed rows over 3 workspace types | `InitiativeDetail.svelte`, `OrganizationForm.svelte`, `routes/dashboard/+page.svelte`; catalogue in `ViewTemplateCatalog.svelte` → settings page |

Family (b) in detail [FAIT, `TemplateRenderer.svelte`]:

- 8 field types: `scores-summary` (line 614), `text` (640), `list` (667), `scores` (689), `child-list` (701, a placeholder text today), `chart` (705) and `component` (708), both filled by the page through named slots, `entity-loop` (711), which recurses with `<svelte:self>` (714) on a sub-template resolved at run time (lines 422-439).
- The JSON carries presentation data: `printClass`, `printGridClass`, `pageBreakBefore`, `pageBreakAfter`, `pageBreakInside`, `printOnly`, `screenOnly`, `pageContext`, `color`, `variant`, `span`, `columns` (seeds, lines 443-456 and 517-548; renderer, lines 486, 529, 613).
- The script (lines 38-457) is framework-independent logic: nested value access, tab visibility (lines 134-147), collaborative buffers merged on server-sent updates (157-270), save-payload builders (304-374), label resolution (391-417).

Target [JUGEMENT]:

1. **The API descriptor of family (b) does not change**: no API change, no seed change, stored custom descriptors keep rendering. The API and the `app_templates` table stay out of scope, as do the DOCX templates.
2. **T0 writes both contracts down**: a JSON Schema for family (b) covering the 8 field types, the three row shapes and the print attributes; a TypeScript contract for family (a) in which an icon is a DS icon name and a colour is a DS tone, with adapters for the callbacks. Family (a) has a single consumer, so this type change stays inside the candidate.
3. **Presentation values are mapped, never restyled by hand**: `color` and `variant` → tone and variant of DS `field-card` through the mapping table of T0 (`colored` → `accent` with a `categoryN` tone, `plain` → `plain`, `bordered` → `bordered`; gap G-7); `columns` and `span` → DS `grid` and `col`; `printClass` and `printGridClass` values (`layout-head`, `layout-main`, `column-a colspan-2-print`, `layout-quad`, `report-analyse`, …) are kept as opaque layout tokens and emitted as `data-print-layout` attributes; break and visibility attributes become `data-print-*` attributes read by the print stylesheet (section 3.7).
4. **Split**: `ui-shared/templater/` holds the contracts, the two stores and the framework-independent core of the renderer (T0, T2); `ui-vue/src/templater/` holds the Vue renderers (T1a for family a, T1b for family b and the catalogue) and the print layer (T1c).
5. **Rendering uses DS components only**: `field-card`, `tabs`, `rating`, `table`, `skeleton-text`, `tile`, `button`, `menu`, and the editable field of A7b. Two registered exceptions apply: the cross-and-dash complexity scale (EX-8) and the typography of rendered Markdown (EX-7). Text shown in locked and print modes comes from the generator of section 3.5.1.
6. **Same extension points**: the `chart` and `component` slots keep their names and parameters as scoped slots; `child-list` stays the placeholder it is today.
7. **Stable input boundary**: the renderer takes descriptor, data and callbacks. T4, owned by the DS, later replaces the rendering layer of family (b) by the DS elements interpreter (V12a) behind that boundary; the envelope contract is co-owned by the DS and sentropic.

### 3.7 Print

- The print stylesheet is **re-authored, not ported** [JUGEMENT]: 269 of its 441 selector lines name Tailwind utilities that the candidate no longer emits (section 2.5).
- Target file: `ui-vue/src/styles/print.css` (exception EX-2), limited to `@media print`, keyed on the `data-print-*` hooks of section 3.6 and on DS tokens. It keeps the page model of today: A4 with 2 cm margins, and the named pages `annex` and `cover` without margins (`ui/src/app.print.css:37-73`).
- DS components are reached only through documented hooks (DS gap G-6). Until the DS provides them, the application wraps a DS component in a layout element that carries the hook; no selector targets a private DS class.
- Print mode in script: one composable replaces the three local implementations (`InitiativeDetail.svelte:100-119`, `InitiativeScatterPlot.svelte:2195`, `:2339`).
- **There is no paged print reference today**: two specs switch to print media, but none produces a PDF or asserts content per page (section 2.7). AE1b keeps these two tests, makes their locators implementation-neutral, and adds the reference on the pinned Svelte application: one PDF per seeded report and detail view, with page count, text per page and the first heading of each page. T3 compares the candidate to it.

### 3.8 Internationalisation

- `svelte-i18n` is replaced by one neutral module in `ui-shared/i18n/` built on `intl-messageformat` (`latest` 12.1.5 [FAIT, registry]; it is already the formatter under `svelte-i18n`), as planned by `PLAN.md:492` [JUGEMENT].
- Unchanged: the two catalogues `ui/src/locales/{fr,en}.json` (1,713 lines each), the storage key `locale` and the fallback `fr` (`ui/src/lib/i18n.ts:7-8`).
- API: `t(key, values)` and a `locale` signal; the 960 `$_(` call sites become `t(` in templates.
- Gate: a unit test formats every key of both catalogues with the old and the new module and requires identical strings (A0a).
- `vue-i18n` is not used: one neutral module serves the Vue and the Preact builds; the Vapor compatibility of `vue-i18n` is `unverified` and is not needed.

### 3.9 Authentication

[JUGEMENT] Target; the facts it rests on are cited inline.

- The session store (451 lines, 38 browser-storage references) becomes a neutral module with the same storage keys; a session opened on the Svelte application stays valid on the candidate and back (rollback, section 4.5).
- The transports are already framework-neutral (`ui/src/lib/services/auth-transport.ts`, `oauth-transport.ts`, `cm-identity-screens.ts`, 148 lines).
- The screens come from two packages that receive additive Vue subpaths with their Svelte exports untouched (K27, `PLAN.md:215`): `auth-ui` (9 components, A1d), then `cluster-mesh/ui` (5 screens, A11), two of which import `auth-ui` components; the authentication routes come after both (A1a).
- WebAuthn stays on `@simplewebauthn/browser`, called by `packages/auth-ui/src/webauthn.ts`.
- Route protection is the navigation policy of section 3.3, with the same public list, the same `returnUrl` round trip and the same two workspace locks.

### 3.10 Streaming chat

[JUGEMENT] Target; the facts it rests on are cited inline.

- The chat depends on the Vue port of `chat-ui` (lots C0 to C6a, sentropic scope). The DS supplies the six chat primitives (V5a) and reviews DS usage.
- C1 replaces `svelte-streamdown` by a neutral streaming core (`marked` + sanitiser) and turns the package stores into neutral signals; the streaming matrix (incomplete Markdown, sanitisation, code blocks, citations, attachments, scroll anchoring; `PLAN.md:429`) is its gate. Its output follows the generated-HTML contract of section 3.5.1; the Svelte views keep `svelte-streamdown` until C6c.
- The host keeps what is specific to the application: the 10 adapters of `ui/src/lib/chat` (1,511 lines, 8 already neutral), the dock offsets of the root layout (`+layout.svelte:131-157`), the queue monitor, local tools, and the two extension entries. C0 decides, line by line of the 7,052 host lines, what moves into the package.
- 100 % DS applies to the Vue views of `chat-ui`: they are built on DS chat primitives and tokens and must render in a host that has no Tailwind. Today 20 of the 24 Svelte views rely on the host's Tailwind build (section 2.9); the Svelte exports keep that behaviour until C6c. The only stylesheet of the Vue entry is the content stylesheet of section 3.5.1, shipped by the package.
- Three layers, ported in that order (sections 6.5 and 6.12): the 20 views that import no other view (C2a, C3 with its internal pager and widget, C4), the two compositions that assemble them (`ChatPanelShell`, `ChatConversation`: C2b), then the application hosts (A8a, A8b). The application adapter of `StreamMessage`, used outside the chat by the queue monitor and four pages, is delivered with the shared components (A9), on the element lot C2a.
- The Chrome extension and the VS Code webview get Vue entries in A8b; their style isolation inside a host page is checked there.

### 3.11 Relation to the in-process Vue compilation and to the DS package shape

Owner decision of 13/11 [FAIT, `.tmp/rv/night-plan-0811.md:175`]: h2a artifacts and decision dossiers move to Vue through an in-process compilation in cluster-mesh, with the boundary `compile(source, kind: vue-sfc | vue-template, compilerVersion) → { module, css, digest, diagnostics }` and `serve(digest)`, in a V8 isolate where the source is untrusted.

Relation to this plan [JUGEMENT]:

- **Different object.** That service compiles artifact and dossier sources at request time and serves them by digest. The application is compiled ahead of time by Vite in CI and shipped as a static image. No lot of this plan depends on the compile service, and the service does not build the application.
- **One pin table.** The application, the DS packages and the compile service use the same exact `vue` and `@vue/compiler-sfc` versions; a pin bump is made once for the three.
- **The application is a host, not a client of the compiler.** Compiled artifacts shown inside the application are loaded by digest in a frame on the separate artifact origin (target of the h2a spec, `/home/antoinefa/src/h2a/tmp/h-cond/vue-migration/SPEC_EVOL_H2A_VUE_MIGRATION.md:154`). They do not share the application's Vue runtime, so the application bundle exposes no import map.
- **The templater does not need it.** T4 follows the JSON-catalogue route (DS elements interpreter), which renders data, not compiled code.
- **Package shape.** Per-component export subpaths and per-icon imports are scheduled in the DS (`.tmp/builder-dossier/q1-findings.md:8`); the candidate imports only through them, and A0a adds a module-count witness to the candidate build.

---

## 4. Migration strategy

### 4.1 Big-bang or strangler

| Option | Description | Assessment [JUGEMENT, on the facts cited] |
|---|---|---|
| A. Big-bang rewrite | one long-lived branch, switched at the end | rejected: nothing is verified before the end; incompatible with the commit and scope rules of `rules/MASTER.md`; the reference moves under it |
| B. Strangler in production | two applications behind the same origin and API, nginx sends each route to one of them, routes go live one by one | rejected: (1) the chat widget is mounted by the root layout and persists across navigations (`+layout.svelte:413-415`), so crossing from one application to the other is a full page load that drops the open stream and the dock state; (2) the Tailwind look and the DS look would alternate from one route to the next; (3) two code paths in production contradict the rule "no legacy fallback, zero dual paths" (`rules/workflow.md:169`) and decision K14 (`PLAN.md:202`) |
| **C. Strangler in construction, single cutover** | routes are ported one by one into a candidate target on `main`, each with its own parity gate; production stays on Svelte; one switch at the end | **recommended** |

Second axis, the look [JUGEMENT]: each view is written **once, directly on DS components**. An isometric intermediate (Tailwind markup copied into Vue, then replaced by DS components) would write every template twice and port the print stylesheet twice. The consequence is that visual parity with Svelte cannot be a pixel gate; parity is carried by behaviour and by a reviewed list of visual differences (section 4.3). This is owner decision D1.

### 4.2 How the Svelte application stays the reference until parity

[JUGEMENT] Rules of this plan.

1. **Pin.** The reference is `c40b8d1b5`. AE1a records it; only s-conductor re-pins, with the `git diff --stat -- ui` of the move.
2. **Read-only root.** No migration lot edits `ui/`, with two exceptions: AE1a and AE1b (additive test hooks, no behaviour change) and A14 (file moves, alias updates and the build context of the Svelte image, which then copies `ui-shared/`).
3. **Freeze of features** (owner decision D2). From the pin to the cutover, `ui/src/**` receives fixes only. Each change is entered in a reference-change ledger on the track item, with the lot that mirrors it in the candidate. A10a does not start with an unmirrored entry.
4. **Reference artefacts.** AE1b captures on the pinned reference, per end-to-end flow, with the instrument of AE1a: the canonical API-call log of section 4.3.2, an accessibility snapshot per screen, screenshots (1440 px and 400 px, light and dark) and the print PDFs. A baseline is never regenerated from the candidate (`PLAN.md:530`).
5. **Same everything else.** Same API image, same seeds, same Playwright stack, same spec files. Only the `UI_TARGET` variable differs.
6. **Production.** The Svelte image stays the deployed one until A15.

### 4.3 Parity gates

[JUGEMENT] Gate definitions of this plan.

A route lot is done when its gates are green on the surfaces it delivers (section 4.3.1); A10b re-runs all of them on the whole candidate.

| Gate | What is compared | Instrument | Pass criterion |
|---|---|---|---|
| G-BEH | user flows | the specs of the candidate spec manifest (section 4.3.1), run with `UI_TARGET=vue` | green without any timeout change, without a spec forked per target, and without a test skipped at run time or retried |
| G-API | calls to the API | canonical call log of each flow (section 4.3.2) | same sequence of user-action groups; in each group the same mutating requests in the same order with equal canonical bodies, the same set of reads, the same statuses; same response-body shape |
| G-NAV | navigation | matrix of `PLAN.md:428`: deep link, back and forward, query kept, login redirect with `returnUrl`, cancelled navigation, unsaved-change dialog, the two workspace locks | every case green |
| G-SEM | content and accessibility | accessibility snapshot of each screen | every heading and interactive element of the reference has a counterpart with the same role, accessible name and enabled or disabled state; elements of surfaces not yet merged are on the pending list, and elements replaced by an owner decision are compared to the substitute recorded in the approved-difference list (section 4.3.1) |
| G-VIS | look | side-by-side screenshots, 1440 px and 400 px, light and dark | every difference classified `ds-intended` or `defect`; zero `defect`; the `ds-intended` list approved by the owner (decision D4) |
| G-PRINT | printed output | PDFs of section 3.7 | same page count, same first heading on each page, same text per page; cover and annex full-bleed |
| G-STATE | browser state | storage keys read and written | identical keys and formats; a session opened on one application works on the other |
| G-DS | 100 % DS | lint of section 3.5, rendered-DOM scan of rule DS-7 and coverage manifest | zero violation, zero unregistered exception, register within its bounds; the three figures of section 3.5 reported |
| G-ENTRY | both build outputs | Vapor entry: all gates; classic entry: G-BEH and G-NAV | green on both |
| G-UNIT | neutral modules | `ui-shared` unit tests | green; coverage not below today's level on the moved modules |

### 4.3.1 Lot-level scope of the gates

[JUGEMENT] A route lot is verified on what it delivers; nothing is assumed about the surfaces of later lots. This is what makes the first route, and every later lot, able to meet its own exit gate.

- **Owner lots of a spec.** AE1b records, on the pinned reference, the application URLs and regions that each spec visits. A spec has an owner-lot set: the lots that deliver those surfaces. Section 6.11 gives version 1 of that map, built from the route strings of the spec files.
- **Candidate spec manifest.** `e2e/candidate-specs.json` lists the spec files enabled with `UI_TARGET=vue`. A spec enters the manifest in the PR of the last lot of its owner set to merge, and never leaves it. The candidate lane runs exactly the manifest, with the reconciliation of the reference lane: every listed test executed with its expected status, none skipped at run time, none retried (`scripts/ci/browser-shards.mjs:124-133`).
- **Lot scenario.** A lot that completes no existing spec gets a scenario written and validated on the Svelte reference before the lot starts. A0b is the case: `e2e/tests/01-shell-neutral.spec.ts` (section 6.2). Component lots use harness specs instead (section 3.2).
- **Pending list.** Elements and API calls of the reference that belong to a surface not yet merged are listed in `e2e/parity/pending.json` with their owner lot — for example the chat launcher, mounted on every authenticated page (`+layout.svelte:413-415`), until A8b. G-SEM and G-API ignore exactly these entries. An entry without an owner lot fails the gate. A10b requires an empty list.
- **Leaving the lot.** A navigation that ends on a surface of a later lot is asserted by URL and stored state only.
- **Approved differences.** `e2e/parity/approved-differences.json` is the only way an owner decision changes what G-SEM expects. An entry holds: the decision and its option as recorded on the track item; a scope (surface and mode); a matcher of the reference elements (role, accessible-name pattern, container); the substitute asserted on the candidate. G-SEM requires no counterpart for a reference element matched inside the scope and asserts the substitute instead; the same element outside the scope keeps the normal rule. An entry without a recorded decision fails the check, as does an entry that matches no element; the number of elements matched is reported per flow. The list is distinct from the `ds-intended` list of G-VIS, which classifies looks and changes no check.
- **Entry of decision D8**, the only entry planned. Reference fact [FAIT]: in an editable field the application turns each `[n]` of the text into a link `<a href="#ref-n" data-ref-num="n">[n]</a>` (`EditableInput.svelte:408-420`, inserted by the DOM rewriting of `:427-470`). Under option A: scope = the content of an editable field while it is editable; matcher = role `link`, name `[n]`, target `#ref-n`, inside the editor content; substitute = the text `[n]` at the same place of the field's text content, with no link. In locked and print modes the entry does not apply: the link is required with the same name and target, and it is rendered by the generator of section 3.5.1. Under option B the list has no entry and G-SEM requires the links inside the editor. A7b does not start before the decision is recorded.

### 4.3.2 API oracle and reproducibility

[JUGEMENT] Definition of the instrument built by AE1a; the code cited is [FAIT].

| Element | Rule |
|---|---|
| Recorded | every request of the page to `/api/v1/**`: method, path, query, status, request body, response body |
| Compared by value | the canonical request body of every mutating request (POST, PUT, PATCH, DELETE): a save that sends a wrong value in the right shape fails; path, query and status of every request |
| Compared by shape | response bodies (keys and types) |
| Identifier mapping | every identifier returned by the API or created by the spec becomes an alias by resource kind and order of first appearance (`workspace#1`), in paths, queries and bodies. The rule is the same on both targets, so two runs with different identifiers compare equal |
| Volatile fields | a closed list in `e2e/parity/volatile.json`: timestamps, session and request identifiers, relative-date texts (`routes/neutral/+page.svelte:71-84`), and the `Date.now()` suffix of names created by specs (section 2.7). The number of masked values is reported per flow; adding a field is a reviewed change |
| Deterministic fixtures | seeded data from `db-seed-test`, a prerequisite of `test-e2e` (`Makefile:3109`); the scenarios written by AE1a and AE1b create resources with fixed names |
| Causal order | requests are grouped by the user action that precedes them (navigation, click, input). Groups are ordered. Inside a group, mutating requests are compared as a sequence and reads as a set, and a read that follows a mutation in the reference must follow it in the candidate |
| Server-sent streams | compared by URL and query only |

Witness mutations [JUGEMENT]: the self-test of the instrument, part of the exit gate of AE1a. Each must turn the named gate red, and the unmutated capture must compare green twice in a row.

| # | Mutation | Applied to | Must fail |
|---|---|---|---|
| M1 | wrong save: one business value changed in a mutating body, shape unchanged | a reference capture of the first-route scenario | G-API |
| M2 | missing request: the read that follows a mutation removed | the same capture | G-API |
| M3 | two mutating requests of one group swapped | a reference capture with two mutations | G-API |
| M4 | disabled action: the primary control of a step forced to `disabled` in the live reference page | the first-route scenario | G-BEH |
| M5 | an interactive element removed from the live reference page | the first-route scenario | G-SEM |

### 4.4 Reuse of the existing tests

[JUGEMENT] Rules of this plan; the counts are the [FAIT] of section 2.7.

- **End-to-end, reused as they are.** The 61 spec files are kept. The 56 numbered specs of the blocking matrix and the VS Code spec run on either target; the three `dev/` specs and `a4/identity-cutover.spec.ts` keep their own lanes (section 2.7). Before any candidate run, AE1b makes them implementation-neutral **on the Svelte reference**: the 79 Tailwind tokens and the class-based locators among the 152 that name a styling class become role, label or test-id queries, and the 403 tag-based locators are reviewed for tags that a DS component may not render natively. The neutralised suite must be green on Svelte first; only then is it a valid instrument.
- **Coverage gaps closed on the reference first.** No spec reaches `/initiative/[id]/gate`, no spec stays inside the landing page, and none produces a paged PDF (section 2.7). AE1a adds the first-route scenario; AE1b adds the gate-page spec and the paged print reference, and keeps the two existing print-media tests. Parity is then measured rather than assumed.
- **Rules unchanged.** No timeout increase; the AI-dependent allowlist stays as it is (`rules/testing.md:42`, `:103`); no campaign on `ENV=dev`.
- **Unit tests.** The 14 files bound to `.svelte` files (import or source text) are rewritten against the extracted neutral modules or retired with a recorded reason (A10a). The other 76 follow their modules into `ui-shared/`: the 10 store tests are copied by A0a, which does not edit `ui/`, and the rest move with A14; those that import `svelte/*` helpers are re-pointed at the neutral API. The rule "TypeScript tests only, no component tests" (`rules/testing.md:71`) is kept for the candidate.
- **Visual comparison is a report, not an equality gate**, because the DS look differs by design. The report is produced by the instrument of AE1a for every route lot.

### 4.5 Cutover, and no legacy fallback after it

[JUGEMENT] Rules of this plan, applying the repository rule "no legacy fallback" (`rules/workflow.md:169`).

- **A15, on owner GO, is one change**: the deployed image becomes the `ui-vue` image; `ui/` is deleted with its SvelteKit, Tailwind and PostCSS configuration and its Svelte dependencies; the `UI_TARGET=svelte` branches leave `Makefile`, compose files and CI.
- **The same change re-points every repository tool that reads the `ui` root** (section 6.13): the root workspace list and lockfile, the scanners, the inventories and their tests. Two of these readers belong to the API image: it copies `ui/package.json` (`api/Dockerfile:497`) and hashes it into its tag (`Makefile:86`). A15 removes both, so the API image is rebuilt and re-pinned under a new tag with unchanged code.
- **Preconditions**: M-APP reached; no-reference check green on the deployed commit; reference-change ledger empty; rollback rehearsed; the A15 branch — deletion and tooling changes together — green on the complete CI workflow, every job selected, before the GO.
- **After the switch no Svelte code path remains for the application.** The classic entry stays as a second build output of the same Vue sources; it is not a fallback path in the code.
- **Rollback** is an operational act on images: redeploy the previous immutable Svelte image. It works because the API and the storage keys are unchanged in both directions (G-STATE). The API image built by A15 carries the same code and differs by its tag, by the root manifest and by the absent `ui/package.json`; the rehearsal runs the previous UI image against both API tags. It is rehearsed in A15 before the GO.
- **The identity-provider front has its own cutover, A1c.** Its screens ship inside the API image and are served by the identity-provider service (`api/Dockerfile:439-447`, `:506`; `apps/auth-idp/idp-app.ts:50`, `:198`), so its switch and its rollback are those of the API image, not of the UI image. A1c deletes `apps/auth-idp/web/**`, whose pages import the Svelte components of `auth-ui` (`apps/auth-idp/web/src/routes/auth/login/+page.svelte:3` and three other pages).
- **Retirements follow**: A16 removes the Svelte exports of `auth-ui`, `cluster-mesh/ui` and `cited-source-viewer`, after A15 and A1c; C6c removes those of `chat-ui`, which also waits for immo's own cutover (`PLAN.md:747`).

---

## 5. Dependencies on the DS programme

[FAIT] Source of this section: the binding input of the design-system session of 13/11 (from `PLAN.md` revision 4, sections 4.3, 4.9, 4.10, 5.2-5.4). The DS calendar is `unverified`: G0-Vue about 14/11, V10a about 16/11, M-DSV about 17/11. [JUGEMENT] This plan fixes one assumption to compute times: **day 0 = 14/11 08:00 Montréal**. Every time after V10a moves with it, hour for hour.

### 5.1 DS deliveries this plan waits for

[FAIT] Content and DS timing are the binding input of the DS session (13/11) and `PLAN.md`; [JUGEMENT] the Montréal times follow from the day-0 assumption above, and the last column is this plan.

| DS delivery | Content | DS timing | Sentropic lots that wait |
|---|---|---|---|
| V0a (enabler, 12 h) | exact toolchain pins: `vue`, compiler, Vite plugin, `vue-tsc` | before day 0 | A0a takes the pins; if V0a is not out on 13/11 08:00, A0a starts on the registry values of section 3.1 and re-aligns |
| V0b (10 h), V0c (8 h) | SFC contract extractor and codemod; Vapor compatibility under `createVaporApp` (Teleport, custom element, server render) | before day 0 (chain with V0a about 40 h) | none directly; V0c's results bound the authoring rules of section 3.1 |
| Day 0 | Vue-relevant G0 gate closed: 0.40.1, the Vue diagram release, ERD #278, DC-2c.1 #272, diagram-ref. The Preact steps G0.3 and G0.7 do not block Vue | about 14/11 | — |
| L1.7 | neutral router (`PLAN.md:563`, 12 h) | hours 0-26, by 15/11 10:00 | A0b |
| L1.6 | browser acceptance harness (`PLAN.md:562`, 16 h) | hours 0-26 | C7a, T3, A10b; fallback: the instrument of AE1a |
| V1, V2, V3, V4a-c, V5a, V5b, V6, V8, V9 | conversion of the DS Vue modules to template SFCs, consumer-required rows first in every lot: V1 layout, action, feedback (37 modules, 16 h); V2 form (27, 14 h); V3 navigation, overlay and menu cascade (20 h); V4a-c data (92, 3 × 16 h); V5a chat primitives (16, 8 h); V5b shell modules (15, no figure given); V6 hard set (18 h); V8 missing ports (12 h); V9 icon on lucide data (4 h). V7a-b `dataviz-vue` (115, 2 × 20 h) ends with M-DSV | hours 0-64, up to 10 DS slots | through V10a |
| **V10a** | core pre-release of `design-system-vue` under the `next` tag (`.` and `./vapor`), every consumer-required row green | **hour 55 = 16/11 15:00** | start signal of T1a, A7b, A1d, C2a, C3, C4; A0b follows T1a; C2b follows C2a and C4; A11 follows A1d; everything else is behind them |
| M-DSV (V10b) | full release candidate, `design-system-vue` + `dataviz-vue` | hour 64 = 17/11 00:00 | none on the path; needed only if decision D3 selects the DS scatter plot |
| V12a | elements interpreter on Vapor (12 h) | after M-DSV | T4 (DS-owned) |
| V12c, V13a-c | artifact-shell twin; island compile kit and `ui://` shell, in the sentropic isolate runtime | after M-DSV | none in this plan (section 3.11) |

### 5.2 DS components imported today

[FAIT] Value imports of `@sentropic/design-system-svelte`, per consumer. The templater imports none.

| Consumer | DS components | Where |
|---|---|---|
| Application | `IconButton`, `Toggle`; `ThemeProvider`; theme `entropicTheme` | `ui/src/lib/components/ChatWidget.svelte:43`; `ui/src/routes/auth/+layout.svelte:7-8` |
| chat-ui | `Badge`, `EmptyState`, `Icon`, `OverflowMenu`, `SelectableList`, `SelectableRow`, `StatusDot`, `Tag`; `IconButton` | `packages/chat-ui/src/components/AgentsList.svelte:2-12`; `ChatSessionsBar.svelte:14` |
| Templater (`ViewTemplateRenderer`, `ContainerView`, `TemplateRenderer`, `FieldCard`, `ScoreTable`, `ViewTemplateCatalog`) | none | no DS import in these files |
| auth-ui | `Alert`, `Button`, `Card`, `Input`, `Typography` | `packages/auth-ui/src/components/AuthDevicePair.svelte:3` and 7 other components (line 3, 8 or 9 of each) |
| cluster-mesh UI | `Alert`, `Button`, `Input` | `packages/cluster-mesh/ui/MembershipDecisionsScreen.svelte:2`, `WorkspaceMembersScreen.svelte:3` |
| cited-source-viewer | `Button`, `ContentSwitcher`, `IconButton`, `Link` | `packages/cited-source-viewer/src/CitedSourceViewer.svelte:36` |
| `apps/auth-idp/web` | `ThemeProvider`, `AppChrome`, `Link`; theme `entropicTheme` | `apps/auth-idp/web/src/routes/+layout.svelte:4-5`, `auth/login/+page.svelte:4` |

State of the Vue counterparts at the DS pin [FAIT]: in `packages/components-vue/src`, 14 files are `.vue` single-file components and 242 are `.ts` modules; every component named in this section is still a `.ts` render-function module. `LockPresenceBadge`, `RichTextEditor`, `ComposerEditor`, `WebFrame` and `LabelledIconButton` have no Vue file. The published `@sentropic/design-system-vue` is 0.39.0 (`latest`, registry).

### 5.3 DS components required by the 100 % DS target (list for the DS to order its lots)

[JUGEMENT] Derived from the mapping of sections 2.2 and 2.8. Identifiers are catalogue entries; "first lot" is the first sentropic lot that needs the component. This is version 1; AE2a delivers version 2, checked at props level against the local components, together with the gap requests of section 5.4, by 13/11 18:00.

| DS lot | Components to flag consumer-required | First sentropic lot |
|---|---|---|
| V1 action | `button`, `icon-button`, `link`; `copy-button` | A0b; A6b |
| V1 layout | `stack`, `flex`, `grid`, `row`, `col`, `container`, `divider`, `panel-section`, `card`; `tile`; `field-card` | A0b; T1a; T1b |
| V1 feedback | `inline-loading`, `loading-state`, `alert`, `empty-state`, `skeleton-text`; `rating`; `autosave`; `progress-bar`, `status-dot` | A0b, T1a, A11; T1b; A7b; A9, C3 |
| V2 form | `input`, `select`; `textarea`; `checkbox`, `radio-group`, `radio`, `file-uploader`, `form`, `form-group`; `number-input`; `toggle`; `selectable-list`, `selectable-row` | A0b; A7b; A9, A2; A5b; A8b; C3 |
| V3 navigation | `app-header` or `header`, `nav-item`, `language-selector`; `menu`, `menu-trigger-button`; `overflow-menu`; `tabs`; `content-switcher`; `app-chrome` | A0b; T1a; C3; T1b; A11; A1b |
| V3 overlay | `modal`, `drawer`; `menu-popover`, `popover`, `tooltip` | A0b; A9 |
| V4a data (first batch) | `badge`, `tag`; `table`, `structured-list`; `config-item-card`; `unordered-list` | C3, T1a; A9, A5b, T1b; T1b, A6b; A3 |
| V5a chat and other | `chat-composer`, `chat-message`, `chat-thread`, `message-actions`, `message-status-badge`, `streaming-message`; `typography` | C2a, C3, C4; A0b, A1d |
| V5b shell | `ThemeProvider`, `IdentityMenu`; `AppShell`, `PanelStack`, `UtilityPanel` if AE2a finds them fit (gap G-3) | A0b; A0b, A8b |
| V6 hard set | `Toast`, `Portal`, `Popper`, `Dropdown` | A0b (toast, and the overlays that depend on the portal) |
| V8 missing ports | `RichTextEditor`, `ComposerEditor`; `LockPresenceBadge`; `web-frame` (optional) | A7b, C2a; A9 |
| V9 | `icon` on lucide data: the 67 icons of the application and the 10 of chat-ui (exact list in AE2a) | A0b |
| V7 dataviz (M-DSV) | `scatter-plot` or `priority-matrix` | only under decision D3, option B |
| themes | `entropicTheme` of `@sentropic/design-system-themes` (framework-neutral) | A0b |

Not required [FAIT]: `score-card` and the local `MatrixDetails`, `MaturityStageBadge`, `StarRating` have no consumer in the application (section 2.2).

### 5.4 DS gaps: resolution, evidence and dependent lots

[JUGEMENT] The gaps and their resolutions are this plan's reading; the evidence cited is [FAIT], DS files being read at the DS pin under `packages/components-svelte/src/lib/`.

[FAIT] The DS lots V1 to V9 convert existing modules or port missing ones (`PLAN.md:578-591`); none of them extends a component. Waiting for V10a therefore closes no gap by itself. [JUGEMENT] Each gap needed for the cutover gets a resolution that does not wait for an unplanned DS lot, with its owner lot, its hours and the evidence that must exist before the dependent lot starts; the matching request goes to the DS session with the list of AE2a.

| # | Gap and evidence | Needed for the cutover | Resolution, owner lot, hours | Evidence required before the dependent lots start | Dependent lots |
|---|---|---|---|---|---|
| G-1 | scatter plot with collision-free labels, quadrant and thresholds: engine of `InitiativeScatterPlot.svelte:97-1440`; DS `ScatterPlot` and `PriorityMatrix` exist, their coverage of the engine is `unverified` | no | temporary exception EX-1: canvas host in A4b (inside its 16 h). Convergence is a separate DS-led lot after M-APP, not counted | none | none |
| G-2 | container for rendered Markdown, with a print variant: 23 `{@html` in 6 files; the DS has `Typography`, `UnorderedList`, `Link`, `CodeSnippet`, but no container that styles generated children | yes | sentropic: generated-HTML contract (C1 and T2, 2 h each) and temporary exception EX-7, the stylesheet `@sentropic/chat-ui/content.css` written, exported and tested by C1 (2 h of its 24) and loaded unchanged by the package views and by the application (T1b, inside its 14 h; section 3.5.1). A consumer of the package needs no file of `ui-vue/`. DS request: a content container | C1 merged with the fixtures of rule DS-7 and the stylesheet contract test green, the subpath `./content.css` present in the export manifest; T2 merged for the application lots. Consumer test: computed styles of heading, list, code and citation in the packed consumer of C6a | C2a, C2b, C6a; T1b, A2, A4b, A8a |
| G-3 | application shell with a docked, resizable panel: `+layout.svelte:131-157`, `:385-391`; DS `AppShell`, `PanelStack`, `UtilityPanel` are in V5b (`PLAN.md:585`), their fit is `unverified` | yes | AE2a gives the verdict at props level (inside its 6 h). Fit: A0b uses them. Not fit: temporary exception EX-3 `shell.css` (A0b, inside its 12 h) and a DS request | verdict of AE2a recorded; if fit, the three rows green in V10a | A0b, A8b |
| G-4 | toaster region: DS `Toast` is one item with `tone`, `title`, `message` and a `status` or `alert` role (DS `Toast.svelte:5-15`); the DS has no region component | yes | sentropic composite in A0b (inside its 12 h): DS `toast` items in a DS `stack` through DS `portal`; the position of the region is carried by EX-3. DS request: a toast region | `Toast` and `Portal` rows (V6) green in V10a; consumer test: step S4 of the first-route scenario | A0b |
| G-5 | inline editable field with autosave: `EditableInput.svelte` (955 lines); on the DS side a study only (DS `spec/SPEC_STUDY_EDIT_B1_SENTROPIC_EDITABLES.md:5`, "No commitment yet") | yes | sentropic composite: A7a (6 h) and A7b (10 h), on DS `RichTextEditor`, `input`, `textarea`, `autosave` | `RichTextEditor` row (V8) green in V10a; consumer test: harness spec of A7b | A7b, then T1b and the pages |
| G-6 | print hooks on DS components | no: wrapper elements carry the hooks (section 3.7) | T1c (inside its 16 h). DS request: documented print parts | lint of T1c | T1c |
| G-7 | `field-card` values: local variants `colored`, `plain`, `bordered` and six colours (`FieldCard.svelte:15-26`); DS variants `plain`, `bordered`, `accent` and tones `category1` to `category8`, the tone applying to `accent` only (DS `FieldCard.svelte:5-14`, `:54`) | yes | no DS change: mapping table in T0 (inside its 10 h). The filled coloured header becomes an edge accent: a row of the `ds-intended` list (decision D4) | mapping table merged with T0; consumer test: the 7 seeded shapes in T1b | T1b |
| G-8 | `rating` glyphs: stars for value, crosses and dashes for complexity (`TemplateRenderer.svelte:619-634`; `ScoreTable.svelte:11`, `:54-64`); DS `Rating` draws `Star` and `StarHalf` only and has no glyph prop (DS `Rating.svelte:6`, `:9-26`) | yes | temporary exception EX-8: the complexity scale as a composite of DS `icon` with a text value (T1b, 1 h of its 14). DS request: a glyph set on `rating` | `icon` (V9) and `rating` (V1) rows green in V10a; consumer test: accessibility snapshot of both scales in T1b | T1b |
| G-9 | names of the per-component subpaths of `design-system-vue` and of the per-icon data import: accepted in principle (`q1-findings.md:8`), names not published (`source-gap`) | no | A0a keeps the import map in one file (inside its 18 h); until the names exist the candidate imports the `./vapor` entry, and the module-count witness is recorded without gating | `exports` map of the V10a tarball | A0a, non-blocking |
| G-10 | package name and publication channel of the neutral router (L1.7): not stated in `PLAN.md:205`, `:563` (`source-gap`) | yes | DS lot L1.7 (12 h, DS side). Fallback: risk R5 | published package and version, with its navigation fixtures; consumer test: G-NAV of A0b | A0b |
| G-11 | hours of V5b: "no figure given" in the binding input; `PLAN.md:585` states 10 h | no | information for the DS schedule | none | none |
| G-12 | citation links inside the editor: the application rewrites the editor's DOM (`EditableInput.svelte:427-470`); DS `RichTextEditor` has no extension prop (DS `rich-text-editor/RichTextEditor.svelte:35-73`) | owner decision D8 | default: a citation stays the text `[n]` while editing and is a link in locked and print modes (section 3.5.1); a behaviour row of the list approved under D4. DS request: citation tokens in the `full` profile | decision D8 recorded before A7b starts | A7b |

Rules [JUGEMENT]:

- A lot of the last column does not start before the evidence of its row exists. s-conductor checks it against the DS manifest and the merged lots, and records the check on the track item.
- Each request (component, props, consumer fixture) is part of the list sent by AE2a. A gap that the DS closes before the dependent lot starts replaces the sentropic resolution, and the matching exception is never opened.
- No gap is closed by a local primitive, and none by an exception outside the bounds of section 3.5.

### 5.5 What can start now and what is blocked

[JUGEMENT] Derived from the dependencies of section 6.

| Start condition | Lots |
|---|---|
| **Now, 13/11 08:00, no DS dependency** | C0, T0, AE1a, AE2a, A0a (five lots for four branch slots: T0 starts at 18:00) |
| Now, after a sentropic predecessor only | C1 (after C0); AE1b (after AE1a); AE2b (after AE2a, A0a); T2 (after T0, A0a, C1); A7a, A4a (after A0a); A5a, A6a (after A0a, AE1a) |
| V10a | T1a, A7b, A1d, C2a, C3, C4 |
| V10a and L1.7 | A0b, after T1a |
| Behind them | C2b, T1b, T1c, A11, A1a, A1b, A2, A3, A4b, A5b, A6b, A9, C7a, C6a, A8a, A8b, A14, T3, A10a, A10b |
| Evidence of section 5.4 | A0b (G-3, G-4, G-10), A7b (G-5, G-12), T1b (G-2, G-7, G-8), C2a, C2b (G-2) |
| M-DSV | nothing on the path |
| V12a (DS) | T4, owned by the DS |
| Owner | decision D8 before A7b; approval of the visual-difference list and of the exception register (A10b); GO of A15 and of A1c; A16 and C6c behind them |
| immo's own cutover | C6c |

The 13 lots of the first two rows are 152 build hours and end on 15/11 18:00 with four branches, 21 h before V10a (section 6.8).

### 5.6 The chat-ui Vue port: owner and timing

[FAIT] Ownership and lot content come from the binding DS input; [JUGEMENT] the times are those of section 6.8.

- **Owner: sentropic.** `packages/chat-ui` follows the sentropic flow: scoped branch, CI, independent review, merge by s-conductor, version bump on every PR that touches `packages/chat-ui/src` (`rules/workflow.md:116-120`). The DS supplies the V5a primitives and reviews DS usage.
- **Timing** (four branches, day 0 = 14/11 08:00): C0 13/11 08:00 → 22:00; C1 → 15/11 02:00; the element lots C2a, C3, C4 from V10a, merged by 17/11 17:00; the composition lot C2b 17/11 17:00 → 18/11 07:00; C7a (acceptance on the classic and the Vapor build) → 18/11 19:00; C6a (installation contract of the `./vue` and `./vue/vapor` subpaths) → 19/11 05:00.
- **It is the critical path of the application**: A8a and A8b (the two chat hosts and the extension entries) come after C6a and end on 21/11 01:00.
- The hours of the Vue batches come from the binding input (24 + 20 + 14 = 58). Revision 3 redistributes them over four lots along the import graph (section 6.5) and rounds each share up: 60 h. They were set before the 100 % DS requirement reached the chat views; the restyling of the 20 views that depend on the host's Tailwind is `unverified` and is recomputed after C0.
- The subpaths appear incrementally, as the DS plan states (`PLAN.md:731`): C1 creates the two empty Vue entries and their build, each Vue lot adds its views, C6a completes the installation contract. An application lot may therefore consume a merged element through the `file:` link (`ui/package.json:72`): A9 takes `StreamMessage` from C2a. The two chat hosts still wait for the accepted package (C6a).

---

## 6. Lots

### 6.1 Rules common to every lot

[FAIT] for the repository rules cited; [JUGEMENT] for the rules added by this plan.

- One lot = one branch `feat/app-vue-<lot>` in its own worktree = one PR, with a `BRANCH.md` built from `plan/BRANCH_TEMPLATE.md` that declares allowed, forbidden and conditional paths. Merge by s-conductor after an independent review; the PR deletes its `BRANCH.md` before the merge (`rules/workflow.md:39-42`).
- Repository rules apply unchanged: make targets only, Docker only, `ENV` last and the three ports passed explicitly, no campaign on `ENV=dev`, `make down-volumes` at the end of each test lane, commits under 150 lines made with `make commit`, selective staging (`rules/MASTER.md`).
- Every PR that touches `packages/<pkg>/src/**` bumps that package's version and re-checks it after a rebase (`rules/workflow.md:116-120`).
- Every PR builds both entries (gate G-ENTRY). A file above 900 lines is decomposed, framework-independent logic first.
- No lot exceeds 24 build hours (cap of the DS plan: 26, `PLAN.md:831`). The PR size acceptable to the reviewer is `unknown`; it was requested from s-conductor by the DS plan (`PLAN.md:1017`) and may force a re-split.
- "Conditional" paths below need a scope exception `BRxx-EXn` with rationale, impact and rollback.
- Mechanical checks, recorded in `BRANCH.md` [FAIT for the commands]: `harness check branch` when the worktree is created (as in `plan/done/74-BRANCH_fix-llm-gateway-compaction-usage.md:65`) and `make scope-check ENV=<lot env>` before each commit (`Makefile:2452-2462`; as in `plan/62-BRANCH_chore-ci-capacity-metrics.md:77`). A path outside the lists of the lot stops the commit until a `BRxx-EXn` exception is recorded.
- Test plans are at file granularity (`rules/workflow.md:23`, `:29`). Section 6.11 lists the end-to-end files per lot. A lot table names the test files a lot creates, or their directory when the lot decides the split; the `BRANCH.md` of the lot then lists every file.
- Component dependencies: a lot depends on every lot that delivers a component or a module it imports. Section 6.12 lists each import that crosses a lot boundary, imports from one package to another included, read from the sources, and the dependency columns of sections 6.2 to 6.8 contain all of them. A lot that adds such an import adds the dependency in its `BRANCH.md` before it starts.
- Standing dependencies, not repeated in the tables: a lot with a G-BEH, G-API, G-SEM or G-STATE gate depends on AE1a; a lot whose gate runs an existing spec depends on AE1b; a lot with a G-DS gate depends on AE2b; a lot with a harness spec depends on the harness entry of A0a.
- Standing paths of the route lots, not repeated in the tables: `e2e/candidate-specs.json`, to add the specs the lot completes, and `e2e/parity/pending.json`, to remove the entries the lot delivers.
- Gate names (G-BEH, G-API, …) are those of section 4.3, with the lot-level scope of section 4.3.1. Make target names are those proposed in section 3.2.

### 6.2 Application: enablers and first lot

[JUGEMENT] In sections 6.2 to 6.6, content, hours, dependencies, gates and paths are choices and estimates of this plan; the hours taken unchanged from the DS plan are identified in section 6.7.

The first lot of the application is **A0 = A0a + A0b: scaffold plus one real route at parity**. A0a needs nothing from the DS and starts now; A0b starts after V10a and after T1a, which delivers the renderer of the landing page.

| Lot | Content | Lane | Build h | Depends on |
|---|---|---|---|---|
| AE1a | Parity instrument: pin record; API recorder with the canonical log of section 4.3.2; accessibility-snapshot and screenshot capture; candidate spec manifest, pending list and approved-difference list with their checks (section 4.3.1); the five witness mutations; first-route scenario `e2e/tests/01-shell-neutral.spec.ts`, green on the Svelte reference | app / X | 12 | — |
| AE1b | Reference suite: neutral selectors on the numbered specs; the two print-media tests kept and made neutral; reference spec for the gate page; paged print reference (one PDF per printed view: page count, text and first heading per page); reference artefact set per flow; recorded spec-to-surface map | app / H | 14 | AE1a |
| AE2a | 100 % DS, analysis: consumer-required list version 2 at props level; gap requests of section 5.4 with their consumer fixtures; verdict on gap G-3; coverage manifest rows (one per route and local component, each with an owner lot); exception register closed at 4 permanent and 4 temporary entries | app / H | 6 | — |
| AE2b | 100 % DS, instrument: lint rules DS-1 to DS-5 and the authoring rules of section 3.1; manifest check with the three figures and the bound on the register; rendered-DOM scan of rule DS-7; stylesheet lint (only the registered stylesheets exist under `ui-vue/`; no rule on the content hook outside `print.css`) | app / H | 6 | AE2a, A0a |
| A0a | Scaffold without views: `ui-shared/` and `ui-vue/` roots; Vite with exact pins; one bootstrap file for the two entries; `ui-vue/Dockerfile`, make targets, CI jobs; `UI_TARGET` switch of `test-e2e`, `dev` and `build-ui-image`, and the candidate end-to-end lane; harness entry without router; the 16 stores as neutral signals with a copy of their 10 test files; `useSignal` bridge; i18n module; navigation policy as pure functions; additive neutral factories in `cowork-bridge`; module-count witness; the two candidate roots registered in every repository tool that reads the `ui` root — change classifier, CI filters, lockfile-install scanner, security inventory, SCA gate, UI image tag, API import audit — with their tests (section 6.13, column A0a) | app / X | 22 | — (pins of V0a when available) |
| A0b | Shell and first real route: router binding; root layout (session start, guards, spinner; the dock offsets read the neutral `chatWidgetLayout` signal of C1 and are exercised by A8b); header, toaster and unsaved-change dialog on DS components; `/`, `/home`, not-found; **`/neutral`** with the workspace creation dialog; measurement of the porting rate (Svelte lines per build hour) that recalibrates every later lot | app / X | 12 | A0a, AE1a, AE2b, T1a, C1, V10a, L1.7; evidence of G-3, G-4, G-10 |

| Lot | Exit gate (verifiable) | Allowed paths |
|---|---|---|
| AE1a | the first-route scenario is green on the Svelte reference in CI with no timeout change; two captures of the same commit give identical canonical logs and accessibility snapshots; each of the five witness mutations turns its gate red; the manifest check fails on a spec without an owner-lot set, on a pending entry without an owner lot and on an approved-difference entry without a recorded decision | `e2e/**`. Conditional: `scripts/ci/browser-shards.mjs`, `ui/src/**/*.svelte` (additive test hooks only) |
| AE1b | the neutralised numbered suite is green on the Svelte reference in CI with no timeout change; `git grep` finds 0 Tailwind token under `e2e/tests` and every remaining class-based locator is on a reviewed allow-list of semantic hooks; the two print-media tests are still green; a reference artefact set exists for every flow, with a paged PDF per printed view; the recorded map gives an owner-lot set to each of the 61 spec files and names the lane of each | `e2e/**`. Conditional: `ui/src/**/*.svelte` (additive test hooks only) |
| AE2a | list version 2 and the gap requests recorded on the track item and sent to the DS session; every manifest row has an owner lot; the register holds 8 entries, each with kind, owner lot and exit | `ui-vue/ds-coverage.manifest.json`, `ui-vue/ds-exceptions.json`, `spec/**` (list and requests) |
| AE2b | the manifest check fails on a seeded row without an owner lot, on an unregistered exception and on a ninth register entry; each lint rule is red on a violating fixture and green on a clean one; the DOM scan is red on a harness page with a utility class or an inline handler in generated content, and green on the clean page | `ui-vue/lint/**`, `ui-vue/eslint.config.*`, `ui-vue/src/harness/**`, `e2e/helpers/**`, `e2e/tests/harness/**` |
| A0a | `make build-ui-vue`, `typecheck-ui-vue`, `lint-ui-vue`, `test-ui-vue` green in CI on both entries for an empty shell; the harness entry serves an empty page on both entries; the copies of the 10 store test files green with unchanged assertions; i18n parity test green on every key of both catalogues; `make build-ui`, `make test-ui` and the Svelte end-to-end suite still green with `UI_TARGET=svelte` as the default; `cowork-bridge` version bumped and `validate-cowork-bridge` green on it; its consumer without Svelte is the candidate (section 6.14): the bootstrap of the empty shell imports the neutral factories through the `file:` link, `ui-vue/package-lock.json` holds no `svelte` package, and `make typecheck-ui-vue` and `make build-ui-vue` are green; repository tooling (section 6.13): `make test-ci-lockfile-installs`, `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs`, `make test-security-sca-gate`, `make test-security-daily` and `make test-ui-image-version` green with both UI roots registered; witnesses: a change confined to `ui-vue/**` or `ui-shared/**` is classified `ui-only` and no longer `unknown`, a seeded unlocked install under `ui-vue/` is reported by the scanner, a change of a candidate file changes the candidate image tag, `ui-vue/package-lock.json` is a required lock of the inventory | `ui-shared/**`, `ui-vue/**`, `packages/cowork-bridge/**`. Conditional: `Makefile`, `docker-compose*.yml`, `.github/workflows/ci.yml`, `.dockerignore`, `.gitignore`, root `package-lock.json` (version bump of `cowork-bridge` only), and the files of section 6.13, column A0a, one of which is under `api/tests/`. Forbidden: `ui/**`, the rest of `api/**`, root `package.json` |
| A0b | on `/`, `/home`, `/neutral` and the not-found view, with the stored sessions of the global setup: G-BEH = `e2e/tests/01-shell-neutral.spec.ts` green on both entries and added to the manifest with the four target-independent specs; G-API on its flows; G-NAV steps S1, S2, S6, S7; G-SEM with the chat launcher on the pending list (owner A8b); G-VIS report produced; G-STATE on `locale`, `workspaceScopeId` and the session cookie; G-DS; G-ENTRY; porting rate recorded on the track item | `ui-vue/src/**`, `ui-shared/navigation/**`, `e2e/candidate-specs.json`, `e2e/parity/pending.json` |

First-route scenario [JUGEMENT; the reference behaviour cited is FAIT]. `e2e/tests/01-shell-neutral.spec.ts` is written by AE1a and is green on the Svelte reference before A0b starts. Every step stays on the surfaces of A0b. The two existing specs that reach `/neutral` do not (section 2.7); they enter the manifest with their last owner lot (section 6.11).

| Step | Reference behaviour | Asserted |
|---|---|---|
| S1 | `/` shows the welcome heading and a link to `/home` (`routes/+page.svelte:6-13`); `/home` replaces itself by `/neutral` (`routes/home/+page.svelte:8`) | heading, link, final URL; one step back returns to `/` |
| S2 | `/neutral`, opened directly with a stored session, lists the workspaces returned by `GET /api/v1/neutral/dashboard` (`routes/neutral/+page.svelte:45`, `:129-176`) | title; one card per workspace with name, counts and type; the same after a reload |
| S3 | header (`Header.svelte:54-61`; `01-app.spec.ts:36-69`) | six navigation links by role and name; identity menu with the settings link; locale switch stored under `locale` (`ui/src/lib/i18n.ts:7`) |
| S4 | file menu, "New": the creation dialog opens; its create control is disabled while the name is empty (`WorkspaceCreateDialog.svelte:103`); creation posts `{ name, type }` to `/workspaces` (`:35`), shows a toast (`:36`), then the page re-reads the dashboard and goes to `/folders` with the scope set (`routes/neutral/+page.svelte:185-190`) | disabled state and no request; request body by value; toast; second dashboard read after the post; URL `/folders`; `workspaceScopeId` in storage (`stores/workspaceScope.ts:6`) |
| S5 | a card is activated by click and by Enter (`routes/neutral/+page.svelte:135-141`) | URL `/folders` and stored scope, in both cases |
| S6 | unknown path (`+error.svelte:7-9`; `01-app.spec.ts:101-107`) | URL kept; not-found heading; link home |
| S7 | `/neutral` without a session redirects to `/auth/login?returnUrl=%2Fneutral` (`+layout.svelte:267-269`) | URL only |
| S8 | dashboard request answered 500, then answered with an empty list, by route interception (`routes/neutral/+page.svelte:47-59`, `:96`) | error banner with the fallback cards; empty message |

### 6.3 Application: view lots

| Lot | Content | Lane | Build h | Depends on |
|---|---|---|---|---|
| A7a | Editable-field controller, framework-independent: autosave debounce, buffer against original, unsaved-change registration, save payloads, locked mode (from the script of `EditableInput.svelte`) | app / X | 6 | A0a |
| A7b | Editable field as a composite of DS `RichTextEditor`, `input`, `textarea`, `autosave`; Markdown adapter to the document format of the editor, with a round-trip corpus; the local node extensions and the rewriting of the editor's DOM are not carried (section 3.5.1) | app / X | 10 | A0a, A7a, V10a; evidence of G-5; decision D8 |
| A4a | Priority-scatter engine extracted from `InitiativeScatterPlot.svelte` into `ui-shared/charts/`: label layout and annealing with an injected random source, medians, quadrants, chart configuration | app / X | 12 | A0a |
| A4b | Scatter host (exception EX-1) and the dashboard page (1,417 lines), consumer of the templater and of the lock badge | app / H | 16 | A0b, A4a, A7b, A9, T1b |
| A5a | Matrix view-model extracted from the matrix page (1,682 lines): axes, thresholds, weights, level descriptions, unsaved-change handling | app / H | 8 | A0a, AE1a |
| A5b | Matrix page on DS `table`, `number-input`, `radio-group`, `modal` | app / X | 10 | A0b, A5a, A7b, A9, A2 (the matrix spec starts on the folders page: `07-matrix.spec.ts:160-174`) |
| A6a | Settings view-model extracted from the settings page (1,928 lines) | app / H | 10 | A0a, AE1a |
| A6b | Settings and memberships pages; runtime, workspace, administration and connector panels | app / H | 14 | A0b, A6a, A7b, A9, A11, T1b |
| A9 | Shared feature components and adapters: import and export dialog, documents block and its source menu, queue monitor; DS lock and presence badge with the neutral twin of `object-lock.ts`; the application adapter of chat-ui `StreamMessage` (87 lines, moved here from A8a: the queue monitor and four pages import it, section 6.12) | app / H | 16 | A0b, C2a |
| A1d | `auth-ui` (9 components, 8 of them exported) as additive `./vue` and `./vue/vapor` subpaths, Svelte exports unchanged. Split from A1a: two `cluster-mesh` screens and the identity-provider front import these components (section 6.12). With it: the build and qualification chain of the package, the two pieces that the sibling packages share — the build step of the candidate production and the packed-consumer target — and, in the same PR, what its version bump requires of `cluster-mesh`, which declares `auth-ui` as a peer: peer range, version of `cluster-mesh`, pinned peer, packaging fixture (section 6.14) | app / H | 18 | V10a; cluster-mesh lane cleared by s-conductor (candidate production; manifest, version and pinned peers of `cluster-mesh`) |
| A11 | `cluster-mesh` UI (5 screens) and `cited-source-viewer` (3 files) as additive `./vue` and `./vue/vapor` subpaths, Svelte exports unchanged; `LoginScreen` and `RegistrationScreen` on the merged Vue components of A1d; the build and qualification chains of both packages (section 6.14) | app / H | 16 | A1d; cluster-mesh lane cleared by s-conductor |
| A1a | The 7 authentication pages and their layout, on the merged Vue components of A1d and screens of A11 | app / H | 2 | A0b, A1d, A11 |
| A1b | `apps/auth-idp`: candidate front `web-vue/` (7 Svelte files today). It keeps the served layout of today — `404.html` fallback, hashed assets under `/_app/`, two root assets (`idp-app.ts:51`, `:198`, `:213-217`) — so that the service is unchanged and selects a build with `IDP_WEB_BUILD_DIR` (`idp-app.ts:50`). Build, type-check and lockfile targets for both fronts; smoke on both | app / H | 8 | A1d (decision D6) |
| A2 | Folders and organizations: 6 pages and `OrganizationForm` | app / H | 18 | A0b, A7b, A9, T1b |
| A3 | Initiative: 3 pages, `InitiativeDetail`, `GateReview` | app / H | 16 | A0b, A7b, A9, T1b |
| A8a | Chat host 1: `AppChatPanel` (3,478 lines) and `ChatPanel` on the chat-ui Vue binding; the two Svelte-bound host adapters; host-only behaviour per C0. It imports the editable field of A7b and the document source menu of A9 (`AppChatPanel.svelte:35-36`) | app / X | 16 | A0b, A7b, A9, C6a |
| A8b | Chat host 2: `ChatWidget` (3,429 lines), which mounts the queue monitor of A9 and the panel of A8a (`ChatWidget.svelte:94-95`), and the dock offsets of the shell; Vue entries, image stage and build targets of the Chrome extension and of the VS Code webview; the 29 extension files without a Svelte import are reached through the alias | app / X | 20 | A8a |
| A14 | Promotion: neutral modules, locales, static assets, shared suites and the neutral files of the two extensions moved from `ui/` to `ui-shared/`; alias updates; the tool paths that follow the moved files (section 6.13, column A14); no-reference check added to CI | app / H | 8 | A0a, A2, A3, A4b, A6b (sequencing choice: the reference tree stays untouched while most pages are compared; the lots still open reach the moved files through the alias) |

| Lot | Exit gate (verifiable) | Allowed paths |
|---|---|---|
| A7a | unit tests green for: save after the debounce, no save when locked, registration and release in the unsaved-change registry, payload taken from the getter | `ui-shared/editable-field/**` |
| A7b | harness spec `e2e/tests/harness/editable-field.spec.ts`: typing then leaving the field issues one save call whose body equals the expected one by value; a locked field issues none; for every Markdown value of the seeded data and of the fixture corpus, loading without editing issues no save, and editing one paragraph leaves the other blocks of the saved Markdown unchanged; citations follow decision D8; G-DS; G-ENTRY | `ui-vue/src/components/editable-field/**`, `ui-vue/src/harness/**`, `ui-shared/editable-field/**`, `e2e/tests/harness/**` |
| A4a | golden tests: for the seeded datasets, label boxes, medians and quadrants equal those of the reference functions with the same random seed | `ui-shared/charts/**` |
| A4b | G-BEH on `03-dashboard`, `03-prioritization-matrix`, `05-executive-summary`, `06-streams` and on the shared specs it completes (section 6.11); G-API, G-SEM, G-VIS, G-DS, G-ENTRY; image comparison of the drawn chart against the reference on seeded data | `ui-vue/src/routes/dashboard/**`, `ui-vue/src/components/scatter/**` |
| A5a, A6a | unit tests green on the extracted logic, with fixtures recorded on the pinned reference by the recorder of AE1a | `ui-shared/matrix/**`; `ui-shared/settings/**` |
| A5b | G-BEH on `07-matrix`, and on the shared specs it completes (section 6.11: `05-i18n`); G-API, G-SEM, G-VIS, G-DS, G-ENTRY | `ui-vue/src/routes/matrix/**` |
| A6b | G-BEH on `01-admin-users`, `06-settings`, `06-settings-codex-provider`, and on the shared specs it completes (section 6.11: `04-google-drive-settings-documents`); G-API, G-SEM, G-VIS, G-DS, G-ENTRY | `ui-vue/src/routes/settings/**`, `ui-vue/src/components/settings/**` |
| A9 | harness specs under `e2e/tests/harness/` for import, export, upload, document source and queue actions, with G-API on them; in the harness the `StreamMessage` adapter renders a recorded job stream to its terminal state through the package view of C2a, with the labels of both locales, and the expanded job of the queue monitor shows it; unit tests green on the neutral lock module; the lock badge shows the three lock states in the harness; G-DS; G-ENTRY | `ui-vue/src/components/**`, `ui-vue/src/harness/**`, `ui-shared/locks/**`, `e2e/tests/harness/**` |
| A1d | the existing tests of `make test-auth-ui` unchanged and green; version bumped; chain (section 6.14): on that version the job `validate-auth-ui` is green in CI from its first step to its last — `make build-auth-ui` writes `dist/` as today, `dist/vue/` and `dist/vue/vapor/`; the packed archive lists `dist/vue/index.js` and `dist/vue/vapor/index.js` beside the Svelte sources; the three packed consumers of `make qualify-ui-package` run on the archive returned by the pack step and mount the 8 exported components: Svelte, Vue 3.5 classic and Vue Vapor on the pin, the two Vue consumers with no Svelte package in their install tree; witnesses: the prepack gate fails on a tree without `dist/vue/vapor/`, and the Vapor consumer fails on an archive whose Vapor entry is removed; candidate production: the job `package-candidates` is green, its `auth-ui` archive lists the same Vue outputs, and the seven legs of `validate-cluster-mesh` are green in the PR of A1d, before any change of A11; dependency of `cluster-mesh` on `auth-ui` (section 6.14), carried by that PR: the peer range of `cluster-mesh` accepts the new version of `auth-ui` and keeps the 0.9 line, the version of `cluster-mesh` is bumped, and the pinned `auth-ui` of its three qualification steps is the new version; in `qualify-report.json` of the `install` leg (uploaded with the candidate qualification report: `ci.yml:1174-1181`), the edge from `cluster-mesh` to `@sentropic/auth-ui` is `ok` on the new version, `@sentropic/auth-ui` is installed at that version with the source `sibling-receipt` — the archive that `package-candidates` packed in this PR, not a registry version — and every runtime entry is imported; the `lazy` leg is green on the `selected` fixture aligned with both packages; an export-surface test added to the package asserts, for `./vue` and `./vue/vapor`, a compiled target under `dist/` for a registry consumer and a source target under `src/` for a consumer through a link (section 6.14); in the catalog diff no existing profile changes; `make test-ci-package-candidate`, `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs` and `make test-ci-lockfile-installs` green | `packages/auth-ui/**`. Conditional (section 6.14): `Makefile` (targets `typecheck-auth-ui`, `build-auth-ui`, `pack-auth-ui`: lines 2202-2213; new target `qualify-ui-package`; the `auth-ui` entry of the pinned peers of `ci-package-qualification`: line 1314), `.github/workflows/ci.yml` (job `validate-auth-ui`: lines 1463-1482; the same entry in the two post-publication steps of `cluster-mesh`: lines 3524, 3739), `scripts/ci/qualify-ui-package.mjs` (new), `scripts/ci/package-candidate.mjs` and its test, `packages/cluster-mesh/tests/storage/cold-workspace.sh` (tool list: lines 33-37), `packages/cluster-mesh/package.json` (version and peer range of `auth-ui` only: lines 3, 263), `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` and its `package-lock.json`, `scripts/ci/tool-locks.json`, `scripts/ci/consumer-locks.json`, `scripts/ci/publishable-ci-wiring.test.mjs`, root `package-lock.json` (workspace entries of `auth-ui` and `cluster-mesh`) |
| A11 | Svelte suites of both packages green (`make test-cluster-mesh`, `make test-cited-source-viewer`, `make test-cited-source-viewer-dom`), unchanged apart from the purity gate of `cited-source-viewer`, extended to the Vue sources and to the two Vue peers (section 6.14); versions bumped; chains (section 6.14): `validate-cited-source-viewer` green in CI from its first step to its last, and `validate-cluster-mesh` green on its legs, the UI lane included; each archive — for `cluster-mesh` the one of `package-candidates`, for `cited-source-viewer` the one of the pack step — lists its classic and its Vapor entry as compiled JavaScript; the three packed consumers of `make qualify-ui-package` green on each archive, mounting the 5 screens and the viewer with its two bodies; the Vue consumers of `cluster-mesh` install `auth-ui` at the version published by A1d, mount `LoginScreen` and `RegistrationScreen` on its Vue components (no stub), and hold no Svelte package; the install lane of `cluster-mesh` imports the Vue entries with its pinned peers; the cold workspace type-checks the Vue screens against the linked Vue sources of `auth-ui`, which it does not build (`cold-workspace.sh:17`, `:58`); witnesses: each package refuses to pack a tree without its Vapor output, and the Vapor consumer of each package fails on an archive whose Vapor entry is removed; in the catalog diff no existing profile changes; `make test-ci-package-candidate`, `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs` and `make test-ci-lockfile-installs` green | `packages/cluster-mesh/ui/**`, `packages/cluster-mesh/tests/ui/**`, `packages/cluster-mesh/package.json`, `packages/cited-source-viewer/**`. Conditional (section 6.14): `packages/cluster-mesh/tests/storage/cold-workspace.sh` (actions `typecheck` and `build`: lines 112-121), `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` and its `package-lock.json`, `Makefile` (target `ci-package-qualification` with its pinned peers: lines 1300-1318; targets `typecheck-cited-source-viewer`, `build-cited-source-viewer`, `pack-cited-source-viewer`: lines 4661-4699), `.github/workflows/ci.yml` (jobs `validate-cluster-mesh` and `validate-cited-source-viewer`: lines 1115-1181, 1263-1284; the pinned peers of the two post-publication steps of `cluster-mesh`: lines 3524, 3739), `scripts/ci/tool-locks.json`, `scripts/ci/consumer-locks.json`, `scripts/ci/publishable-ci-wiring.test.mjs`, root `package-lock.json` (workspace entries of the two packages) |
| A1a | G-BEH on `02-auth-devices`, `02-auth-oauth-authorization-code`, `02-auth-oauth-revoke`, `02-auth-routes` (section 6.11); G-NAV complete (login redirect and return); the pages import the merged Vue entries of A1d and A11 through the `file:` links, without a prior build of either package, and the candidate build compiles no Svelte component | `ui-vue/src/routes/auth/**` |
| A1b | `make typecheck-idp-web` and `make build-idp-web` green for both directories; the screens smoke `make smoke-idp-screens-ci` (role-based: `apps/auth-idp/screen-smoke.ts:110`, `:156`) green on the Svelte build of the API image and on the `web-vue/` build mounted into the CI service; the API image and `idp-app.ts` unchanged | `apps/auth-idp/web-vue/**`. Conditional: `Makefile` (targets `lock-idp-web`, `install-idp-web`, `typecheck-idp-web`, `build-idp-web`, `up-idp-sut`: lines 3412-3452, 3343-3351), `.github/workflows/ci.yml` (jobs `idp-web-static`, `smoke-idp-screens`: lines 991, 2411), the lockfile inventories (`.security/security-fix.json`, `.security/ci-lockfile-policy.json`, `scripts/security/daily/inventory.mjs` and its test, `scripts/security/sca-gate.test.mjs`, `scripts/ci/ci-lockfile-installs.mjs`) |
| A2 | G-BEH on `01-organizations-detail`, `02-organizations`, `04-documents-ui-actions`, `04-dossiers-reload-draft`, `05-error-handling`, `05-folder-new-multi-org`, `07-import-export`, `08-document-summary-formats`, `08-documents-summary`, and on the shared specs it completes (section 6.11); G-API, G-SEM, G-VIS, G-DS, G-ENTRY | `ui-vue/src/routes/folders/**`, `folder/**`, `organizations/**` |
| A3 | G-BEH on the gate-page spec added by AE1b, and on `05-folders`, `06-usecase`, `07-workflow` once their other owner lots are merged (section 6.11); G-API, G-SEM, G-VIS, G-DS, G-ENTRY | `ui-vue/src/routes/initiative/**`, `ui-vue/src/components/initiative/**` |
| A8a | harness spec of the chat panel under `e2e/tests/harness/`: send, stream, stop, retry, attachment, comment thread, context; streaming matrix green in the host; G-API on these flows; G-DS; G-ENTRY. No existing chat spec is complete before A8b: each opens the chat through the widget | `ui-vue/src/components/chat/**`, `ui-shared/chat/**`, `ui-vue/src/harness/**`, `e2e/tests/harness/**` |
| A8b | G-BEH on the 22 chat specs of section 6.11 (AI allowlist apart: `rules/testing.md:42`); dock offsets verified with the widget open; chat entries removed from the pending list; both extension builds green on the candidate; the 14 unit test files of `ui/tests/vscode-ext/` green on the files the candidate builds; `vscode/01-vscode-chat-streaming.spec.ts` green in its lane; G-API; G-SEM; G-DS; G-ENTRY | `ui-vue/src/components/chat/**`, `ui-vue/chrome-ext/**`, `ui-vue/vscode-ext/**`, `ui-vue/Dockerfile`. Conditional: `Makefile` (targets `build-ext-chrome`, `build-ext-vscode`, `test-e2e-vscode`: lines 355, 368, 3146), `docker-compose.e2e-vscode.yml`, `.github/workflows/ci.yml` (job `e2e-vscode`, line 2355) |
| A14 | Svelte build and suites green from the new locations; candidate build and unit tests green in a checkout without `ui/`; moves made as pure `git mv` commits, separate from import updates; the tooling suites named in the gate of A0a still green, and the Svelte image tag covers the moved files | `ui-shared/**`, `ui-vue/**`, and `ui/**` for moves, alias updates and the build context of the Svelte image only. Conditional: `.github/workflows/ci.yml` (no-reference check), `Makefile`, and the files of section 6.13, column A14 |

### 6.4 Application: acceptance, cutover, retirement

| Lot | Content | Lane | Build h | Depends on | Exit gate (verifiable) | Allowed paths |
|---|---|---|---|---|---|---|
| A10a | Unit tests moved to the candidate: the 14 tests bound to `.svelte` files rewritten or retired with a reason; coverage manifest closed | app / H | 16 | A1a, A1d, A2, A3, A4b, A5b, A6b, A7b, A8a, A8b, A9, A11, T1a, T1b, A14, C7a | `make test-ui-vue` green; every manifest row `covered` or a registered exception; reference-change ledger empty | `ui-shared/**`, `ui-vue/**` |
| A10b | Acceptance of the whole candidate. Milestone **M-APP** | app / H | 16 | A10a, T3 | the manifest equals the numbered specs of `e2e/tests` (the 56 of today and those added by AE1a and AE1b) and is green on the Vapor entry without timeout change (AI allowlist apart); the VS Code spec green in its lane; the pending list empty; G-BEH and G-NAV green on the classic entry; G-API, G-SEM, G-PRINT, G-STATE, G-DS green; the register within its bounds, with its three figures; extension gates of A8b; no-reference check; G-VIS report with zero `defect`; the `ds-intended` list and the register approved by the owner | `e2e/**`, `ui-vue/**` |
| A15 | Cutover of the application on owner GO: deployed UI image switched; `ui/` deleted; `UI_TARGET=svelte` branches removed; the `ui` root removed from every repository tool that reads it, the root workspace list and the API image inputs included (section 6.13, column A15); API image rebuilt and re-pinned | app / H | 10 | M-APP, owner GO | before the GO: the A15 branch green on the complete CI workflow with every job selected — the tooling suites of A0a, `make test-ci-api-image-canonical`, `make test-chat-ui-dom`, the API unit suite, both image builds and the security jobs included; `git grep` finds no path under `ui/` outside dated documents and the fixtures listed in section 6.13; rollback rehearsed (previous UI image redeployed against both API tags, session and storage intact). After the switch: the smoke suite green on the deployed target; `git ls-tree` finds no `.svelte` file under `ui*/` | deletion of `ui/**`. Conditional: `Makefile`, `docker-compose*.yml`, `.github/workflows/ci.yml`, `deploy/**`, root `package.json` and `package-lock.json`, `.dockerignore`, `.gitignore`, and the files of section 6.13, column A15, which include `api/Dockerfile`, one API route default and two API tests |
| A1c | Cutover of the identity-provider front on owner GO: the default of the service, the build stage of the API image, the CI service and the k8s manifest point at the Vue build; `apps/auth-idp/web/**` deleted with its targets and lockfile entries | app / H | 4 | A1b, owner GO | `git ls-tree` finds no `.svelte` file under `apps/auth-idp`; `git grep` finds no `auth-idp/web/` path outside `web-vue/` and dated documents; `make smoke-idp-screens-ci` and `make smoke-idp` green on the built API image; rollback rehearsed before the GO (previous API image on the `auth-idp` deployment) | `apps/auth-idp/**` (deletion of `web/**`; `idp-app.ts:46-50`; `README.md`). Conditional: `api/Dockerfile` (stage `idp-web-build`: lines 436-447, 506), `Makefile`, `docker-compose.ci.yml` (line 60), `deploy/k8s/base/35-auth-idp.yaml`, `.github/workflows/ci.yml`, the lockfile inventories of A1b |
| A16 | Svelte exports removed from `auth-ui`, `cluster-mesh/ui`, `cited-source-viewer` (breaking version of each); the Svelte packed consumer, the Svelte outputs and the Svelte tools leave the three chains with them (section 6.14) | app / H | 4 | A15, A1c | no consumer imports a Svelte export of the three packages (`git grep` in the repository, `apps/auth-idp` included, and in immo's declared pins); the Vue packed consumers of section 6.14 green without `svelte` installed, on archives that list no `.svelte` file; no Svelte tool left in the recipes of the three packages | the three packages. Conditional: the chain files of section 6.14 (recipes and jobs of the three packages, `cold-workspace.sh`, the two catalogs, the wiring test, root `package-lock.json`) |

### 6.5 chat-ui lots (sentropic scope)

Hours and content are those of the binding DS input and of `PLAN.md:735-747`, with four differences: C1 gains 6 h (content renderer, content stylesheet, Vue entry scaffold); the three Vue batches become four lots that follow the import graph; C6a qualifies the package with consumer targets of its own instead of `make qualify-published-install` (`PLAN.md:741`; CI chain at the end of this section); the additions of this spec are marked "added".

Import graph of the 24 views [FAIT, `import … from '….svelte'` in `packages/chat-ui/src`]: 20 views import no other view; 4 are compositions.

| Composition | Lines | Views it imports | Evidence |
|---|---|---|---|
| `ChatPanelShell` | 844 | `CommentsPanel`; `ChatComposer`, `ChatTimeline`, `MessageActions`, `StreamMessage`; `ModelSelector`; `AttachmentBand`, `GeneratedFileCardTray`, `ImageLightbox`, `MessageAttachments` | `ChatPanelShell.svelte:20`, `:24-32` |
| `ChatConversation` | 195 | `ChatPanel`, `ChatTimeline`, `ChatComposer`, `MessageActions`, `StreamMessage`; `ModelSelector`, `ChatContextPicker`; the same four document views | `ChatConversation.svelte:5-15` |
| `ChatWidget` | 138 | `ChatWidgetTabBar`, `ChatWidgetPager` | `ChatWidget.svelte:3`, `:5` |
| `ChatWidgetPager` | 59 | `AgentsList` | `ChatWidgetPager.svelte:3` |

Split [JUGEMENT]. The batches of the DS plan put `ChatConversation` in C2 and `ChatPanelShell` in C3, although both import views of C2 and of C4: the three batches were not independent. The two cross-batch compositions move to a lot of their own, C2b, which starts when its elements are merged. The other two compositions stay in C3 with the views they import. `ChatPanel` (77 lines), named in no batch of the DS plan and imported inside the package by `ChatConversation` only, joins C2a. Hours: the 58 h of the binding input are redistributed pro rata of the Svelte lines of each batch of origin (`ChatConversation` 195 of 1,767 lines of C2 = 2.6 h; `ChatPanelShell` 844 of 2,549 lines of C3 = 6.6 h) and each share is rounded up to an even hour: 22 + 10 + 14 + 14 = 60 h.

| Lot | Layer | Views (Svelte lines) | Lines | Imports of another lot |
|---|---|---|---|---|
| C2a | message elements | `StreamMessage` 1,153, `MessageActions` 219, `ChatComposer` 175, `ChatPanel` 77, `ChatTimeline` 25 | 1,649 | none |
| C4 | selector, context, document and comment elements | `CommentsPanel` 520, `AttachmentBand` 173, `MessageAttachments` 138, `ModelSelector` 123, `ContextChips` 113, `ImageLightbox` 112, `GeneratedFileCardTray` 91, `ChatContextPicker` 72 | 1,342 | none |
| C3 | widget chrome, self-contained | `ChatDock` 614, `ChatPlacementMenuButton` 296, `AgentsList` 225, `ChatSessionsBar` 152, `ChatWidget` 138, `SessionList` 107, `ChatWidgetTabBar` 86, `ChatWidgetPager` 59, `ChatPlacementDropZones` 28 | 1,705 | none: its two compositions import views of C3 only |
| C2b | compositions | `ChatPanelShell` 844, `ChatConversation` 195 | 1,039 | C2a (5 views), C4 (7 views) |

The four lots hold 5 + 8 + 9 + 2 = 24 views and 5,735 lines (section 2.0). Files shared by the three element lots — the two Vue entries, their build with its make and CI chain, and the host page without Tailwind — are created empty by C1, so that C2a, C3 and C4 only add files, apart from the pin commit of the CI chain (end of this section); the version field of `package.json` is re-checked after each rebase (`rules/workflow.md:116-120`).

| Lot | Content | Lane | Build h | Depends on |
|---|---|---|---|---|
| C0 | Gap audit: behaviour and DOM matrix over three columns — application host on 1.0.1 (the reference), the package, the immo host on 0.33.0 — plus the DS primitives; list of host behaviour to move into the package. Added: inventory of the Tailwind dependence of the 24 views and their DS mapping, and the recomputed hours of the Vue lots C2a, C2b, C3 and C4 | chat / X | 10 | — |
| C1 | Neutral streaming core: Markdown on `marked` + sanitiser instead of `svelte-streamdown`; package stores as neutral signals, `chatWidgetLayout` included; neutral twin of the `chat-core` local-tools store. Added: the content renderer of section 3.5.1, whose HTML carries no class, inline style or inline handler, beside the untouched generator of the Svelte path. The Svelte views are not switched to the new core, so the reference does not move. Added: the content stylesheet `src/content/content.css`, its subpath `./content.css` and its contract test (section 3.5.1). Added: the Vue entry scaffold — the two empty entries behind `./vue` and `./vue/vapor`, their build on the pins, and the host page without Tailwind that loads the DS styles and `./content.css` only. Added: that build wired into the make and CI chain of the package ("CI chain" at the end of this section) — tool profiles, the type-check, test, build and pack targets, and the archive path handed from the pack step to the consumer qualification | chat / X | 24 | C0 |
| C2a | Vue elements 1: StreamMessage, MessageActions, Composer, Timeline, ChatPanel | chat / X | 22 | C1, V10a; evidence of G-2 |
| C3 | Vue widget chrome: Dock, placement, sessions, TabBar, AgentsList, then Pager and Widget, which import them | chat / H | 14 | C1, V10a |
| C4 | Vue elements 2: ModelSelector, context picker and chips, 4 document views, CommentsPanel | chat / H | 14 | C1, V10a |
| C2b | Vue compositions: PanelShell and Conversation, on the merged views of C2a and C4 | chat / X | 10 | C2a, C4; evidence of G-2 |
| C7a | Vue acceptance on the classic and the Vapor build | chat / H | 8 | C2a, C2b, C3, C4; L1.6 or the instrument of AE1a |
| C6a | Packaging: installation contract of the additive `./vue` and `./vue/vapor` subpaths, whose entries C1 creates and the four Vue lots fill; export manifest completed; `svelte`, `@lucide/svelte`, `svelte-streamdown` become optional peers; `vue` and `design-system-vue` added as optional peers | chat / H | 6 | C7a |
| C6c | Svelte retirement (major version) | chat / H | 4 | A15, immo's cutover, the Preact packaging C6b |

| Lot | Exit gate (verifiable) | Allowed paths |
|---|---|---|
| C0 | every behaviour of the 7,052 host lines is a row assigned to `package` or `host`, none unassigned; the DS-usage column reviewed by the DS session; recomputed hours of the Vue lots C2a, C2b, C3 and C4 recorded on the track item | `spec/**` (audit document), `packages/chat-ui/tests/fixtures/**` |
| C1 | streaming matrix fixtures green on the neutral core; its HTML equals the recorded output of the current renderer on the fixture conversations once `class` and `style` attributes are removed from both, differences listed and reviewed; the fixtures of rule DS-7 green on the content renderer (headings, nested lists, links, code, citations with and without a reference, inline Markdown, truncated stream); a golden test pins the current output of `src/utils/markdown-refs.ts`, whose spec `tests/markdown-refs.spec.ts` stays unchanged; the existing suites of `make test-chat-ui` and `make test-chat-ui-dom` unchanged and green; versions bumped; stylesheet contract test green: every selector of `content.css` starts with `[data-st-content]`, no class selector, no `--tw-*` variable, colours, spacing and type from `var(--st-*)` only; `./content.css` present in `exports` and in `export-manifest.json`, `tests/export-surface.spec.ts` green; the two empty Vue entries build on both outputs and the host page serves them without Tailwind; CI chain: on the version bumped by this lot, hence not `1.0.1`, the job `validate-chat-ui` is green in CI from its first step to its last — `make build-chat-ui` writes the three outputs, `make pack-chat-ui` packs them, `make qualify-chat-pair` receives the archive path returned by the pack step; the packed archive lists `dist/index.js`, `dist/vue/index.js`, `dist/vue/vapor/index.js`, `dist/theme/chat-ui.css` and `dist/content/content.css`, and no path under `src/`; witness: a package test runs the prepack gate on a dist-form tree without `dist/vue/` and expects its failure; `git grep -E 'sentropic-chat-ui-[0-9]'` finds nothing under `.github/` and in `Makefile`; in the catalog diff no existing profile changes; `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs` and `make test-ci-lockfile-installs` green; `chat-core` (section 6.14): the job `validate-chat-core` green on its bumped version, the entry of the neutral store in the import list of its report, its pinned peers unchanged | `packages/chat-ui/**`, `packages/chat-core/src/runtime/stores/**`, `packages/chat-core/tests/**`, `packages/chat-core/scripts/test.sh`, `packages/chat-core/package.json`. Conditional (CI chain): `Makefile` (targets `typecheck-chat-ui`, `build-chat-ui`, `pack-chat-ui`, `test-chat-ui`, `test-chat-ui-dom`: lines 1783-1802, 2919-2945), `.github/workflows/ci.yml` (job `validate-chat-ui`: lines 1225-1261), `scripts/ci/tool-locks.json`, `scripts/ci/publishable-ci-wiring.test.mjs`, root `package-lock.json` (workspace entries of the two packages) |
| C2a, C3, C4 | per view: same normalised DOM semantics and same accessibility snapshot as the Svelte view on the package fixtures; streaming behaviour equal on the fixture conversations; G-DS on the Vue sources, with the rendered-DOM scan of rule DS-7 in the host page without Tailwind; both entries built; version bumped; no import of a view of another lot (check on the Vue sources). For the element that renders generated content (C2a: `StreamMessage`, `StreamMessage.svelte:980`, `:1000`): in that host page, which loads no file of `ui-vue/`, a heading, a nested list, a code block and a citation link have the computed styles of the stylesheet | `packages/chat-ui/**`. Conditional (CI chain): `Makefile` and `scripts/ci/tool-locks.json`, for the pin commit of `@sentropic/design-system-vue` only |
| C2b | the gate of the element lots, on the two compositions mounted with the real Vue views of C2a and C4 (no stub); the chat panel fixture — AI mode and comments mode — gives the same accessibility snapshot as the Svelte composition; the user message of the panel, which renders generated content (`ChatPanelShell.svelte:329`), passes the same computed-style check as `StreamMessage` | `packages/chat-ui/**` |
| C7a | the 4 `*-parity.dom.spec.ts` suites green on both builds; streaming matrix green; browser checks green | `packages/chat-ui/**` |
| C6a | clean packed consumers, the three of them run by the job `validate-chat-ui` on the archive returned by the pack step (CI chain): Svelte by `make qualify-chat-pair` (consumer contract unchanged; the probe names the two peers that become optional); Vue 3.5 classic with no Svelte package installed and Vue Vapor on the pin by `make qualify-chat-ui-vue`; added: the Vue consumers are installed from the tarball in a directory outside the repository, with no Tailwind and no file of `ui-vue/` reachable; they import the Vue entry and `@sentropic/chat-ui/content.css`, render the content fixture, and assert the computed styles of a heading (size and weight from the tokens), a nested list (marker and indent), a code block (monospace family and token background) and a citation link (token colour); witness: the same page without the stylesheet import fails these assertions; stylesheet exports validated as resources: `./content.css` and `./theme.css` each resolve from the consumer to a non-empty file of the installed package that `sideEffects` covers, and the consumer build carries the content rules; witness: with the target of `./content.css` removed from the installed copy, that validation fails; `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs` and `make test-ci-lockfile-installs` green. `make qualify-published-install` is not a gate of this package (CI chain) | `packages/chat-ui/**`. Conditional (CI chain): `Makefile` (new target `qualify-chat-ui-vue`), `.github/workflows/ci.yml` (job `validate-chat-ui`), `scripts/ci/qualify-chat-ui-vue.mjs` (new), `scripts/ci/qualify-chat-pair.mjs`, `scripts/ci/publishable-ci-wiring.test.mjs`, `scripts/ci/tool-locks.json`, `scripts/ci/consumer-locks.json` |
| C6c | no consumer imports the Svelte entry: application after A15, immo after its cutover, both extension builds on the Vue entries | `packages/chat-ui/**` |

**CI chain of the package** [FAIT for the chain, read at `c40b8d1b5`; JUGEMENT for the changes and their lots]. The job `validate-chat-ui` runs seven make steps (`.github/workflows/ci.yml:1225-1261`); `publish-chat-ui` and `ci-gate` wait for it (`:2977`, `:3845`). No step calls the `build`, `typecheck` or `test` script of the manifest (`packages/chat-ui/package.json:257-259`); only `prepack` runs, inside the pack. A Vue build declared in the manifest alone is therefore run by nothing, and what is published is the output of `make build-chat-ui` (`Makefile:2257`).

| Link | Today | Change | Lot |
|---|---|---|---|
| Tool sets | the type-check, test, DOM-test and build recipes each install a tool list written in the recipe, which holds Svelte tools and no Vue tool (`Makefile:1785`, `:2922`, `:2945`, `:1794`); the installer refuses a list that is not a profile of the committed catalog (`scripts/ci/locked-tools.mjs:17-20`), and `make test-ci-lockfile-installs` binds every call to a profile (`scripts/ci/ci-lockfile-installs.test.mjs:193`) | the lists gain what the new sources import — the Markdown engine, the sanitiser and the signal library of the neutral core, and the Vue toolchain on the exact pins (section 3.1) — as profiles added to `scripts/ci/tool-locks.json` with `make lock-ci-tools` (`.security/ci-lockfile-installs.mk:10-13`); the existing profiles are not renewed | C1 |
| DS Vue pin | the Vapor pre-release of `@sentropic/design-system-vue` does not exist before V10a (section 5.1) | C1 locks no version of it: its empty entries import nothing from the DS. The V10a pre-release enters the recipes and the Vue profiles by one commit, authored at V10a in the branch of C2a and taken unchanged by C3 and C4, which need it from their first test | C2a, C3, C4 |
| Build | `build-chat-ui` runs `svelte-package -i src -o dist` and nothing else (`Makefile:1791-1794`); `pack-chat-ui` and `publish-chat-ui` depend on it (`:1800`, `:2257`) | one target, three outputs of the same sources: the Svelte output unchanged, `dist/vue/` (classic) and `dist/vue/vapor/` (Vapor), with the two stylesheets | C1 |
| Pack | the archive is dist-form: exports rewritten from `./src/` to `./dist/`, `src` dropped (`packages/chat-ui/scripts/make-publish-pkgjson.mjs`); the prepack gate requires `dist/index.js` and `dist/theme/chat-ui.css` (`packages/chat-ui/scripts/verify-publish-artifacts.mjs:28`, run as `prepack`: `packages/chat-ui/package.json:260`) | the rewriter maps `./vue`, `./vue/vapor` and `./content.css`; the prepack gate also requires `dist/vue/index.js`, `dist/vue/vapor/index.js` and `dist/content/content.css` | C1 |
| Archive path | the UI archive is named by a literal that carries the version, `sentropic-chat-ui-1.0.1.tgz` (`ci.yml:1255`), and `qualify-chat-pair` stops on a missing file (`Makefile:1771`); the core archive comes from the output of its pack step (`ci.yml:1248-1253`). The pack macro returns the path for every package (`Makefile:985`; `scripts/ci/publishable-manifests.mjs:713`); the wiring test asserts the core archive only (`scripts/ci/publishable-ci-wiring.test.mjs:445-455`). The last bump needed a second commit to edit the literal (`1e0caadd2`, then `2f397cda4`) | the UI pack step gets an identity and `PACK_OUTPUT_FILE`; `UI_ARCHIVE` reads its `tarball` output, as the core archive does; the wiring test asserts both archives | C1 |
| Version bump | a bump changes `packages/chat-ui/package.json:3` and the workspace entry of the root `package-lock.json` (commit `1e0caadd2`) | after C1 a bump changes these two files and no other; the root lock entry is a standing conditional path of every `C*` lot | all `C*` |
| Svelte consumer | `qualify-chat-pair` installs both archives in a clean directory, type-checks and builds a Svelte consumer, and refuses an archive that carries `src/` (`scripts/ci/qualify-chat-pair.mjs:16-18`, `:35-36`, `:40`); `@lucide/svelte` and `svelte-streamdown` reach it as required peers (`packages/chat-ui/package.json:262-268`) | kept as the Svelte packed consumer; when the two peers become optional, its install list names them | C6a |
| Vue consumers and stylesheet exports | none. `qualify-published-install` is not run on this package — it is run for `mcp-auth`, `chat-core` and `cluster-mesh` (`ci.yml:1360`, `:1565`; `Makefile:1314`) — and cannot pass on it: an export whose target is not JavaScript is `unsupported`, which fails the run (`scripts/ci/qualify-published-install.mjs:18`, `:57`, `:404`, `:453`), and its test pins that on `./theme.css` (`qualify-published-install.test.mjs:90-94`). The package has had such an export since before this plan (`packages/chat-ui/package.json:24`) | a qualification of the package's own, `make qualify-chat-ui-vue` (name to confirm with s-conductor), run twice by `validate-chat-ui` on the same archive — classic, Vapor — beside `qualify-chat-pair`. The generic check and its test are not changed | C6a |

`qualify-chat-ui-vue` [JUGEMENT], modelled on `qualify-chat-pair`:

- **Install.** The archive of the pack step, in a clean directory outside the repository, through the frozen consumer installer (`scripts/ci/locked-consumer.mjs`), with `vue` (a locked 3.5.x for classic, the exact pin for Vapor), `@sentropic/design-system-vue`, Vite, its Vue plugin and `vue-tsc`, and no Svelte package. Every version comes from the committed catalogs (`scripts/ci/tool-locks.json`, `scripts/ci/consumer-locks.json`).
- **Stylesheet resources.** For each export of the installed manifest whose target is a stylesheet: the target resolves from the consumer, is a non-empty file inside the installed package and matches a `sideEffects` pattern; `./content.css` passes the selector contract of C1 on the installed file.
- **Build.** Type-check and Vite production build of a consumer page that imports the Vue entry and `@sentropic/chat-ui/content.css` and renders the content fixture; the emitted stylesheet carries the content rules.
- **Computed styles.** The built page is opened in the qualified browser image of the end-to-end lane, as the identity-provider screen smoke does (`Makefile:3352-3364`); the four assertions of the gate of C6a run there. `validate-chat-ui` then waits for `build-e2e` and loads its image, as `smoke-idp-screens` does (`ci.yml:2415`, `:2446`). The image exists whenever the job runs: every path of the `chat_ui` filter is also in the `ui` or the `global` filter (`ci.yml:543-548`; `:389`, `:421`, `:492-495`).
- **Negative controls**, in the same run: the page built without the stylesheet import fails the computed-style assertions; the installed copy without the target of `./content.css` fails the resource validation.

Rules [JUGEMENT]:

- **C1 before the element lots.** C2a, C3 and C4 add views and tests; apart from the pin commit they change neither a recipe nor the workflow.
- **Same files as A0a.** C1 and A0a both edit `Makefile`, the workflow and the wiring test, in disjoint regions: package recipes and `validate-chat-ui` for C1; UI targets, jobs and manifests for A0a. A0a merges first (section 6.8) and C1 rebases on it.
- **Selection.** A change of `Makefile` or of the workflow sets the `global` filter (`ci.yml:389`, `:421`), and the tool catalog is an input of the API and UI image tags (`Makefile:86`; `scripts/ci/ui-image-version.sh:6-8`): the PRs of C1 and C6a and the pin commit select the lanes of a global change, and a PR that adds a tool profile moves both tags, so both images are rebuilt. The root lock is an input of both tags as well: every version bump already moves them.
- **Hours.** The chain work is carried inside the hours of C1 (24) and of C6a (6); this is an assumption of section 9.3.

### 6.6 Templater lots (sentropic scope, except T4)

| Lot | Content | Lane | Build h | Depends on |
|---|---|---|---|---|
| T0 | Contracts of both families (section 3.6): JSON Schema of family (b); TypeScript contract and adapters of family (a); consumer map; mapping tables (colour to tone, print class to print hook); inventory of every rule of `app.print.css` that targets templater output, with its future hook | templater / X | 10 | — |
| T2 | Templater neutral core in `ui-shared/templater/`: the two stores as neutral signals; added: the framework-independent script of the renderer (`TemplateRenderer.svelte:38-457`) — buffers merged on server updates, payload builders, field collection, tab visibility, label resolution — with reference items returned as data instead of HTML strings; added: the application content wrapper `ui-shared/content/markdown.ts` and its sanitiser allow-list (section 3.5.1) | templater / X | 12 | T0, A0a, C1 |
| T1a | Family (a) in Vue on DS components: `ViewTemplateRenderer`, `ContainerView`, file menu | templater / X | 6 | T0, A0a, V10a |
| T1b | Family (b) in Vue on DS components: the 8 field types, the two slots, the recursive entity loop; the catalogue; added: the content view of the application, which applies `v-html`, sets the content hook and imports the package stylesheet `@sentropic/chat-ui/content.css` (exception EX-7; no stylesheet of its own), and the complexity scale (exception EX-8) | templater / X | 14 | T0, T2, T1a, A7b; evidence of G-2, G-7, G-8 |
| T1c | Print layer: `print.css` re-authored on print hooks and tokens; print mode composable; print rendering of the templater, of the report pages and of the scatter host | templater / X | 16 | T1b, T0, AE1b |
| T3 | Acceptance: parity on every seeded descriptor of both families; print and PDF acceptance | templater / H | 10 | T1a, T1b, T1c, A2, A3, A4b |
| T4 | Convergence, **owned by the DS**: family (b) translated to a DS envelope and rendered by the elements interpreter on Vapor | DS | (10, not counted here) | T3, V12a |

| Lot | Exit gate (verifiable) | Allowed paths |
|---|---|---|
| T0 | the 7 seeded descriptor shapes validate against the schema; a seeded mutation is rejected; the consumer map lists the 5 consumers with `file:line`; the print inventory covers the 441 selector lines, each with a target and a future hook or a "dropped" reason | `ui-shared/templater/contract/**`. Conditional: `spec/SPEC_TEMPLATING.md` |
| T2 | unit tests green for: server change with and without a local edit, sibling payload of a nested key, list and Markdown round trip, tab visibility, sub-template resolution; a copy of the `viewTemplateCache` tests re-pointed with unchanged assertions; the fixtures of rule DS-7 green on the content wrapper; the sanitiser fixture drops `class`, `style` and inline handlers | `ui-shared/templater/**`, `ui-shared/content/**` |
| T1a | on its own bench, without any route: harness spec `e2e/tests/harness/templater-container.spec.ts` on the harness entry — sort, group, empty, loading, header-only mode, card activation by click and by keyboard, each file-menu action reaches its adapter; accessibility snapshot of the loading, empty and filled states; G-DS; G-ENTRY. `/neutral` is the gate of A0b, not of this lot | `ui-vue/src/templater/container/**`, `ui-vue/src/harness/**`, `e2e/tests/harness/**` |
| T1b | harness spec `e2e/tests/harness/templater-fields.spec.ts`: for each of the 7 seeded shapes in the three modes (editable, locked, printing), the accessibility snapshot contains the labels and values of the reference, both rating scales included; the entity loop renders its entities on the Vapor entry without the interop plugin; the two slots receive the same parameters; rule DS-7 green in the three modes; in locked mode a heading, a nested list, a code block and a citation link of a rendered field have the computed styles of the package stylesheet, and `git ls-files ui-vue` finds no content stylesheet; G-DS; G-ENTRY | `ui-vue/src/templater/**`, `ui-vue/src/components/content/**`, `ui-vue/src/harness/**`, `e2e/tests/harness/**` |
| T1c | lint: every selector of `print.css` uses print hooks or tokens, none names a utility class or a private DS class; harness spec `e2e/tests/harness/templater-print.spec.ts`: the seeded initiative prints with the reference page count and first headings | `ui-vue/src/styles/print.css`, `ui-vue/src/templater/print/**`, `ui-vue/src/harness/**`, `e2e/tests/harness/**` |
| T3 | G-PRINT green for the printed views (dashboard report of each workspace type, initiative detail, organization); G-SEM green for the 17 seed rows; callbacks and menu actions of family (a) behave as on the reference | `e2e/**`, `ui-vue/src/templater/**` |

### 6.7 Totals

| Workstream | Lots | Build hours | Of which before V10a | Against the DS plan |
|---|---|---|---|---|
| Application | 29: AE1a, AE1b, AE2a, AE2b, A0a, A0b, A1a, A1b, A1c, A1d, A2, A3, A4a, A4b, A5a, A5b, A6a, A6b, A7a, A7b, A8a, A8b, A9, A11, A14, A10a, A10b, A15, A16 | 346 | 96 (AE1a, AE1b, AE2a, AE2b, A0a, A7a, A4a, A5a, A6a) | 270 (`PLAN.md:727`): +76 = AE1 26, AE2 12, A0 +8, A1 +12, A2 −2, A5 +4, A6 +4, A7 +2, A9 +2, A11 +6, A15 +2 |
| chat-ui | 9: C0, C1, C2a, C2b, C3, C4, C7a, C6a, C6c | 112 | 34 (C0, C1) | `PLAN.md:735-747`, Vue part: +8 = C1 +6 (content renderer, content stylesheet, Vue entry scaffold), rounding of the four Vue lots +2 |
| Templater | 6: T0, T2, T1a, T1b, T1c, T3 | 68 | 22 (T0, T2) | 44: +24 = print layer T1c 16, renderer core and content wrapper in T2 +6 net, content view and complexity scale in T1b +2 |
| **Vue pass, sentropic** | **44** | **526** | **152** | |

- Against revision 1 of this plan (39 lots, 472 h): +5 lots and +54 h. Revision 2 added 3 lots and 26 h (section 9.7); revision 3, 1 lot and 14 h (section 9.8); revision 5 adds 1 lot and 14 h (section 9.10).
- Revision 5, itemised. The 12 h of A1a are redistributed pro rata of Svelte lines — 1,667 lines for the 9 components of `auth-ui`, 265 for the 8 route files — and each share is rounded up to an even hour, as for the chat views in section 6.5: 10.4 h → 12 h (A1d) and 1.6 h → 2 h (A1a), +2 h. The chain work of section 6.14 is added to the lots that own it: A1d +6 h (4 h for the chain of `auth-ui`, 2 h for the candidate build step and the packed-consumer target, written once for the three packages), A11 +6 h (4 h for `cluster-mesh`, 2 h for `cited-source-viewer`, which already has a dist-form build).
- Overhead: 4 h per lot (CI 0.5 h, independent review 1 h, integration 0.5 h, queue 2 h — the assumption of `PLAN.md:889`, `unverified`), that is 176 h for 44 lots.
- From V10a to M-APP: 26 lots, 344 build hours. A1b (8 h) follows A1d and is not on the path to M-APP.
- Behind an owner act: A15, A1c, A16, C6c — 22 build hours.
- Not counted: T4 (DS), every DS lot, the DS side of the gap requests of section 5.4 (`unknown`; the sentropic side is counted in the lots named there), the Preact pass (section 6.10).
- [JUGEMENT] All hours are estimates from the counts of section 2, not measurements, and stay provisional until two measurements exist: the porting rate that A0b records on `/neutral`, and the hours of the Vue lots C2a, C2b, C3 and C4 that C0 recomputes. s-conductor recomputes the view lots and this schedule from them before the lots concerned start.

### 6.8 Schedule model and schedule

[JUGEMENT] The schedule, the milestones of section 6.9 and the French summary are generated from one dependency graph, the table below. The lot tables of sections 6.2 to 6.6 repeat its dependencies; if they differ, this table is the source.

Assumptions, all `unverified` until s-conductor confirms them:

- Start of the first lots: 13/11 08:00. Day 0 of the DS: 14/11 08:00; V10a: day 0 + 55 h = 16/11 15:00.
- Four sentropic branches at a time (`rules/workflow.md:55`, "max 4 branches per wave"); a branch slot is held from the start of the build to the merge.
- Elapsed time of a lot = build hours + 4 h. Builder sessions, reviewers and s-conductor available without interruption. Owner waits are counted as zero and named.

Rule of computation: a lot starts at the latest of three times — its earliest release, the merge of every lot it depends on, the end of the previous lot of its slot. The slot sequences are a choice; the start and merge times follow from the rule. The rule was run mechanically on this table for the four-slot and the five-slot sequences; every prerequisite was checked in both.

| Lot | Build h | Elapsed h | Depends on | Earliest release | Start → merged, four slots |
|---|---|---|---|---|---|
| C0 | 10 | 14 | — | 13/11 08:00 | 13/11 08:00 → 13/11 22:00 |
| C1 | 24 | 28 | C0 | 13/11 08:00 | 13/11 22:00 → 15/11 02:00 |
| T0 | 10 | 14 | — | 13/11 08:00 | 13/11 18:00 → 14/11 08:00 |
| T2 | 12 | 16 | T0, A0a, C1 | 13/11 08:00 | 15/11 02:00 → 15/11 18:00 |
| AE1a | 12 | 16 | — | 13/11 08:00 | 13/11 08:00 → 14/11 00:00 |
| AE1b | 14 | 18 | AE1a | 13/11 08:00 | 14/11 00:00 → 14/11 18:00 |
| AE2a | 6 | 10 | — | 13/11 08:00 | 13/11 08:00 → 13/11 18:00 |
| AE2b | 6 | 10 | AE2a, A0a | 13/11 08:00 | 14/11 10:00 → 14/11 20:00 |
| A0a | 22 | 26 | — | 13/11 08:00 | 13/11 08:00 → 14/11 10:00 |
| A7a | 6 | 10 | A0a | 13/11 08:00 | 15/11 02:00 → 15/11 12:00 |
| A4a | 12 | 16 | A0a | 13/11 08:00 | 14/11 10:00 → 15/11 02:00 |
| A5a | 8 | 12 | A0a, AE1a | 13/11 08:00 | 14/11 20:00 → 15/11 08:00 |
| A6a | 10 | 14 | A0a, AE1a | 13/11 08:00 | 14/11 18:00 → 15/11 08:00 |
| T1a | 6 | 10 | T0, A0a | V10a | 16/11 15:00 → 17/11 01:00 |
| A7b | 10 | 14 | A0a, A7a, AE1a, AE2b | V10a | 17/11 09:00 → 17/11 23:00 |
| A0b | 12 | 16 | A0a, AE1a, AE2b, T1a, C1 | V10a, L1.7 | 17/11 01:00 → 17/11 17:00 |
| A1d | 18 | 22 | — | V10a | 17/11 09:00 → 18/11 07:00 |
| A11 | 16 | 20 | A1d | V10a | 18/11 07:00 → 19/11 03:00 |
| C2a | 22 | 26 | C1 | V10a | 16/11 15:00 → 17/11 17:00 |
| C3 | 14 | 18 | C1 | V10a | 16/11 15:00 → 17/11 09:00 |
| C4 | 14 | 18 | C1 | V10a | 16/11 15:00 → 17/11 09:00 |
| C2b | 10 | 14 | C2a, C4 | V10a | 17/11 17:00 → 18/11 07:00 |
| C7a | 8 | 12 | C2a, C2b, C3, C4 | V10a | 18/11 07:00 → 18/11 19:00 |
| C6a | 6 | 10 | C7a | V10a | 18/11 19:00 → 19/11 05:00 |
| T1b | 14 | 18 | T0, T2, T1a, A7b | V10a | 17/11 23:00 → 18/11 17:00 |
| T1c | 16 | 20 | T1b, T0, AE1b | V10a | 19/11 15:00 → 20/11 11:00 |
| A9 | 16 | 20 | A0b, C2a | V10a | 17/11 17:00 → 18/11 13:00 |
| A1a | 2 | 6 | A0b, A1d, A11 | V10a | 19/11 03:00 → 19/11 09:00 |
| A1b | 8 | 12 | A1d | V10a | 20/11 19:00 → 21/11 07:00 |
| A2 | 18 | 22 | A0b, A7b, A9, T1b | V10a | 18/11 17:00 → 19/11 15:00 |
| A3 | 16 | 20 | A0b, A7b, A9, T1b | V10a | 18/11 17:00 → 19/11 13:00 |
| A4b | 16 | 20 | A0b, A4a, A7b, A9, T1b | V10a | 19/11 09:00 → 20/11 05:00 |
| A5b | 10 | 14 | A0b, A5a, A7b, A9, A2 | V10a | 20/11 05:00 → 20/11 19:00 |
| A6b | 14 | 18 | A0b, A6a, A7b, A9, A11, T1b | V10a | 19/11 13:00 → 20/11 07:00 |
| A8a | 16 | 20 | A0b, A7b, A9, C6a | V10a | 19/11 05:00 → 20/11 01:00 |
| A8b | 20 | 24 | A8a | V10a | 20/11 01:00 → 21/11 01:00 |
| A14 | 8 | 12 | A0a, A2, A3, A4b, A6b | V10a | 20/11 07:00 → 20/11 19:00 |
| T3 | 10 | 14 | T1a, T1b, T1c, A2, A3, A4b | V10a | 20/11 11:00 → 21/11 01:00 |
| A10a | 16 | 20 | A1a, A1d, A2, A3, A4b, A5b, A6b, A7b, A8a, A8b, A9, A11, T1a, T1b, A14, C7a | V10a | 21/11 01:00 → 21/11 21:00 |
| A10b | 16 | 20 | A10a, T3 | V10a | 21/11 21:00 → **22/11 17:00** |
| A15, A1c | 10, 4 | 14, 8 | M-APP; A1b | owner GO | after the GO |
| A16, C6c | 4, 4 | 8, 8 | A15, A1c; A15, immo's cutover, C6b | — | after the cutovers |

The standing dependencies of section 6.1 are merged before V10a and are written only where they bind (A0b, A7b, A5a, A6a). The evidence of section 5.4 and decision D8 are checked by s-conductor before A0b, A7b, T1b, C2a and C2b start.

Changes of the graph against revision 1, each with its reason:

- A0b now waits for T1a (it renders `/neutral` through it) and for C1 (the root layout and the header read `chatWidgetLayout`: `+layout.svelte:23`, `Header.svelte:12`).
- A7b no longer waits for A0b: its gate runs on the harness entry of A0a, which needs neither the shell nor the router.
- T2 waits for C1 (content wrapper on the neutral generator). A5a and A6a wait for AE1a (their fixtures are recorded with its recorder). A5b waits for A2 (its spec starts on the folders page).

Changes of the graph against revision 2, each read from the imports of section 6.12:

- C2 becomes C2a (elements) and C2b (the two cross-batch compositions, after C2a and C4); C7a waits for the four Vue lots.
- A9 waits for C2a and delivers the application adapter of `StreamMessage`; A2 and A3 take it from A9 and no longer name a chat batch.
- A4b waits for A9 (lock badge and lock module). A8a waits for A9 and A7b (document source menu, editable field).
- A14 waits for A2, A3, A4b and A6b: the sequencing choice of revision 2, now written as a dependency.
- Hours: A0a 22, A9 16, C1 24, C3 14; the published times follow.

Changes of the graph against revision 4, each read from the imports between packages of section 6.12:

- A1a is split into A1d (the `auth-ui` package) and A1a (the routes). A11 waits for A1d: two of its screens import `auth-ui` components. In revision 4 `auth-ui` was in A1a, which waited for A11; with that import the graph held the cycle A11 → A1a → A11.
- A1a waits for A1d and A11. A1b waits for A1d instead of A1a: its pages import `auth-ui` components and no application route. A10a names A1d.
- Hours: A1d 18, A11 16, A1a 2 (section 6.7); the published times follow.

Before V10a (13 lots, all merged by 15/11 18:00, 21 h before V10a):

| Slot | Sequence (start → merged) |
|---|---|
| 1 | C0 13/11 08:00 → 13/11 22:00 · C1 → 15/11 02:00 · T2 → 15/11 18:00 |
| 2 | AE1a 13/11 08:00 → 14/11 00:00 · AE1b → 14/11 18:00 · A6a → 15/11 08:00 |
| 3 | A0a 13/11 08:00 → 14/11 10:00 · A4a → 15/11 02:00 · A7a → 15/11 12:00 |
| 4 | AE2a 13/11 08:00 → 13/11 18:00 · T0 → 14/11 08:00 · AE2b 14/11 10:00 → 14/11 20:00 · A5a → 15/11 08:00 |

From V10a to M-APP (26 lots, and A1b at the end of slot 4):

| Slot | Sequence (start → merged) |
|---|---|
| 1 | C2a 16/11 15:00 → 17/11 17:00 · C2b → 18/11 07:00 · C7a → 18/11 19:00 · C6a → 19/11 05:00 · A8a → 20/11 01:00 · A8b → 21/11 01:00 · A10a → 21/11 21:00 · A10b → **22/11 17:00** |
| 2 | C4 16/11 15:00 → 17/11 09:00 · A7b → 17/11 23:00 · T1b → 18/11 17:00 · A2 → 19/11 15:00 · T1c → 20/11 11:00 · T3 → 21/11 01:00 |
| 3 | T1a 16/11 15:00 → 17/11 01:00 · A0b → 17/11 17:00 · A9 → 18/11 13:00 · A3 18/11 17:00 → 19/11 13:00 · A6b → 20/11 07:00 · A14 → 20/11 19:00 |
| 4 | C3 16/11 15:00 → 17/11 09:00 · A1d → 18/11 07:00 · A11 → 19/11 03:00 · A1a → 19/11 09:00 · A4b → 20/11 05:00 · A5b → 20/11 19:00 · A1b → 21/11 07:00 |

Choice made in this sequence [JUGEMENT]: the chat chain keeps slot 1; at 17/11 01:00 the free slot goes to A0b, and A7b and A1d take the slots that C4 and C3 free at 17/11 09:00. With the chat chain 12 h longer than in revision 2, the page chain no longer limits M-APP, so the first route does not have to wait. The authentication chain (A1d, A11, A1a: 48 elapsed hours) holds slot 4 until 19/11 09:00: the dashboard page A4b starts 16 h later than in revision 4 and the matrix page A5b follows it in that slot, while the print layer T1c takes the slot that A2 frees. The sequences of revision 4 with A1d inserted before A11, run with the same rule — T1c after A4b in slot 4, T3 after A6b in slot 3 — also end on 22/11 17:00, with 6 h instead of 20 h before A10b.

With a fifth branch from V10a (decision D5), same graph and same rule:

| Slot | Sequence (start → merged) |
|---|---|
| 1 | as above, A10b → **22/11 17:00** |
| 2 | C4 16/11 15:00 → 17/11 09:00 · A1d → 18/11 07:00 · A11 → 19/11 03:00 · A6b → 19/11 21:00 · A14 → 20/11 09:00 |
| 3 | T1a 16/11 15:00 → 17/11 01:00 · A0b → 17/11 17:00 · A9 → 18/11 13:00 · A2 → 19/11 11:00 · A5b → 20/11 01:00 |
| 4 | C3 16/11 15:00 → 17/11 09:00 · T1c 17/11 23:00 → 18/11 19:00 · A4b → 19/11 15:00 · T3 → 20/11 05:00 |
| 5 | A7b 16/11 15:00 → 17/11 05:00 · T1b → 17/11 23:00 · A3 18/11 13:00 → 19/11 09:00 · A1a → 19/11 15:00 · A1b → 20/11 03:00 |

Choice made in this sequence [JUGEMENT]: six lots are ready at V10a for five slots. The fifth branch still starts A7b at V10a, as an early witness of the editor (risk R19), and the authentication chain starts when C4 frees its slot, as with four branches. Giving the fifth slot to A1d instead leaves 20 h before A10a instead of 16 h, and returns A7b and T1b to their four-branch times.

### 6.9 Critical path and earliest times

**Critical path:** `V10a → C2a (22+4) → C2b (10+4) → C7a (8+4) → C6a (6+4) → A8a (16+4) → A8b (20+4) → A10a (16+4) → A10b (16+4)` = 146 h after V10a, 12 h more than in revision 2: the compositions of the chat panel cannot be validated before their elements (section 6.5).

Other chains, for comparison (elapsed hours after V10a, on the graph alone, without any slot limit): the page lots end 68 h after V10a (`T1a 10 → A0b 16`, then A9 after A0b and C2a at 26, `A9 20 → A2 22`), the matrix page 82 h after (A5b follows A2), the promotion 80 h after (A14 follows A2), the templater and print acceptance 82 h after (`A7b 14 → T1b 18 → T1c 20`, then `T3 14` after A2), the authentication chain 48 h after (`A1d 22 → A11 20 → A1a 6`). A10a cannot start before 106 h (end of A8b) and A10b before 126 h. The graph therefore leaves 24 h of slack before A10a (the matrix page is the last) and 44 h before A10b (T3); the four branch slots reduce it to the figures below.

| Milestone | Earliest time (Montréal) | Condition |
|---|---|---|
| Consumer-required list version 2 and gap requests delivered to the DS (AE2a) | 13/11 18:00 | — |
| Chat gap audit, with the recomputed hours of the Vue lots C2a, C2b, C3 and C4 (C0) | 13/11 22:00 | — |
| Parity instrument merged, first-route scenario green on the reference (AE1a) | 14/11 00:00 | — |
| Templater contracts (T0) | 14/11 08:00 | — |
| Scaffold merged, candidate roots registered in the repository tooling (A0a) | 14/11 10:00 | — |
| Reference suite with the print reference (AE1b); 100 % DS instrument (AE2b) | 14/11 18:00; 14/11 20:00 | — |
| Neutral streaming core, content stylesheet and Vue entry scaffold of chat-ui (C1) | 15/11 02:00 | — |
| All work that does not need the DS merged | 15/11 18:00 | four branches |
| V10a | 16/11 15:00 | DS; day 0 = 14/11 08:00 |
| Family (a) of the templater in Vue (T1a) | 17/11 01:00 | V10a |
| **First real route at parity, `/neutral` (A0b)** | **17/11 17:00** | V10a, L1.7 |
| Elements of the chat views merged (C2a, C3, C4) | 17/11 17:00 | V10a |
| Editable field (A7b) | 17/11 23:00 | V10a, decision D8; 17/11 05:00 with a fifth branch |
| Compositions of the chat panel merged (C2b) | 18/11 07:00 | — |
| `auth-ui` in Vue, with its chain (A1d) | 18/11 07:00 | V10a; its version published before A11 runs its consumers |
| Shared components and adapters (A9) | 18/11 13:00 | — |
| Renderers of the templater merged (T1b) | 18/11 17:00 | 17/11 23:00 with a fifth branch |
| Screens of `cluster-mesh` and viewer in Vue (A11); authentication routes (A1a) | 19/11 03:00; 19/11 09:00 | A1d |
| chat-ui Vue packaged (C6a) | 19/11 05:00 | — |
| Print layer merged (T1c) | 20/11 11:00 | 18/11 19:00 with a fifth branch |
| Pages ported and promotion done (A5b, A14) | 20/11 19:00 | 20/11 01:00 and 20/11 09:00 with a fifth branch |
| Templater and print accepted (T3) | 21/11 01:00 | 20/11 05:00 with a fifth branch |
| Every screen ported (A8b, the chat hosts) | 21/11 01:00 | — |
| **M-APP: candidate accepted on both entries (A10b)** | **22/11 17:00** | plus the owner's approval of the visual-difference list and of the exception register |
| Cutover of the application (A15); of the identity-provider front (A1c) | owner GO + 14 h; owner GO + 8 h | rollback rehearsals included; the A15 branch is prepared and green before the GO |

What the figures do and do not contain:

- **Provisional estimates.** Every hour is an estimate until A0b records the porting rate and C0 recomputes the Vue lots C2a, C2b, C3 and C4 (section 6.7). The table of section 6.8 is recomputed with the same rule after each of the two.
- **Slack with four slots.** Before A10a starts (21/11 01:00): 6 h for the promotion A14 and for the matrix page A5b, 18 h for the settings pages A6b. The 6 h of A5b are those of the whole of slot 4, from A1d to A5b. Before A10b starts (21/11 21:00): 20 h for T3. The chat chain has none. A slip of a lot beyond its slack moves M-APP hour for hour.
- **The DS dates drive everything after V10a**: one hour of slip on day 0 or on V10a is one hour on M-APP.
- **A fifth branch** from 16/11 15:00 to 20/11 (table of section 6.8) raises the slack before A10a from 6 h to 16 h (the promotion A14, behind A11 and A6b) and the slack of T3 from 20 h to 40 h. The graph alone leaves 24 h and 44 h; five slots no longer reach them, because six lots are ready at V10a. It changes neither the first route nor M-APP, because the chat chain is the critical path.
- **To bring M-APP earlier** the chat chain must shorten: A8a can start on the merged compositions of C2b (the application consumes the package by a `file:` link, `ui/package.json:72`) instead of waiting for C6a. On the graph alone M-APP then comes on 22/11 01:00, 16 h earlier, at the price of up to eight simultaneous branches and of starting the host before the package acceptance C7a [JUGEMENT: not recommended].
- Not contained: the duration of G0 on the DS side, the owner's decisions, approval and GO, reviewer and conductor availability per day, the recomputation of the Vue lots C2a, C2b, C3 and C4 after C0, the DS side of the gap requests.

### 6.10 Preact second pass (reference only)

[FAIT] Figures of the DS plan.

Not planned here. The DS plan keeps it mandatory after the Vue milestones (`PLAN.md:179`, `:721-725`, `:742-746`, `:760-761`): A12a-d 84 h and A13 18 h (after M-APP, A14, the DS Preact release P8, C6b, T6); C5a-c 30 h, C7b 6 h, C6b 4 h; T5 10 h, T6 4 h. Total 156 h. Every non-view module written by this plan lives in `ui-shared/` so that this pass ports views only.

### 6.11 End-to-end files per lot (version 1)

[FAIT] for the route strings found in each spec file; [JUGEMENT] for the owner lots.

Method: for each of the 61 spec files, the application routes named in the file once the API paths (`/api/v1/…`) are removed, and the use of the chat widget, give the surfaces it visits. The surfaces give the owner lots: landing A0b, authentication A1a, folders and organizations A2, initiative A3, dashboard A4b, matrix A5b, settings A6b, chat A8b. Every spec that opens a page also needs the shell of A0b. AE1b replaces this map by the recorded one (URLs and regions actually visited); a spec can then move to another lot, never out of the list.

| Owner-lot set | Spec files under `e2e/tests` | Enters the manifest with (schedule of section 6.8) |
|---|---|---|
| none: no application page | `02-auth-oauth-wellknown`, `02-auth-s2s-client-credentials`, `08-xlsx-multisheet-query`, `10-cluster-mesh-control-plane` | A0b |
| A0b | `01-shell-neutral` (new, AE1a) | A0b |
| A1a | `02-auth-devices`, `02-auth-oauth-authorization-code`, `02-auth-oauth-revoke`, `02-auth-routes` | A1a |
| A4b | `03-dashboard`, `03-prioritization-matrix`, `05-executive-summary`, `06-streams` | A4b |
| A1a, A4b | `02-auth-simple`, `02-auth-webauthn`, `02-auth-workflow` | A4b |
| A2 | `01-organizations-detail`, `02-organizations`, `04-documents-ui-actions`, `04-dossiers-reload-draft`, `05-error-handling`, `05-folder-new-multi-org`, `07-import-export`, `08-document-summary-formats`, `08-documents-summary` | A2 |
| A2, A4b | `01-app` | A2 |
| A3 | gate-page spec (new, AE1b) | A3 |
| A2, A3 | `05-folders`, `06-usecase` | A2 or A3, the later |
| A2, A3, A4b | `07-workflow` | A2 or A3, the later |
| A6b | `01-admin-users`, `06-settings`, `06-settings-codex-provider` | A6b |
| A1a, A2, A6b | `04-google-drive-settings-documents` | A6b |
| A2, A5b | `07-matrix` | A5b |
| A2, A4b, A5b | `05-i18n` | A5b |
| A8b, A2 | `03-chat-chrome-extension-auth`, `03-chat-chrome-extension`\*, `03-chat-mobile-docked-nav`, `04-chat-image-paste`, `08-chat-checkpoint-restore`, `08-chat-context-chips`, `08-chat-heavy`, `08-pptx-org-generation`, `09-chat-freeze-terminal`, `09-chat-multitool-demo`\*, `09-chat-org-update-tool`\*, `09-run-steering-core`, `09-todo-runtime-panel-actions` | A8b |
| A8b, A3 | `05-usecase-detail` | A8b |
| A8b, A2, A3 | `03-chat`\*, `07_comment_assistant`\* | A8b |
| A8b, A2, A6b | `08-chat-workspace-switch` | A8b |
| A8b, A2, A3, A6b | `00-access-control`, `04-tenancy-workspaces` | A8b |
| A8b, A1a, A2, A6b | `04-google-drive-composer` | A8b |
| A8b, A0b, A1a, A2 | `06-tooling-visual-parity` | A8b |
| A8b, A0b, A1a, A2, A3 | `00-ai-generation`\* | A8b |
| own lanes | `vscode/01-vscode-chat-streaming` (A8b; VS Code lane); `a4/identity-cutover` (A1a, A6b; lane `unknown`); `dev/00-record-auth`, `dev/01-google-drive-live-readiness`, `dev/page-screenshot-proof` (dev configuration only) | their lanes |

- \* = on the AI allowlist, non-blocking (`rules/testing.md:42`).
- Count: the 56 numbered specs of today (4 + 4 + 4 + 3 + 9 + 1 + 2 + 1 + 3 + 1 + 1 + 1 + 22), 2 reference specs added by AE1a and AE1b, 5 specs in their own lanes.
- No existing spec is complete with A0b alone; 22 of the 56 are complete only with the chat widget. The lot gates of sections 6.2 and 6.3 name the files of this table.
- The harness specs under `e2e/tests/harness/` are candidate-only; each is named in the table of the lot that creates it.

### 6.12 Component imports across lots (version 1)

[FAIT] for the imports; [JUGEMENT] for the lots.

Method: the 108 imports of a `.svelte` file found in `ui/src` and in the two extension entries (`git grep` for `from '….svelte'`), plus the imports of the four Svelte-bound modules of section 2.4. Each import is mapped to the lot of the importing file and to the lot that delivers the imported component (sections 2.1, 2.2, 6.5). An import inside one lot needs no dependency. The table lists every import that crosses a lot boundary, grouped by provider. File names are under `ui/src/lib/components` or `ui/src/routes` unless a path is given.

| Provider (lot) | Imported by (lot) | Evidence | Dependency (section 6.8) |
|---|---|---|---|
| chat-ui `StreamMessage` (C2a) | application adapter `StreamMessage` (A9) | `StreamMessage.svelte:2` | A9 → C2a |
| application adapter `StreamMessage` (A9) | `QueueMonitor` (A9, same lot); `/folders`, `/folders/[id]`, `/organizations` (A2); `/initiative/[id]` (A3) | `QueueMonitor.svelte:17`; `folders/+page.svelte:10`, `folders/[id]/+page.svelte:24`, `organizations/+page.svelte:11`; `initiative/[id]/+page.svelte:16` | A2 → A9, A3 → A9 |
| lock badge and lock module (A9) | dashboard (A4b); `/folders/[id]`, `/organizations/[id]` (A2); `/initiative/[id]` (A3); matrix (A5b) | `dashboard/+page.svelte:22`, `:38`; `folders/[id]/+page.svelte:28`, `:36`; `organizations/[id]/+page.svelte:23`, `:28`; `initiative/[id]/+page.svelte:17`, `:22`; `matrix/+page.svelte:17`, `:23` | A4b → A9; A2, A3, A5b → A9 |
| `ImportExportDialog`, `DocumentsBlock` (A9) | pages of A2, A3, A5b; `WorkspaceSettingsPanel` (A6b) | for example `folders/+page.svelte:12`, `initiative/[id]/+page.svelte:19`, `:26`, `matrix/+page.svelte:26`, `WorkspaceSettingsPanel.svelte:14` | A2, A3, A5b, A6b → A9 |
| `DocumentSourceMenu` (A9) | `AppChatPanel` (A8a) | `chat/AppChatPanel.svelte:36` | A8a → A9 |
| `QueueMonitor` (A9) | `ChatWidget` (A8b) | `ChatWidget.svelte:94` | A8b → A8a → A9 |
| editable field (A7b) | `AppChatPanel` (A8a); `TemplateRenderer`, `ScoreTable` (T1b); `InitiativeDetail` (A3); `OrganizationForm`, `/folders/[id]`, `/folder/new` (A2); dashboard (A4b); matrix (A5b); `WorkspaceSettingsPanel` (A6b) | `chat/AppChatPanel.svelte:35`; `TemplateRenderer.svelte:6`, `ScoreTable.svelte:4`; `InitiativeDetail.svelte:6`; `OrganizationForm.svelte:2`, `folders/[id]/+page.svelte:34`, `folder/new/+page.svelte:12`; `dashboard/+page.svelte:18`; `matrix/+page.svelte:14`; `WorkspaceSettingsPanel.svelte:12` | A8a → A7b; T1b, A2, A3, A4b, A5b, A6b → A7b |
| templater family (b): `TemplateRenderer`, `CommentBadge`, `ViewTemplateCatalog` (T1b) | `InitiativeDetail` (A3); `OrganizationForm` and pages (A2); dashboard (A4b); settings (A6b) | `InitiativeDetail.svelte:7-8`; `OrganizationForm.svelte:3-4`, `organizations/[id]/+page.svelte:22`; `dashboard/+page.svelte:13`, `:15`; `settings/+page.svelte:62` | A2, A3, A4b, A6b → T1b |
| templater family (a) and `FileMenu` (T1a) | `/neutral` (A0b); pages of A2, A3, A4b, A5b; `WorkspaceSettingsPanel` (A6b) | `neutral/+page.svelte:14`; for example `folders/+page.svelte:11`, `dashboard/+page.svelte:19`, `matrix/+page.svelte:25`, `WorkspaceSettingsPanel.svelte:13` | A0b → T1a; the others through A0b |
| `WorkspaceCreateDialog` (A0b) | `WorkspaceSettingsPanel` (A6b) | `WorkspaceSettingsPanel.svelte:16` | A6b → A0b |
| `cluster-mesh` screens (A11) | login and register pages (A1a); `AdminUsersPanel`, `WorkspaceSettingsPanel`, memberships page (A6b) | `auth/login/+page.svelte:5`, `auth/register/+page.svelte:5`; `AdminUsersPanel.svelte:3`, `WorkspaceSettingsPanel.svelte:3`, `settings/memberships/+page.svelte:3` | A1a → A11, A6b → A11 |
| chat-ui views of the four Vue lots | `AppChatPanel`, `ChatPanel` (A8a); `ChatWidget` (A8b) | `chat/AppChatPanel.svelte:29`, `:34`, `:95`; `ChatPanel.svelte:5`; `ChatWidget.svelte:68-76` | A8a → C6a → C7a → C2a, C2b, C3, C4 |
| chat hosts: `AppChatPanel`, `ChatPanel` (A8a), then `ChatWidget` (A8b) | `ChatWidget` (A8b); root layout (A0b); the two extension entries (A8b) | `ChatPanel.svelte:6`, `ChatWidget.svelte:95`; `+layout.svelte:12`; `ui/chrome-ext/chatwidget-entry.ts:7`, `ui/vscode-ext/webview-entry.ts:3` | A8b → A8a; for A0b, a pending entry until A8b (section 4.3.1) |
| chat-ui store `chatWidgetLayout` (C1) | root layout, `Header` (A0b) | `+layout.svelte:23`, `Header.svelte:12` | A0b → C1 |

Imports between packages [FAIT for the imports: `git grep` for `from '@sentropic/…'` in the sources of the six packages that declare a `svelte` peer (section 6.14), of `apps/auth-idp/web` and of the other packages, design-system packages apart; JUGEMENT for the lots]. Revisions 1 to 4 read the imports of the application only. An import from one package to another orders their lots in the same way.

| Provider (lot) | Imported by (lot) | Evidence | Dependency (section 6.8) |
|---|---|---|---|
| `auth-ui` components `AuthLogin`, `AuthRegister`, and its types (A1d) | `cluster-mesh` screens `LoginScreen`, `RegistrationScreen`, and module `auth-flow` (A11) | `packages/cluster-mesh/ui/LoginScreen.svelte:2`, `RegistrationScreen.svelte:2`, `auth-flow.ts:1`; optional peer, `packages/cluster-mesh/package.json:263` | A11 → A1d |
| `auth-ui` components and OAuth client (A1d) | the five authentication pages that do not go through a `cluster-mesh` screen (A1a) | `auth/devices/+page.svelte:4`, `auth/devices/pair/+page.svelte:5`, `auth/magic-link/verify/+page.svelte:5`, `auth/oauth/callback/+page.svelte:3`, `auth/oauth/consent/+page.svelte:4` | A1a → A1d |
| `auth-ui` components and types (A1d) | four pages and two transports of the identity-provider front (A1b) | `apps/auth-idp/web/src/routes/auth/login/+page.svelte:3`, `register/+page.svelte:3`, `magic-link/verify/+page.svelte:4`, `oauth/consent/+page.svelte:4`; `src/lib/auth-transport.ts:7`, `oauth-transport.ts:1` | A1b → A1d |
| `chat-core` and `chat-ui` modules, in both directions | `chat-ui` views and stores; `chat-core` runtime | 27 files of `packages/chat-ui/src` import `chat-core`; 15 files of `packages/chat-core/src` import `chat-ui` (for example `runtime/comments/host.ts:13`) | none: C1 edits both packages, before the Vue lots |
| `cowork-bridge` (A0a), `chat-core` (C1) | `cowork-desktop`: 12 files import `cowork-bridge`, one imports `chat-core` | for example `packages/cowork-desktop/src/runner/cowork-runner.ts` | none: no lot edits `cowork-desktop`; A0a and C1 add exports and remove none |

No other import between packages exists: `auth-ui`, `cited-source-viewer` and `cowork-bridge` import no `@sentropic` package besides the design system, and no package imports `cited-source-viewer` or the `cluster-mesh` screens.

Result of the check:

- Four dependencies were missing in revision 2: A9 on the lot that delivers chat-ui `StreamMessage`, with the adapter itself assigned to a later lot (finding R2-1); A4b on A9; A8a on A9; A8a on A7b. One was misdirected: A2 and A3 named the chat batch instead of the lot that delivers the adapter.
- Inside `packages/chat-ui`, the only imports that cross a lot boundary are those of the two compositions of C2b (section 6.5).
- With these corrections, every row above points from a later lot to an earlier one in the order of section 6.8; the root layout is the one declared exception, handled by the pending list.
- One dependency between packages was missing in revision 4 (finding R4-1): A11 on the lot that delivers the `auth-ui` components. That lot was A1a, which itself waited for A11: a cycle. With `auth-ui` split out as A1d, every row of the second table also points from a later lot to an earlier one: A1d, then A11, then A1a; A1b after A1d.
- AE2a re-runs the extraction when it builds the coverage manifest and records version 2; a lot that adds an import across lots adds the dependency first (section 6.1).

### 6.13 Repository tooling bound to the `ui` root (version 1)

[FAIT] for the readers (`git grep` on `origin/main`, outside `ui/`, documents and lock snapshots); [JUGEMENT] for the changes and their lots.

Kinds of reader: **F** fails when the root changes; **S** skips silently, so that coverage is lost without a red check; **P** is a path constant to re-point. The compose service, the image, the inventory key and the CI filter keep the name `ui` (section 3.2): the tools bound to the name only — `scripts/ci/publish-image.mjs:14`, `image-receipt.mjs:43`, `check-preprod-images.mjs:7`, `ci-dag.mjs:19`, `scripts/security/daily/qualify-current.mjs:15` — do not change.

| Reader | Evidence | Kind | A0a: candidate roots added | A14: files moved | A15: `ui/` removed |
|---|---|---|---|---|---|
| Root npm workspace | `package.json:6` | F | none: `ui-vue` is not a workspace | — | `ui` removed from the list; root lockfile regenerated (`make lock-root`, `Makefile:614`) |
| API image | `api/Dockerfile:497` copies `ui/package.json`; `Makefile:86` hashes it into `API_VERSION`; `scripts/test-api-image-canonical.sh:160`, `:202`, `:295` require it; the CI filter `api` lists it (`.github/workflows/ci.yml:437`) | F | none | — | the copy, the hash input, the three assertions and the filter entry removed; API image rebuilt and re-pinned; `make test-ci-api-image-canonical` green |
| UI image tag | `scripts/ci/ui-image-version.sh:6-8` hashes `ui` and `packages`; its test names four files under `ui/` (`ui-image-version.test.sh:10-26`) | S | the candidate tag hashes `ui-vue`, `ui-shared` and `packages`; test extended | `ui-shared` added to the inputs of the Svelte tag | `ui` removed from the inputs; test files re-pointed |
| UI image build | `Makefile:840`, `:855`, `:868` (`-f ui/Dockerfile`); `docker-compose.yml:75`, `docker-compose.dev.yml:107`; inventory image `ui-production` (`.security/security-fix.json:19`) | P | `UI_TARGET=vue` builds `ui-vue/Dockerfile`; a second inventory image for the candidate | the Svelte image build copies `ui-shared/` | the `ui` service, the targets and the inventory image point at `ui-vue/Dockerfile`; the candidate entries merge into them |
| CI change classifier | `scripts/ci/compatibility-classifier.mjs:32`, `:39`: only `ui/` is the area `ui`; a file of another root is `unknown` (`:41`, `:129-132`), which selects the full blocking lane (`scripts/ci/consumer-boundaries.json:98`); tests `compatibility-classifier.test.mjs:186`, `:198` | S | `ui-vue/` and `ui-shared/` are the area `ui`, `ui-vue/Dockerfile` is `toolchain`; tests added | — | the `ui/` rules removed; tests re-pointed |
| CI filter and wiring test | filter `ui` (`.github/workflows/ci.yml:491-511`, `ui/**` at `:501`), read by the conditions of 20 jobs; `scripts/ci/publishable-ci-wiring.test.mjs:839`, `:867`, `:881`, `:903-909` read `ui/package.json` and the `ui` application tuple | F | the filter covers the two new roots; candidate jobs added; the test covers both manifests | — | filter and jobs on the new roots only; the test reads `ui-vue/package.json` |
| Lockfile-install scanner | `scripts/ci/ci-lockfile-installs.mjs:55` (list of roots), `:43` (returns on a missing path); policy in `.security/ci-lockfile-policy.json` and `.security/ci-lockfile-installs.mk`; install targets `Makefile:325-328` | S | `ui-vue` and `ui-shared` in the list; lock and install targets of the candidate under the policy | — | `ui` removed from the list; the Svelte targets removed |
| Security inventory | `scripts/security/daily/inventory.mjs:8` (required locks), `:100` (source trees); `schema.mjs:176`; `.security/security-fix.json:23`, `:27-28` (locks, SAST roots, source trees); tests `inventory.test.mjs:36-43`, `:141`, `scan.test.mjs:146-267`, `schema.test.mjs:94-161` | F | `ui-vue/package-lock.json`, `ui-vue/src` and `ui-shared` added beside `ui`; tests extended | — | the `ui` entries removed; test fixtures re-pointed |
| SCA gate | audits every tracked lockfile (`scripts/security/sca-gate.mjs:25`); its test pins the covered set, `ui` included (`sca-gate.test.mjs:115-116`) | F | `ui-vue` added to the pinned set | — | `ui` removed from the pinned set |
| API import audit | `api/tests/unit/identity/cm-root-import-audit.test.ts:18-20` scans `ui/src` and `ui/tests` and drops a missing root; its file pattern has no `.vue` (`:22`) | S | `ui-vue/src`, `ui-shared` and `.vue` added | — | the `ui` roots removed |
| chat-ui tests | `packages/chat-ui/tests/fixtures/production-widget-snippets.ts:11` reads `ui/src/lib/components/ChatWidget.svelte` and is loaded by `vitest.dom.config.ts`; `tests/reference-validation.spec.ts:53` reads `ui/src` when present, against `chat-ui-reference-validation.json` | F, S | — | — | the snippets read from the Svelte host are frozen as a committed fixture (the Svelte views of the package stay until C6c); the reference validation is re-pointed at the Vue host of A8b; `make test-chat-ui-dom` green |
| chat-ui theme generator | `packages/chat-ui/scripts/gen-theme-css.mjs:43` resolves its modules through `ui/package.json`; no test runs it (`tests/theme-css.spec.ts:5`, `:114` name it only) | P | — | — | the generated `./theme.css` is frozen until C6c removes it with the script; recorded in the package README |
| Extension and desktop artefacts | `Makefile:355-373` (`ui/chrome-ext/dist`, `ui/static/vscode-extension`); `Makefile:849`, `:2551` and `packages/cowork-desktop/packaging/package-windows.mjs:39` (`ui/static/cowork-desktop`); API default `ui/chrome-ext` (`api/src/routes/namespaces/clients-product-chrome.ts:7`; test `api/tests/api/chrome-extension-download.test.ts:92`) | P | — (A8b adds the candidate build targets) | packaging output and ignore rules follow the moved static assets | targets, packaging path and API default re-pointed |
| Ignore rules and counters | `.dockerignore:33-38`, `.gitignore:6-9`, `.graphifyignore:15-18`; test counters on `ui/tests` (`Makefile:254-265`) | P | build directories of the candidate added | — | the `ui/` entries removed; counters on the new test roots |

Rules [JUGEMENT]:

- **Scope.** Each non-empty cell is a `BRxx-EXn` exception of the lot of its column, requested from this table before the lot starts. A file outside the table stops the commit (section 6.1).
- **A0a registers, A15 removes, nothing is re-pointed in between.** From A0a to A15 both roots are classified, scanned, inventoried and built.
- **Witnesses of A0a**, part of its exit gate: a change confined to the new roots is classified `ui-only`; a seeded unlocked install under `ui-vue/` is reported by the scanner; a change of a candidate file changes the candidate image tag; the inventory fails without `ui-vue/package-lock.json`.
- **Removal check of A15.** The branch that deletes `ui/` carries every cell of its column. Before the GO it is green on the complete CI workflow with every job selected, and `git grep` finds paths under `ui/` only in dated documents and in the fixtures named below. The check is on the repository, not on the candidate build alone.
- **Not readers of the root** [FAIT]: fixtures that use `ui` as a sample workspace or path and read no file of the application — `api/tests/unit/artifacts-live/**`, `api/src/services/artifacts/live/**`, `packages/artifacts/tests/**`, `packages/harness/tests/branch-md/parse.spec.ts`, the lock snapshots under `tools/memory-mcp-l5/artifacts/` — and comments (`api/src/config/env.ts:213`, `deploy/k8s/overlays/preprod/patch-api-config.yaml:94-107`). They stay unchanged.
- **Version 1.** The table comes from one search. A0a re-runs it before its first commit and A15 before its branch is opened; a reader found later is added with its lot before it is edited.

### 6.14 Build and qualification chains of the UI packages (version 1)

[FAIT] for the chains, read at `c40b8d1b5`; [JUGEMENT] for the changes and their lots.

Scope [FAIT]: six packages declare a `svelte` peer — `chat-ui`, `chat-core`, `cowork-bridge`, `auth-ui`, `cluster-mesh`, `cited-source-viewer`. Four of them hold `.svelte` files (24 under `packages/chat-ui/src`, 9, 5 and 3 for the last three), as does the front `apps/auth-idp/web` (7); no file under `packages/` or `apps/` is a `.vue` file. As for chat-ui (section 6.5), a script added to a package manifest is run by nothing: each job calls make recipes, and each recipe installs a tool list of its own. The first table gives, for each of the seven, the chain that builds and qualifies it today, what this plan changes in it and the lot that owns the change; the second details the three packages that had no assigned chain work.

| Package | Chain today | Changed by this plan | Lot and exit gate |
|---|---|---|---|
| `chat-ui` | section 6.5, "CI chain" | three build outputs, archive path, Vue consumers | C1, C6a (section 6.5, unchanged) |
| `chat-core` | `build-chat-core` and `typecheck-chat-core` run `tsc` on `src/**/*.ts` without a tool list (`Makefile:2567`, `:2592`); `test-pkg-chat-core` runs the package script, whose locked list holds `svelte` (`packages/chat-core/scripts/test.sh:5`); `validate-chat-core` packs the dist-form archive and runs the generic install check, which imports every entry with two pinned peers (`.github/workflows/ci.yml:1543-1571`, peers at `:1565`) | one new store module and its entry. No recipe changes. The tests of the twin and the list of the test script are inside the package; a package that the twin imports is declared as a dependency, not as a peer, so the pinned peers do not move | C1: `validate-chat-core` green on the bumped version, the new entry in the import list of its report (gate and paths added in section 6.5) |
| `cowork-bridge` | `typecheck-cowork-bridge`, `test-cowork-bridge` and `build-cowork-bridge` run `tsc` and `vitest` with `svelte` in their lists (`Makefile:2294-2306`); `validate-cowork-bridge` has four steps and no consumer (`ci.yml:1286-1305`). The archive is src-form: every export targets a `.ts` source (`packages/cowork-bridge/package.json:14-40`). The generic install check cannot pass on it: such a target is `bundler-only`, and a package without a JavaScript root entry fails (`scripts/ci/qualify-published-install.mjs:19-21`, `:55`, `:406-407`) | neutral factories in `.ts`, `svelte` as an optional peer. `tsc` builds them: no recipe and no list changes | A0a: its gate named `make qualify-published-install`, which cannot pass; it now names the consumer that exists without Svelte, the candidate (gate corrected in section 6.2) |
| `auth-ui` | second table | Vue build, exports, candidate production, three packed consumers | A1d (section 6.3) |
| `cluster-mesh`, UI part | second table | dependency on `auth-ui` (peer range, version, pinned peer, packaging fixture); Vue build in the cold workspace, Vue pinned peers, UI lane | A1d for the dependency on `auth-ui`, A11 for the rest (section 6.3) |
| `cited-source-viewer` | second table | third build output, purity gate, three packed consumers | A11 (section 6.3) |
| `apps/auth-idp/web` (a front, not a package) | targets `lock-idp-web`, `install-idp-web`, `typecheck-idp-web`, `build-idp-web` (`Makefile:3412-3452`); jobs `idp-web-static` and `smoke-idp-screens` (`ci.yml:991`, `:2411`); it compiles the `auth-ui` sources through a `file:` link (`apps/auth-idp/web/package.json:30`) | a second front `web-vue/` with the same targets, then the switch | A1b, A1c: targets, jobs and gates already in their rows (sections 6.3, 6.4); A1b now waits for A1d |

| Link | Today [FAIT] | Change [JUGEMENT] | Lot |
|---|---|---|---|
| `auth-ui`: type-check and build | `typecheck-auth-ui` and `build-auth-ui` run `tsc` on `src/**/*.ts` with a list of four tools that holds no Vue tool (`Makefile:2204`, `:2209`; `packages/auth-ui/tsconfig.json:17-18`); no step compiles a component: the 9 `.svelte` files are shipped as sources (`packages/auth-ui/package.json:14-85`) | the type-check covers the Vue sources; one build target writes `dist/` as today, `dist/vue/` (classic) and `dist/vue/vapor/` (Vapor), compiled JavaScript with declarations; the lists gain the Vue toolchain on the exact pins (section 3.1) and the V10a pre-release of `@sentropic/design-system-vue`, as profiles added to `scripts/ci/tool-locks.json` with `make lock-ci-tools`; no existing profile is renewed | A1d |
| `auth-ui`: exports and pack | src-form archive; `pack-auth-ui` and `publish-auth-ui` pack after the build (`Makefile:2212-2216`); nothing checks the content of `dist/` | exports `./vue` and `./vue/vapor` in the committed manifest: compiled JavaScript for a registry consumer, the Vue sources for a consumer through a `file:` or workspace link (an export condition for sources, as the `svelte` condition is today: `package.json:17`), so that the candidate, the identity-provider front and the cold workspace need no prior build of the package; a prepack gate requires `dist/vue/index.js` and `dist/vue/vapor/index.js`; `vue` and `@sentropic/design-system-vue` added as optional peers, `svelte` and `@sentropic/design-system-svelte` become optional | A1d |
| `auth-ui`: second producer of its archive | `auth-ui` is in the candidate closure of `cluster-mesh`, which follows peer dependencies (`scripts/ci/publishable-manifests.mjs:14`; `scripts/ci/package-candidate.mjs:29-33`; `packages/cluster-mesh/package.json:263`): the job `package-candidates` compiles it with `tsc` alone and packs it (`package-candidate.mjs:86-93`; `ci.yml:1038-1039`), on the tools of the cold workspace, which hold no Vue tool (`packages/cluster-mesh/tests/storage/cold-workspace.sh:33-37`). A package of the closure cannot take the manifest transform of chat-ui: the guard refuses to pack it outside its own make target (`publishable-manifests.mjs:641-647`) | the candidate production runs the Vue build of a package that has one, after `tsc`, on a profile added to the tools of the cold workspace; the committed manifest is packed as it is. Witness: the prepack gate stops a candidate archive without the Vue outputs | A1d |
| `auth-ui`: consumers | none: `validate-auth-ui` runs type-check, test, build and pack (`ci.yml:1463-1482`). Its components are compiled only by two source consumers through `file:` links (`ui/package.json:70`; `apps/auth-idp/web/package.json:30`) | three packed consumers on the archive of the pack step, run by `validate-auth-ui` (`qualify-ui-package`, below) | A1d |
| `cluster-mesh`: dependency on `auth-ui` | `auth-ui` is at `0.9.1` and is an optional peer of `cluster-mesh` with the range `^0.9.0` (`packages/auth-ui/package.json:3`; `packages/cluster-mesh/package.json:263`, `:277`); the Vue exports are a feature, so their release is a minor (`rules/workflow.md:116`; `PLAN.md:948`), which that range excludes. `auth-ui` is in the candidate closure: a PR that changes it hands its archive to the legs of `validate-cluster-mesh` as a same-PR sibling (`scripts/ci/publishable-manifests.mjs:498-499`; `scripts/ci/package-candidate.mjs:99-107`, `:114-125`; `ci.yml:1148-1149`). The `install` leg rejects a sibling that a declared range excludes, an optional peer included, before any install (`scripts/ci/qualify-published-install.mjs:149-163`, called at `:348`, ahead of the optional-peer handling of `:349-352`). It also pins `@sentropic/auth-ui@0.9.0`: a pinned peer must be inside the range, and the sibling archive is installed only for exactly the pinned version — any other pinned version comes from the registry (`:412-415`, `:421-426`). That pin is one tuple, repeated in three steps — the candidate lane and the two post-publication steps (`Makefile:1314`; `ci.yml:3524`, `:3739`) — and held equal by the wiring test (`scripts/ci/publishable-ci-wiring.test.mjs:458`, `:464-471`). The `lazy` leg installs the `auth-ui` candidate beside the `cluster-mesh` candidate (`packages/cluster-mesh/tests/packaging/prepare.sh:116-119`, `:248`, `:257`, `:342`), and its suite requires the `selected` fixture and its lock to carry the version and the peer set of both workspace manifests (`tests/packaging/prepare-artifacts.spec.ts:47-51`, `:76-84`; `fixtures/selected/package.json:10`, `:21`) | in the PR of A1d, with its version bump of `auth-ui`: the range gains the new minor and keeps the 0.9 line — the union of `^0.9.0` and `^0.10.0` for `0.10.0` — since the Svelte exports that the screens import do not change (the manifest already writes such unions: `package.json:270`); `cluster-mesh` takes the next number of its development series, assigned by s-conductor with the lane (`package.json:3`; a consumer whose range changes is bumped: `rules/workflow.md:124`), and a pre-release version is not published (`ci.yml:3477-3483`), so the merge publishes `auth-ui` only; the pinned `auth-ui` moves to the new version in the three steps and in the constant of the wiring test, so that the `install` leg installs the archive of the PR; the `selected` fixture and its lock are aligned on both packages (the target `refresh-lazy-package-lock` rewrites the lock: `packages/cluster-mesh/packaging.mk:72-75`) and the root lockfile follows (`make lock-root`). Nothing else of `cluster-mesh` changes: no source, no export, no screen. The generic check is not changed; its own test already asserts the rejection of an excluded sibling (`scripts/ci/qualify-published-install.test.mjs:152`) | A1d |
| `cluster-mesh`: sources and build | the 5 screens and 3 `.ts` modules live under `ui/`, outside the compiled tree (`packages/cluster-mesh/tsconfig.json:16`), and are shipped as sources (`packages/cluster-mesh/package.json:15-38`, `:224`); `build-cluster-mesh` runs the action `build` of the cold workspace, `tsc` only (`Makefile:1285-1286`; `cold-workspace.sh:115-116`); that script is outside `packages/cluster-mesh/ui/**` | the actions `typecheck` and `build` cover the Vue screens: classic and Vapor outputs in the archive, exported as for `auth-ui`; `vue` and `@sentropic/design-system-vue` added as optional peers | A11 |
| `cluster-mesh`: archive qualified and published | not the output of `build-cluster-mesh`: with candidates present, `pack-cluster-mesh` skips the build (`Makefile:1418`); the seven legs of `validate-cluster-mesh` work on the candidates of `package-candidates` (`ci.yml:1117`, `:1126-1135`, `:1142-1147`), the lanes that install the package take its archive from them (`Makefile:1309-1310`), and the publication reuses it (`Makefile:1426`; `publishable-manifests.mjs:899-906`) | that archive carries the Vue outputs through the candidate build step of A1d; the package refuses to pack a tree without them | A11 |
| `cluster-mesh`: install lane | the generic check with ten pinned peers, `@sentropic/auth-ui@0.9.0` among them (`Makefile:1314`; pinned again in `scripts/ci/publishable-ci-wiring.test.mjs:458`); a pinned peer must be a declared peer inside its range (`qualify-published-install.mjs:410-414`); the check imports every JavaScript entry (`:442-449`) and skips the 8 UI entries as `bundler-only` | the Vue entries are JavaScript, so the lane imports them under Node: its pinned peers gain `vue` and `@sentropic/design-system-vue`, in the three steps of the tuple, and the wiring test follows; the range and the pin of `auth-ui` are those set by A1d (row "dependency on `auth-ui`") and need no further edit. The version and the peer set of `cluster-mesh` change with this lot, so its `selected` fixture is aligned again. The generic check is not changed | A11 |
| `cluster-mesh`: consumers | none for the screens: no leg compiles a `.svelte` file, and the package suite covers `ui/auth-flow.ts` only (`packages/cluster-mesh/tests/ui/auth-flow.spec.ts`) | three packed consumers on the candidate archive, as a UI lane of `ci-package-qualification` run by `validate-cluster-mesh` | A11 |
| `cited-source-viewer`: build and pack | `build-cited-source-viewer` runs `svelte-package` on a Svelte tool list (`Makefile:4692`); the archive is dist-form through a manifest transform (`Makefile:972`, `:4699`; `packages/cited-source-viewer/scripts/make-publish-pkgjson.mjs`); the pack recipe checks five Svelte outputs (`Makefile:4698`); the type-check list holds no Vue tool (`Makefile:4663`) | one build target, three outputs: the Svelte output unchanged, `dist/vue/` and `dist/vue/vapor/`; the transform maps the two Vue entries; the pack check also requires `dist/vue/index.js` and `dist/vue/vapor/index.js`; profiles added as for `auth-ui` | A11 |
| `cited-source-viewer`: purity gate | a package test allows three external imports, reads `.ts`, `.js` and `.svelte` files only, and pins the peer set to exactly `@sentropic/design-system-svelte`, `pdfjs-dist` and `svelte` (`packages/cited-source-viewer/tests/purity.spec.ts:42`, `:47-51`, `:105-109`): a Vue source is not read, and a Vue peer fails the test | the gate reads `.vue` files and allows `vue` and `@sentropic/design-system-vue`, in imports and in the peer set; its other conditions are unchanged. The change of that ratified surface is recorded in the package README | A11 |
| `cited-source-viewer`: consumers | none: `validate-cited-source-viewer` runs type-check, two test targets, build and pack (`ci.yml:1263-1284`) | three packed consumers on the archive of the pack step, run by that job | A11 |
| The three packages: retirement | — | the Svelte consumer, the Svelte outputs and the Svelte tools leave each chain with the Svelte exports; the Vue consumers stay | A16 |

`qualify-ui-package` [JUGEMENT; name to confirm with s-conductor], modelled on `qualify-chat-pair` and on the Vue qualification of chat-ui (section 6.5):

- **One target, three runtimes.** `make qualify-ui-package PACKAGE=<slug> RUNTIME=svelte|vue|vapor TARBALL=<archive>`, on the script `scripts/ci/qualify-ui-package.mjs`. A1d writes it with `auth-ui`; A11 adds the two other packages as consumer pages, which each package keeps in its own tree.
- **Install.** The archive, in a clean directory outside the repository, through the frozen consumer installer (`scripts/ci/locked-consumer.mjs`), every version from the committed catalogs (`scripts/ci/tool-locks.json`, `scripts/ci/consumer-locks.json`). Svelte: `svelte`, `@sentropic/design-system-svelte` and the Svelte toolchain. Vue: a locked `vue` 3.5.x for classic, the exact pin for Vapor, with `@sentropic/design-system-vue`, Vite, its Vue plugin and `vue-tsc`; the run fails if the install tree of a Vue consumer holds a Svelte package.
- **Build and run.** Type-check and production build of the consumer page, which imports every exported component from the entry of its runtime. The built page is opened in the qualified browser image of the end-to-end lane, as the identity-provider screen smoke does (`Makefile:3352-3364`); each component must render its accessible root without a page error. The job then waits for `build-e2e` and loads its image (`ci.yml:2415`, `:2446`); the image exists whenever these jobs run, because every package path is in the `ui` filter (`ci.yml:495`, `:930`).
- **Negative control**, in the same run: the archive with its Vapor entry removed fails the Vapor consumer.
- **Peers between packages.** A consumer of `cluster-mesh` installs `auth-ui` from the registry at the version published by A1d: `LoginScreen` and `RegistrationScreen` are mounted on the delivered Vue components, never on a stub.

Rules [JUGEMENT]:

- **Order.** A1d carries in its own PR what its version bump requires of `cluster-mesh` (row "dependency on `auth-ui`"): its qualification runs on the `auth-ui` archive of that PR, waits for no publication and closes before A11 starts. A1d merges and `publish-auth-ui` publishes its version (`ci.yml:3226-3247`) before A11 runs its consumers; s-conductor checks the published version when it releases A11. Until that version is visible on the registry, a branch of another lane that carries the new pin fetches it from there, since `auth-ui` is no sibling of that branch: its `install` leg waits about 180 s for a pinned peer (`qualify-published-install.mjs:416-437`; `rules/workflow.md:129`) and is re-run after the publication; the pin is not reverted. A1a starts on both merges.
- **Svelte until the retirement.** The existing Svelte suites stay in the three jobs, and the Svelte packed consumer, which none of the three packages has today, is added beside the two Vue ones. A16 removes it with the Svelte exports.
- **Same files as other lots.** `Makefile`, the workflow, the two catalogs and the wiring test are also edited by A0a, C1, the pin commit of the chat element lots, C6a, A1b and A8b, in disjoint regions: here the recipes of the three packages, their `validate-` jobs, the candidate production and the pinned peers of `cluster-mesh` in their three steps, which A1d edits and then A11. Merge order of section 6.8: A1d, then A11, then C6a; the later lot rebases.
- **Selection.** As for chat-ui (section 6.5), a change of `Makefile` or of the workflow sets the `global` filter, and a new tool profile moves both image tags. A change of `scripts/ci/package-candidate.mjs` also sets the `package_candidates` filter (`ci.yml:724-732`), which runs `package-candidates` and the three jobs that wait for it: `validate-llm-mesh`, `validate-llm-gateway` and `validate-cluster-mesh` (`ci.yml:1029`, `:1086-1087`, `:1117-1118`, `:1189-1190`).
- **Hours.** The chain work adds 6 h to A1d and 6 h to A11 (section 6.7); it is an assumption of section 9.3. The adaptation that revision 6 moves from A11 to A1d changes neither figure (section 9.3).
- **Version 1.** The tables come from one reading of the recipes and jobs at `c40b8d1b5`. A1d and A11 re-read their chain before their first commit; a link found later is added with its lot before it is edited.

---

## 7. Risks

Likelihood and effect are [JUGEMENT]; the evidence is cited.

| # | Risk | Likelihood | Effect | Mitigation and owner lot |
|---|---|---|---|---|
| R1 | **Vue 3.6 stays a release candidate**, or a regression of a release candidate reaches production (15 release candidates between 2026-07-18 and 2026-11-12, `vuejs/core` releases) | medium | production runs a pinned release candidate (owner decision AD7) | exact pins; each bump is a reviewed PR that re-runs both entries; the classic entry stays a build output of the same sources and can go to production only after its own full acceptance |
| R2 | **Vapor maturity for a large application**: the Vue team recommends Vapor for partial use or small new applications (section 3.1). Open points: recursive components, `v-html`, delegated events around third-party DOM (editor, chart, Google Picker), mounting inside an extension's host page | medium to high | a defect appears late in a 3,000-line host | early witnesses on both entries: A0b (first route), A7b (editor), T1b (recursion), A8b (extensions); authoring rule 4; a Vapor-only failure blocks the row, it is never worked around with the interop plugin |
| R3 | **chat-ui port larger than planned**: 7,052 host lines; 20 of 24 views depend on the host's Tailwind; the hours predate the 100 % DS requirement; the chain is the critical path, and its two compositions wait for their elements (12 h more than in revision 2) | high | M-APP slips hour for hour | C0 on 13/11 with recomputed hours the same day; C1 done before V10a; a batch above the 24 h cap is split before it starts; decision D5 |
| R4 | **DS readiness**: V10a later than assumed, a consumer-required row absent from V10a, or a gap of section 5.4 left open | medium to high | every date after V10a moves; a lot stops midway | list version 2 and the gap requests delivered on 13/11 18:00; 152 build hours independent of the DS; each gap of section 5.4 has a sentropic resolution with its evidence, inside a register closed at 4 + 4 entries; a missing component never becomes a local primitive |
| R5 | **Neutral router (L1.7) late or unfit** for cancellation and `returnUrl` | medium | A0b blocked, and all pages with it | the navigation policy is router-independent (A0a); fallback on the classic entry with `vue-router` behind the same interface, which cannot carry M-APP |
| R6 | **The reference moves** during the port (`ui/` receives changes daily) | high | stale baselines, unmirrored fixes | pin, freeze of features (decision D2), reference-change ledger, re-pin by s-conductor only |
| R7 | **Visual acceptance without a pixel gate**: a defect is filed as "intended", or the owner rejects the DS look late | medium | rework at A10b | G-API and G-SEM do not depend on the look; previews at three points (decision D4); DS gaps surfaced by AE2a, with their resolution, before any view is written |
| R8 | **Print**: the stylesheet is re-authored; two tests switch to print media, but there is no paged reference today | high | the executive report prints wrongly after the cutover | AE1b keeps the two tests and creates the paged reference first; T0 inventories the 441 selector lines; T1c is X grade; G-PRINT has page-level criteria; T3 precedes A10b; a long-content fixture exercises the compact rule (`TemplateRenderer.svelte:384`) |
| R9 | **Neutralised end-to-end suite**: a rewritten locator verifies less than before, or DS components break tag-based locators | medium | false green, or mass failures at the first candidate run | the neutralised suite must be green on Svelte before it is used; the 403 tag-based locators are reviewed in AE1b; the witness mutations of AE1a prove that the instrument can fail; A0b is the first real run |
| R10 | **Branch and review capacity**: 6 to 20 h of slack outside the chat chain; 27 lots through one conductor in the 146 h after V10a; the reviewer's PR-size limit is `unknown` | high | M-APP beyond 22/11 17:00 | decision D5; real reviewer and conductor availability from s-conductor before 16/11; small PRs; schedule recomputed from the graph after A0b and after C0 |
| R11 | **Scope exceptions** on `Makefile`, compose files, CI, the lockfile policy and the repository tooling of section 6.13 collide with other lanes | medium | A0a late, and it gates T2, A7a, A4a, A5a, A6a, T1a, A0b | exceptions requested before the start from the file list of section 6.13; the diff is limited to one `UI_TARGET` variable, one new image and two roots registered beside `ui`, and it re-points nothing before A15 |
| R12 | **Publication rule against pre-release peers**: an optional peer on a `next`-tagged DS pre-release must still be a plain semver range (`rules/workflow.md:124`) | medium | A1d, A11, C6a blocked at publication | the range form is settled with s-conductor before A1d, the first package lot with a DS Vue peer |
| R13 | **Extensions**: the VS Code host overrides are written against Tailwind classes (`ui/src/app.css:487-999`); the Chrome widget lives inside third-party pages | medium | A8b larger than 20 h | a DS-token mapping for the VS Code host is designed in A8a; isolation witness early in A8b |
| R14 | **Behaviour that no spec reaches** in large files (the gate page had no spec) | high | silent loss of behaviour | decomposition first; the recorded spec-to-surface map of AE1b lists unreached surfaces; lot scenarios and harness specs cover them on the reference first; C0 audits the chat hosts row by row |
| R15 | **Composites that are local primitives in disguise, or a register that grows until G-DS is green** | medium | "100 % DS" is claimed but not true on screen | rules DS-1 and DS-3 apply inside composites; a composite whose role a DS entry covers is an exception (EX-8); three figures instead of one; register closed at 4 + 4, a ninth entry needs an owner decision; the manifest is reviewed by the DS session; previews |
| R16 | **Rollback after A15** fails on browser state | low | broken sessions | G-STATE in both directions; rehearsal inside A15 before the GO |
| R17 | **A Vue 4 pre-release** appears during the port | `unknown` | a second migration overlaps | the authoring rules of section 3.1 are the Vue-4-ready rules; the DS standing lot L1.8 (`PLAN.md:564`) returns a plan before any lot is opened |
| R18 | **Generated HTML outside the reach of the lint**: six generators write Tailwind classes into strings (section 2.8) | high without a check | lists, headings and citation links lose their styling after the cutover while G-DS is green | one neutral generator and one wrapper (C1, T2); rule DS-7 on fixtures and on the rendered DOM, print media included (AE2b); the Svelte generators untouched until C6c and A15 |
| R19 | **The DS editor is a closed component**: no extension prop, its own document format (section 2.9) | medium to high | citation links inside the editor disappear; Markdown is rewritten on load and triggers saves | decision D8 before A7b; Markdown adapter with a round-trip corpus and a "no save without edit" gate (A7b); A7b starts at V10a as an early witness |
| R20 | **Lot gates that name specs the lot cannot run** (the defect of revision 1 on A0b, A2, A3, A5b, A8a) | medium | a lot cannot close, or closes on a weakened gate | owner-lot sets and candidate manifest (sections 4.3.1, 6.11); a lot scenario or a harness spec where no existing spec is complete; AE1b replaces the static map by the recorded one |
| R21 | **Repository tooling that reads the `ui` root** (section 6.13): some tools fail when the root changes (security inventory, SCA lock set, API image inputs), others skip silently — the install scanner returns on a missing path (`scripts/ci/ci-lockfile-installs.mjs:43`), the API import audit drops a missing root (`api/tests/unit/identity/cm-root-import-audit.test.ts:18-20`), and an unregistered path selects the full blocking lane (`scripts/ci/consumer-boundaries.json:98`) | medium to high | candidate code escapes the scanners, or every candidate PR runs the full lane; at A15 a check is red late, or green because it no longer looks | every reader listed with the lot that changes it; witnesses in the gate of A0a; the A15 branch green on the complete workflow before the GO, with a `git grep` for remaining `ui/` paths |
| R22 | **Package chains shared with other lanes** (section 6.14): the candidate production also feeds the jobs of `llm-mesh` and `llm-gateway`, and it packs `auth-ui` as well as `cluster-mesh`; the install lane of `cluster-mesh` imports the compiled Vue entries under Node, which is `unverified` for a module of the DS Vue package | medium | a job of another lane turns red on a package lot; A11 stops on its install lane; an archive is published without its Vue variants | the chain work is in the lots that own the packages, with its conditional paths and the cluster-mesh lane cleared for A1d and A11; prepack gates and negative controls as witnesses; `auth-ui` published before A11 runs its consumers; a red install lane is reported the day it appears, and the generic check is not weakened to pass it |

### 7.1 Pre-mortem

Assume it is 30/11 and the cutover has not happened, or was rolled back. The most likely stories, with the early signal and the guard for each [JUGEMENT]:

| # | Story | Early signal | Guard |
|---|---|---|---|
| 1 | The chat was not ready. C0 showed that much of the host had to move into the package and that the views needed restyling; the Vue lots C2a, C2b, C3 and C4 grew; the hosts started late | on 13/11 22:00 the hours recomputed by C0 for the Vue lots C2a, C2b, C3 and C4 exceed 60 h | decide on 14/11, before V10a, between more branches for the chat and a later M-APP; never start A8a silently on unaccepted package code |
| 2 | V10a slipped, or shipped without a component we needed (editor, toast, icon) | on 15/11 a row of list version 2 has no owner lot scheduled before hour 55 in the DS manifest | daily comparison of the list against the DS manifest; pages that need the missing component move last |
| 3 | A Vapor defect appeared late in a large host | a witness (A0b, A7b, T1b) red on the Vapor entry and green on the classic entry | the row is `blocked` and reported the same day; the owner chooses between waiting for a Vue fix and accepting the classic entry in full |
| 4 | The printed report broke on real content after the cutover | G-PRINT was green on seeds only | long-content fixture in T3; a read-only print check on preprod before the GO |
| 5 | Fixes landed in `ui/` and were not mirrored | ledger entries without a mirroring lot when A10a starts | freeze (decision D2); a CI check fails a PR that touches `ui/src` without a ledger entry |
| 6 | The review and merge queue saturated | queue time above 2 h per lot on 17/11 | reviewer capacity requested with the handoff; a fifth branch helps builders only |
| 7 | The owner saw screens that did not look like the design system | previews skipped, composites unreviewed | previews after A0b and after the pages; manifest reviewed by the DS session |
| 8 | "100 % DS" was reached by adding exceptions, or rendered Markdown lost its styling in the printed report | a ninth register entry is requested; the DOM scan of rule DS-7 is red in print media | register closed at 4 + 4, an owner decision to grow it; rule DS-7 on fixtures and on the rendered DOM; three figures at M-APP |
| 9 | The first route did not close, because its gate named flows of later lots | A0b open for more than 24 h after its start, with red checks outside its surfaces | first-route scenario green on the reference before A0b starts; lot-level scope and pending list (section 4.3.1) |
| 10 | The GO was given and the cutover change went red on checks nobody had listed: security inventory, API image, a package test reading an application file | the A15 branch does not exist, or is not green on the complete workflow, when A10b starts | A15 is prepared from the list of section 6.13 while the acceptance runs; its green run is a precondition of the GO (section 4.5) |
| 11 | A lot started and could not build, because a component it imports belonged to a lot not yet merged | an import of section 6.12 without its dependency in the `BRANCH.md` of the lot | dependency columns generated from the import list; the check of section 6.1 before each start |

---

## 8. Owner decisions left

Each decision has options and one recommendation [JUGEMENT]. Technical choices that need no owner decision are traced in section 9.2.

**D1 — One pass or two.**

| Option | Consequence |
|---|---|
| **A. Direct to the design system, one pass (recommended)** | 526 build hours; each view written once; parity carried by behaviour, API calls, navigation and print, plus an approved list of visual differences; Tailwind and the old print stylesheet do not survive the cutover |
| B. Isometric port first (Tailwind markup in Vue, pixel parity), design system second | a pixel gate at the first cutover; about 110 more build hours (190 view hours × 0.4 for the second pass on templates, a second acceptance of 26 h, a second print pass of 10 h), two acceptances, "100 % DS" reached later; the print stylesheet is ported and then re-authored |

**D2 — Freeze of features on `ui/` during the migration** (from the pin to the cutover).

| Option | Consequence |
|---|---|
| **A. Freeze features; fixes only, each recorded in the ledger (recommended)** | the reference stays comparable; a fix is mirrored once |
| B. No freeze | every feature merged in Svelte is re-implemented in Vue; cost `unknown`; risk R6 becomes certain |

**D3 — Initiative scatter plot.**

| Option | Consequence |
|---|---|
| **A. Keep the chart.js engine as registered exception EX-1 at the cutover; DS controls around it (recommended)** | no change of the chart in the printed report; convergence onto a DS chart is a later, separate lot once DS gap G-1 is closed |
| B. Rebuild on DS `scatter-plot` or `priority-matrix` now | waits for M-DSV and for G-1; hours `unknown`; A4b and T3 gain a dependency on the DS dataviz release; the chart changes in the report |

**D4 — How the visual differences and the exception register are approved.**

| Option | Consequence |
|---|---|
| **A. One formal approval at M-APP on the full `ds-intended` list and on the register (4 permanent, at most 4 temporary entries, section 3.5), with previews after A0b (17/11) and after the pages (20/11) (recommended)** | no lot waits for an approval; a rejection at a preview costs one lot, not the acceptance. The list holds visual rows (for example the coloured header of a field card becoming an edge accent, gap G-7) and behaviour rows (decision D8) |
| B. Approval per lot | about 15 approvals; each waiting lot holds a branch slot |

**D5 — A fifth simultaneous sentropic branch from 16/11 15:00 to 20/11** (the rule is four per wave, `rules/workflow.md:55`).

| Option | Consequence |
|---|---|
| **A. Yes, for that window (recommended)** | slack before the acceptance lots from 6 h to 16 h, slack of the print acceptance from 20 h to 40 h; first route (17/11 17:00) and M-APP (22/11 17:00) unchanged; M-APP protected against one slip of a page lot (section 6.8) |
| B. Keep four | the schedule of section 6.8 holds 22/11 17:00 with 6 to 20 h of slack outside the chat chain |

**D6 — Screens of `apps/auth-idp`.**

| Option | Consequence |
|---|---|
| **A. Migrate them in this programme (A1b, 8 h) and switch them in their own lot on your GO (A1c, 4 h) (recommended)** | `auth-ui` can drop its Svelte exports in A16; no Svelte application remains in the repository; the switch and the rollback of these screens are those of the API image, apart from the UI cutover |
| B. Leave them on Svelte | `auth-ui` keeps both sets of exports with no end date; A16 is partial |

**D7 — Cutover GO (A15, and A1c for the identity-provider screens).** An act, at M-APP, not a choice to make now. It carries one acknowledgement: production then runs on a Vue release candidate until 3.6.x is stable (owner decision AD7, `PLAN.md:20`), and each pin bump is a reviewed change. A15 publishes two images, the UI image and the API image rebuilt with unchanged code (section 4.5); its branch is green on the complete CI workflow before the GO is asked (section 6.4).

**D8 — Citation links inside the editor** (gap G-12). Needed before A7b starts: 17/11 09:00 with four branches, 16/11 15:00 with five. The option chosen sets what G-SEM expects (section 4.3.1).

| Option | Consequence |
|---|---|
| **A. While a field is being edited, a citation stays the text `[n]`; it is a link in locked and print modes (recommended)** | no dependency on a DS change; one behaviour row in the list approved under D4; the approved-difference entry of section 4.3.1 is created, so that G-SEM expects the text `[n]` in an editable field and the link in locked and print modes; a request is sent to the DS for citation tokens in the editor |
| B. Keep clickable citations while editing | no approved-difference entry: G-SEM requires the links inside the editor; A7b, then T1b and every page, wait for a DS editor change that has no lot today (hours and date `unknown`) |

---

## 9. Trace

### 9.1 Differences with the DS plan (W7, W8, W9 of `PLAN.md` revision 4)

[JUGEMENT] Choices of this plan; the DS plan lines are cited.

The lot identifiers are kept. The changes below are sentropic-side; none changes a DS lot.

| Change | Reason |
|---|---|
| The port is direct to DS components; the DS plan keeps Tailwind and the local markup in the application (`PLAN.md:497`) and compares normalised DOM with Svelte (`PLAN.md:512`) | owner request of 13/11, "100 % design system"; DOM parity is replaced by G-SEM, G-API and a classified visual report |
| AE1a, AE1b, AE2a and AE2b added (38 h) | parity instrument, first-route scenario, reference suite and DS-conformity instrument must exist before the first view |
| A0 split into A0a (now) and A0b (V10a) | the scaffold, the stores and the navigation policy need nothing from the DS |
| T2 starts before V10a; the DS input names V10a as its start signal | in the DS plan T2 waits for A0 only because A0 creates `ui-shared/`; A0a now does |
| `/neutral` and `WorkspaceCreateDialog` move from A2 to A0b; family (a) leaves T1 as T1a | the landing page is the first real route; family (a) has one consumer and no dependency on the editable field |
| T1 becomes T1a + T1b; the renderer's framework-independent script moves into T2; T1c (print layer, 16 h) added | the print stylesheet cannot be ported once Tailwind is gone (section 2.5) |
| A1 split into A1a, A1b and A1c; A5, A6, A7 split into a neutral part and a view part; A4a is the engine extraction, A4b the host and the dashboard | neutral parts start before V10a; the identity-provider front ships in the API image and has its own cutover (A1c), apart from the acceptance and from the UI cutover |
| A7b starts at V10a without waiting for A0b; A0b waits for T1a and C1; A5b waits for A2 | A7b is verified on the harness entry; the landing page renders through T1a and the shell reads a chat-ui store; the matrix spec starts on the folders page |
| The editor is DS `RichTextEditor` as a closed component; the local TipTap extensions are not re-hosted | it has no extension prop (section 2.9); one of the two local extensions has no importer |
| C1 and T2 each gain 2 h for the generated-HTML contract | six generators write styling into HTML strings that no template lint sees (section 2.8) |
| A9 precedes A2, A3, A5b, A6b | these pages import the components of A9 (section 2.1) |
| A10a no longer waits for T3; A10b does | T3 is an acceptance lot; it runs beside the test migration |
| The candidate mounts on `#app` and shares neither `app.css` nor `app.print.css` (`PLAN.md:452` shares them) | both files are Tailwind-bound |
| C1 does not switch the Svelte views to the neutral core | the reference must not move |
| C2 is split into C2a (elements) and C2b (compositions); `ChatPanelShell` leaves C3 for C2b; C2b and C7a wait for the element lots; the 58 h become 60 h (`PLAN.md:737-739` give the three batches the same prerequisites, C1 and V10a) | `ChatConversation` and `ChatPanelShell` import views of two batches (section 6.5) |
| C1 also delivers the content stylesheet `./content.css` and the empty Vue entries of the package (+4 h) | a consumer of the package must get the Markdown styles from the package; three parallel lots must not each create the entries |
| The application adapter of `StreamMessage` moves from the chat host lot to A9; A4b and A8a wait for A9 | imports of the queue monitor, of four pages, of the dashboard and of the chat panel (section 6.12) |
| `ui-vue/` is a standalone root, not a root workspace; A0a (+4 h) and A15 (+2 h) change the repository tooling that reads `ui` (the DS plan names only the build and CI targets, `PLAN.md:433-458`) | scanners, inventories, the API image and CI tests read the `ui` root (section 6.13) |
| C1 owns the make and CI chain of chat-ui (tool profiles, three build outputs, archive path taken from the pack step); C6a qualifies the Vue consumers with a target of the package, not with `make qualify-published-install` (`PLAN.md:741`) | the package recipes install a fixed Svelte tool set, the workflow names the archive by its version, and the generic check fails on a stylesheet export (section 6.5) |
| A1a is split into A1d (the `auth-ui` package, before A11) and A1a (the routes, after A11); A1b waits for A1d; A1d and A11 own the build and qualification chains of `auth-ui`, `cluster-mesh` UI and `cited-source-viewer`, with packed consumers of their own (+1 lot, +14 h). The DS plan puts `auth-ui` in A1 with the pages and gives A11 no prerequisite but V10a (`PLAN.md:705`, `:715`) | two `cluster-mesh` screens import `auth-ui` components, and the recipes of the three packages compile no Vue component (sections 6.12, 6.14) |

### 9.2 Technical decisions taken here (decide and trace)

[JUGEMENT]

- Vite single-page application, no server rendering, neutral router of the DS programme; `vue-router` only as fallback on the classic entry (section 3.3).
- Stores as neutral signals with one bridge; no Pinia (section 3.4).
- One neutral i18n module on `intl-messageformat`; no `vue-i18n` (section 3.8).
- Print hooks as `data-print-*` attributes; one application print stylesheet as a permanent registered exception (section 3.7).
- Unit tests stay TypeScript-only; view behaviour is verified by end-to-end specs and candidate-only harness pages, which are excluded from the production build (section 4.4).
- Gates at lot level: owner-lot sets, a candidate spec manifest at file granularity, a pending list, lot scenarios and harness specs (section 4.3.1).
- API oracle by value, with identifier aliases, a closed list of volatile fields, a causal order by user action and five witness mutations (section 4.3.2).
- One generated-HTML contract — class-free output, one generator, one wrapper — checked on fixtures and on the rendered DOM (section 3.5.1).
- Exception register in two kinds, closed at 4 permanent and 4 temporary entries; three figures instead of one for "100 % DS" (section 3.5).
- The identity-provider front keeps its served layout so that the service is unchanged before its cutover (A1b, A1c).
- Lot dependencies follow the component imports read from the sources; elements before compositions before hosts (sections 6.5, 6.12).
- One content stylesheet, owned by `chat-ui`, exported as `./content.css`, loaded by one explicit import per consumer and reused unchanged by the application (section 3.5.1).
- `ui-vue/` is a standalone root with its own lockfile; the service, image and filter names stay `ui`; repository tooling is registered at A0a and re-pointed at A15 only (sections 3.2, 6.13).
- An owner decision changes a parity expectation only through the approved-difference list (section 4.3.1).
- chat-ui keeps a consumer qualification of its own: one make build for the Svelte, classic and Vapor outputs, the archive path taken from the pack step, three packed consumers in `validate-chat-ui`; the generic `qualify-published-install` check is neither changed nor a gate of this package (section 6.5).
- The sibling UI packages are ordered by their imports — `auth-ui`, then `cluster-mesh` UI and `cited-source-viewer`, then the authentication routes — and each keeps its own make and CI chain: one build per package for the Svelte, classic and Vapor outputs, also run by the candidate production, and three packed consumers per package through one target. The generic install check is not changed: it stays a gate of `cluster-mesh` and `chat-core`, where it runs today, and is not added to the other packages (section 6.14).
- Not ported: `MatrixDetails`, `MaturityStageBadge`, `StarRating`, `ScoreCard` (no importer), `ArtifactsPanel` (test-only importer), the unused exports of `viewTemplates.ts`, `lib/extensions/references.ts` (no importer), `lib/extensions/tailwind-classes.ts` (replaced by the DS editor), and the dependencies `chartjs-plugin-datalabels` and `@types/d3` (no importer). They disappear with `ui/` at A15.

### 9.3 Assumptions, all `unverified`

- Day 0 of the DS = 14/11 08:00; V10a 55 h later; L1.7 and L1.6 inside the first 26 h.
- 4 h of overhead per lot; four branches; builders, reviewers and s-conductor continuous.
- Every build-hour figure (estimates from counts; A0b measures the first real rate and C0 recomputes the Vue lots C2a, C2b, C3 and C4; the schedule is recomputed from the graph of section 6.8 after each).
- The owner-lot sets of section 6.11 (static map from route strings, until AE1b records the real one).
- The toolchain pins are those of the registry on 12/11 until V0a publishes its matrix.
- The redistribution of the 58 h of the Vue batches over four lots, pro rata of Svelte lines (section 6.5), and the hours added in revision 3 (A0a +4, A9 +2, A15 +2, C1 +4).
- The cross-lot imports of section 6.12 and the readers of section 6.13 are complete for static imports and for one repository search at `c40b8d1b5`; the chains of section 6.14, for one reading of the recipes and jobs at the same commit.
- The CI-chain work assigned in revision 4 (section 6.5) fits in the unchanged hours of C1 (24, the cap of section 6.1) and of C6a (6, on the critical path). If C1 is re-estimated above its cap, it is split before it starts (risk R3); an hour added to C6a is an hour on M-APP (section 6.9).
- The hours of revision 5 (section 6.7): the split of the 12 h of A1a pro rata of Svelte lines, and the chain work of section 6.14, 6 h in A1d and 6 h in A11. A lot re-estimated above the cap of section 6.1 is split before it starts. Neither lot is on the critical path; with four branches the slot that holds them has 6 h of slack (section 6.9).
- The adaptation of the dependency of `cluster-mesh` on `auth-ui`, which revision 6 moves from A11 to A1d (section 6.14), is carried in the unchanged hours of both lots, A1d 18 and A11 16: two lines of one manifest, one pinned version in four places, one aligned fixture and the root lockfile, no source change. The bullet above applies if either lot is re-estimated.

### 9.4 Unknown and source gaps

| Item | Status | Established by |
|---|---|---|
| Hours of the Vue lots C2a, C2b, C3 and C4 once the views are restyled on the DS | `unverified` | C0 |
| Value sets of DS `field-card`, glyphs of DS `rating`, shape of DS `Toast`, props of DS `RichTextEditor` (gaps G-7, G-8, G-4, G-12) | established in this revision at the DS pin (section 5.4) | re-read by AE2a at the DS head |
| Fit of DS `AppShell`, `PanelStack`, `UtilityPanel` for the docked shell (G-3); coverage of the scatter engine by the DS charts (G-1); DS answer to each gap request | `unverified` | AE2a; the DS session |
| Markdown round trip through the document format of the DS editor | `unverified` | A7b |
| Owner-lot set of each spec beyond its route strings (regions reached by clicks); lane of `a4/identity-cutover.spec.ts` | `partial`; `unknown` | AE1b |
| Exposure of the Svelte reference through the `onclick` attribute that its sanitiser allows (`ui/src/lib/utils/markdown.ts:147`) | `unverified`; outside this plan, reported to the owner | a security review of `ui/`; the candidate allow-list drops the attribute (section 3.5.1) |
| Subpath names of `design-system-vue`; package and channel of the neutral router; hours of V5b | `source-gap` (G-9, G-10, G-11) | DS session |
| Vapor behaviour of recursion, `v-html`, delegated events around third-party DOM, mounting in an extension host | `unverified` | T1b, A7b, A8b; DS lot V0c for Teleport and custom elements |
| PR size acceptable to the reviewer; reviewer and conductor availability per day | `unknown` | s-conductor |
| Form of a semver range on a pre-release DS peer under the publication rule | `unknown` | s-conductor, before A1d |
| Import under Node of the compiled Vue entries of `cluster-mesh` by its install lane, with the DS Vue package and `auth-ui` among the pinned peers (section 6.14) | `unverified` | A11 |
| Version ranges of the packages that depend on a bumped package: `cowork-desktop` on `cowork-bridge` (`^0.2.0`); `chat-server`, `cowork-bridge` and `cowork-desktop` on `chat-core` (`^0.3.0`). The range of `cluster-mesh` on `auth-ui` (`^0.9.0`) has left this list: it excludes the minor of A1d, which adapts it in its own PR (section 6.14) | `unverified`: whether the additive bumps of A0a and C1 stay inside these ranges | A0a and C1, with s-conductor, before their first commit |
| Duration of G0 on the DS side | `unknown` | DS session |
| Deployment changes needed by A15 under `deploy/**`; for A1c the manifest is `deploy/k8s/base/35-auth-idp.yaml` | `unverified` for A15: with the service and image names kept, only the two image pins are expected to move; `partial` for A1c | A15, A1c |
| Readers of the `ui` root beyond the table of section 6.13 (one search at `c40b8d1b5`); cross-lot imports beyond section 6.12 (static imports only); chain links beyond section 6.14 (one reading of the recipes and jobs) | `partial` | A0a and A15 re-run the search; AE2a re-runs the import extraction; A1d and A11 re-read their chain |
| Split of the content stylesheet between screen rules (package) and print rules (`print.css` of the application) for rendered Markdown | `unverified` | T1c |

### 9.5 Not covered by this plan

The API and its view-template seeds; DOCX templates and the `app_templates` table; the Preact pass (section 6.10); immo; every DS lot; production database operations; the compile service of section 3.11.

### 9.6 External facts with an expiry

[FAIT] npm dist-tags and GitHub release notes were read on 2026-11-12 at 22:15 Montréal: `vue` 3.6.0-rc.15 / 3.5.45, `vue-router` 5.5.0, `nuxt` 4.6.4, `@vitejs/plugin-vue` 6.0.11, `vue-tsc` 3.3.14, `intl-messageformat` 12.1.5, `@preact/signals-core` 1.14.5, `alien-signals` 3.2.1, `@sentropic/design-system-vue` 0.39.0. Re-read at A0a and at each pin bump.

[FAIT] Repository heads re-read for revision 2: `sentropic` `origin/main` is still `c40b8d1b5`. The DS `origin/main` has moved from the pin `5f57b382` to `213a81f8` (36 files, diagram and ERD work); under `packages/components-svelte` and `packages/components-vue` the only files changed are `DiagramSceneFigure` and two ERD tests, none of them cited here. The DS facts of this plan stay read at the pin.

[FAIT] Repository heads re-read for revision 3 (2026-11-13 00:20 Montréal): `sentropic` `origin/main` is still `c40b8d1b5` (`git ls-remote`). The DS `origin/main` is now `6c1c31cf`; under `packages/components-svelte` and `packages/components-vue` the files changed since the pin are `DiagramSceneFigure` (Svelte and Vue) and two ERD tests, none of them cited here.

[FAIT] Repository head re-read for revision 4 (2026-11-13 01:10 Montréal): `sentropic` `origin/main` is still `c40b8d1b5` (`git ls-remote`). The DS head was not re-read: revision 4 adds no DS fact.

[FAIT] Repository head re-read for revision 5 (2026-11-13 02:25 Montréal): `sentropic` `origin/main` has moved from the pin `c40b8d1b5` to `21f641113` (`git ls-remote`; 72 commits, 26 files). One changed file is under a perimeter of this plan, `e2e/tests/02-organizations.spec.ts` (11 lines replaced); it is named here without a line reference, and the counts of section 2.7 stay those of the pin. No file changed under `ui`, `packages`, `apps/auth-idp`, `scripts`, `.github`, `rules` or in `Makefile`: every `file:line` of this plan reads the same at both commits. The facts stay read at the pin, and only s-conductor re-pins the reference (section 4.2). The DS head was not re-read: revision 5 adds no DS fact.

[FAIT] Repository head re-read for revision 6 (2026-11-13 02:57 Montréal): `sentropic` `origin/main` is still `21f641113` (`git ls-remote`). `git diff --name-only c40b8d1b5 21f641113` lists no file under `packages/cluster-mesh`, `packages/auth-ui`, `scripts/ci` or `rules`, nor `Makefile` or the workflow: every `file:line` added by revision 6 reads the same at both commits. The DS head was not re-read: revision 6 adds no fact of the DS repository.

### 9.7 Review record, round 1

Round 1: Astra max reviewed revision 1 (`.tmp/rv/SPEC_EVOL_APP_VUE_VAPOR_MIGRATION.v1.md`) and returned REWORK with 1 BLOCKER, 5 MAJOR and 1 MINOR (`.tmp/rv/app-vue-plan-astra.v1.md`). The reviewer confirmed the inventory (66 Svelte files, 23 pages, 40 components, 18 stores, 90 test files, 61 specs) and the sums of revision 1 (39 lots, 472 h). The table below records the corrections made in revision 2, with the figures of revision 2; where round 2 changed them, section 9.8 gives the current ones.

Reconciliation of round 1. Each finding was checked against the code at the pins before it was corrected; "also found" marks what the check added beyond the finding.

| # | Severity | Finding of the reviewer | Check against the code | Correction in this revision | Sections |
|---|---|---|---|---|---|
| 1 | BLOCKER | The first route cannot meet its exit gate: A0b waits for T1a while the gate of T1a needs A0b; the two specs kept for A0b leave its perimeter | Confirmed. `06-tooling-visual-parity.spec.ts:26-67` needs the login screen, the organizations list and detail and the chat widget; `00-ai-generation.spec.ts:198-220` goes on to `/folder/new`. The stored session needs no login screen (`e2e/global.setup.ts:426-448`). Also found: the same defect in the gates of A2, A3, A5b and A8a; the chat launcher sits on every authenticated page (`+layout.svelte:413-415`), so G-SEM could not pass on A0b; the shell reads a chat-ui store (`+layout.svelte:23`, `Header.svelte:12`) | T1a is verified on its own harness bench, without a route. A0b waits for T1a and C1. AE1a writes an eight-step first-route scenario, green on the Svelte reference before A0b starts, every step inside A0b. Gates get a lot-level scope: owner-lot sets, candidate spec manifest, pending list. The 61 spec files are mapped to lots | 3.2, 4.3.1, 6.1, 6.2, 6.3, 6.6, 6.11 |
| 2 | MAJOR | The 100 % DS check ignores generated HTML that still depends on Tailwind | Confirmed and extended: six generators (section 2.8); the sanitiser allows `class`, `style` and `onclick` (`ui/src/lib/utils/markdown.ts:145-148`); locked and print modes use the class injection (`TemplateRenderer.svelte:496-497`). Also found: revision 1 planned to re-host two editor extensions, but one has no importer and DS `RichTextEditor` has no extension prop | Generated-HTML contract: one neutral generator (C1) and one application wrapper (T2), class-free output; the Svelte generators are pinned by a golden test and untouched until C6c and A15; rule DS-7 on fixtures (Markdown, citations, lists, truncated stream) and on the rendered DOM in screen and print media (AE2b); exceptions EX-5 narrowed and EX-7 added | 2.4, 2.8, 2.9, 3.5, 3.5.1, 6.2, 6.5, 6.6 |
| 3 | MAJOR | The DS gaps are listed, but their resolution is not a verifiable prerequisite; exceptions can grow until G-DS is green | Confirmed. The DS lots V1 to V9 convert or port, none extends (`PLAN.md:578-591`); DS `Rating` draws stars only (DS `Rating.svelte:6`, `:9-26`). Also established at the DS pin: `FieldCard` variants and tones (`:5-14`, `:54`), `Toast` (`:5-15`), `RichTextEditor` props (`:35-73`) | Per gap: need for the cutover, resolution, owner lot, hours, evidence, dependent lots; a dependent lot starts only on that evidence. G-DS reports three figures. The register is split into permanent and temporary, closed at 4 + 4, and grows only by owner decision. A role covered by a DS entry is an exception, not a composite (EX-8). Gap G-12 and decision D8 added | 3.5, 5.3, 5.4, 5.5, 6.2, 6.3, 6.6, 8 |
| 4 | MAJOR | The published schedule breaks a dependency (A0b and T1a start together) and overstates capacity | Confirmed. Recomputed with one rule on one graph — a lot starts at the latest of its release, the merge of its dependencies and the end of the previous lot of its slot — run mechanically for four and for five slots | The graph table of section 6.8 is the single source of the schedule, the milestones and the French summary. A0b: 17/11 09:00 → 18/11 01:00. M-APP stays 22/11 05:00 with four slots, with 2 to 6 h of slack outside the chat chain; this holds because A7b no longer waits for A0b (with that dependency kept, the page chain has no slack on the graph and the four-slot sequences tested end between 22/11 17:00 and 22/11 21:00). Fifth slot recomputed. Estimates declared provisional until A0b and C0 | 1, 6.7, 6.8, 6.9, 8 |
| 5 | MAJOR | The API parity oracle is too weak (shape only) and its reproducibility is undefined | Confirmed. Revision 1 compared method, path, status and body shape. `Date.now()` appears 144 times in 41 files of `e2e/tests` and `e2e/helpers` (`00-access-control.spec.ts:27`); created identifiers feed API paths (`:35-38`) | Mutating bodies compared by value; identifier aliases by kind and order of appearance; closed list of volatile fields with a masked-value count; deterministic fixtures; causal order by user-action group; five witness mutations (wrong save, missing request, swapped mutations, disabled action, removed element) in the exit gate of AE1a | 4.2, 4.3, 4.3.2, 6.2 |
| 6 | MAJOR | Several exit gates need paths that the lots do not declare (identity-provider front, extension builds); tests named by count or family | Confirmed. The Make targets and the image stage name `apps/auth-idp/web` (`Makefile:3412-3452`; `api/Dockerfile:436-447`, `:506`; `docker-compose.ci.yml:60`; `apps/auth-idp/idp-app.ts:50`, `:198`); four of its pages import Svelte components of `auth-ui` (`auth/login/+page.svelte:3`); the extension targets run `svelte-kit sync` in `ui/` (`Makefile:355-372`). Also found: A0a could not re-point test files inside `ui/`; the gates of A5a and A6a needed reference logs without a dependency on the recorder | A1b builds and serves the candidate front with every path declared; A1c (new, 4 h) switches the service, the image stage, the CI service and the manifest, and deletes `apps/auth-idp/web/**`; A16 waits for A15 and A1c. A8b declares its Makefile, compose and CI exceptions. Every gate names its spec files (section 6.11) or its harness spec. `harness check branch` and `make scope-check` are common rules | 4.5, 6.1, 6.2, 6.3, 6.4, 6.11, 8 |
| 7 | MINOR | "No spec covers print" is false | Confirmed: `05-executive-summary.spec.ts:168` and `05-usecase-detail.spec.ts:600` call `emulateMedia`. `page.pdf` and `window.print` are absent | Inventory corrected. AE1b keeps the two tests and makes their locators neutral; the gap stated is the paged PDF reference and the assertions per page, which AE1b and T3 add | 1, 2.7, 3.7, 4.4, 6.2, 7 |

Effect on the totals, itemised:

| Change | Lots | Hours | Finding |
|---|---|---|---|
| AE1 split into AE1a (12 h) and AE1b (14 h): first-route scenario, API oracle by value, witness mutations, manifest and pending list | +1 | +10 | 1, 5, 7 |
| AE2 split into AE2a (6 h) and AE2b (6 h): gap requests with evidence, register bounds, rendered-DOM scan | +1 | +2 | 2, 3 |
| A0a: `UI_TARGET` switch, candidate lane and harness entry made explicit | 0 | +2 | 1, 6 |
| C1 and T2: generated-HTML contract | 0 | +4 | 2 |
| T1b: content styles (EX-7) and complexity scale (EX-8) | 0 | +2 | 2, 3 |
| A7b: Markdown adapter and round-trip corpus for the closed DS editor | 0 | +2 | 2, 3 |
| A1c: cutover of the identity-provider front | +1 | +4 | 6 |
| **Total** | **+3** (39 → 42) | **+26** (472 → 498) | |

Findings of the two reviews of DS plan revision 3 (`REVIEW-plan3-carbon.md`, `REVIEW-plan3-astra.md`) that concern the application are carried into this plan: a permanent shared root and a no-reference check before the cutover (section 3.2); the two extension entries (A8b); both build outputs built and tested by every lot (G-ENTRY); additive subpaths with an installation contract for the sibling packages (A1a, A11, C6a); stores before the templater renderer (T2 before T1b); the landing page as the single consumer of family (a) (A0b, T1a); no lot above the size cap; a schedule that respects branch slots (section 6.8).


### 9.8 Review record, round 2

Round 2: Astra max reviewed revision 2 (`.tmp/rv/SPEC_EVOL_APP_VUE_VAPOR_MIGRATION.v2.md`) and returned REWORK with 0 BLOCKER, 3 MAJOR and 1 MINOR (`.tmp/rv/app-vue-plan-astra.v2.md`). Of the seven round-1 findings, five were judged FIXED (1, 2, 4, 5, 7) and two NOT FIXED (3 and 6). The reviewer re-confirmed the main inventories and the sums of revision 2 (42 lots, 498 build hours). The table below records the corrections made in revision 3; revision 4 changes none of its figures. Round 3: section 9.9.

Reconciliation of round 2. Each item was checked against the code at `c40b8d1b5` before it was corrected; "also found" marks what the check added beyond the finding.

| Item | Severity | Finding of the reviewer | Check against the code | Correction in this revision | Sections |
|---|---|---|---|---|---|
| R2-1 | MAJOR | The dependency graph omits component dependencies: C2, C3 and C4 are presented as independent although `ChatPanelShell` (C3) imports views of C2 and C4; `QueueMonitor` (A9) imports the `StreamMessage` wrapper assigned to A8a | Confirmed: `ChatPanelShell.svelte:20`, `:24-32` imports 10 views; `QueueMonitor.svelte:17`. Also found: `ChatConversation` (C2) imports 6 views of C4 (`ChatConversation.svelte:5-15`); `ChatPanel` was in no batch; four pages of A2 and A3 import the wrapper; the dashboard (A4b) imports the lock badge of A9 without depending on it; `AppChatPanel` (A8a) imports `DocumentSourceMenu` of A9 and started 2 h before A9 merged in the published schedule; `object-lock.ts`, a Svelte-bound module imported by five pages, had no owner lot; the three parallel batches would each have created the Vue entries of the package | Elements, compositions and adapters are assigned explicitly: C2a, C4 and C3 hold elements (C3 is self-contained), C2b the two cross-batch compositions, after C2a and C4; the hosts stay A8a and A8b. The wrapper moves to A9 with the lock module; A9 waits for C2a; A4b and A8a wait for A9; A8a names A7b. C1 creates the empty Vue entries. Section 6.12 lists every cross-lot import with `file:line`, and a standing rule ties dependencies to imports. The schedule is recomputed mechanically on the new graph for four and five slots | 1, 2.2, 2.4, 3.10, 5.6, 6.1, 6.3, 6.5, 6.8, 6.9, 6.12 |
| R2-2 | MAJOR | The Markdown styles of chat-ui are shipped only in the application: the resolution of G-2 relies on `ui-vue/src/styles/content.css`, which a consumer installed from the package does not receive; the existing `theme.css` of chat-ui relies on Tailwind utilities | Confirmed: `packages/chat-ui/package.json:24` exports `./theme.css`; `src/theme/chat-ui.css:1-14` is generated from utility classes and scoped to `[data-st-chat-theme]`. Also found: generated content is rendered by two package views (`StreamMessage.svelte:980`, `:1000`; `ChatPanelShell.svelte:329`); the package ships its sources, declares CSS files as side effects (`package.json:12`, `:252-255`) and documents an explicit stylesheet import (`chat-ui.css:7-9`) | One stylesheet owned by the package: `packages/chat-ui/src/content/content.css`, exported as `./content.css`, written and contract-tested by C1 before V10a, loaded by one explicit import per consumer, and by the application unchanged (no file under `ui-vue/`). It is checked in the Tailwind-free host of C2a and C2b, and in the packed consumer of C6a, outside the repository, on the computed styles of a heading, a list, a code block and a citation, with a witness without the import. EX-7 is re-targeted; the register stays at 4 + 4 | 1, 2.9, 3.5, 3.5.1, 3.10, 5.4, 5.5, 6.2, 6.5, 6.6 |
| R2-3 | MAJOR | A15 would delete files still required by repository checks (`scripts/security/daily/inventory.mjs:8`, `scripts/ci/publishable-ci-wiring.test.mjs:867`); when the candidate is introduced, the root list of `scripts/ci/ci-lockfile-installs.mjs:55` has neither `ui-vue` nor `ui-shared`, and A0a does not allow that script | Confirmed, the three files as cited. Also found: `ui` is a root npm workspace (`package.json:6`); the API image copies `ui/package.json` and hashes it into its tag (`api/Dockerfile:497`, `Makefile:86`, `scripts/test-api-image-canonical.sh:160`, `:295`); the change classifier treats a file outside `ui/` as `unknown`, which selects the full lane (`compatibility-classifier.mjs:39-41`, `consumer-boundaries.json:98`); the SCA test pins the covered lock set (`sca-gate.test.mjs:115-116`); the UI image tag hashes `ui` only (`ui-image-version.sh:6-8`); the install scanner and an API import audit skip a missing root (`ci-lockfile-installs.mjs:43`, `cm-root-import-audit.test.ts:18-20`); a chat-ui test fixture reads an application file (`production-widget-snippets.ts:11`); one API default names `ui/chrome-ext` (`clients-product-chrome.ts:7`) | Section 6.13 lists 14 readers with `file:line`, their kind (fails, skips, path) and the change of A0a, A14 and A15, each a scope exception of that lot. A0a (+4 h) registers the two roots, with witnesses in its gate. A15 (+2 h) removes `ui` everywhere and rebuilds the API image; its branch is green on the complete workflow before the GO, with a `git grep` for remaining paths. `ui-vue/` is a standalone root, so A0a touches neither the root workspace list nor the inputs of the API image. Risk R21 and pre-mortem story 10 are added | 1, 2.6, 3.2, 4.5, 6.2, 6.3, 6.4, 6.13, 7, 8 |
| R2-4 | MINOR | D8 is not connected to G-SEM: D8 recommends removing the citation links while editing, G-SEM requires a counterpart for every interactive element, and the links exist (`EditableInput.svelte:408`) | Confirmed: the link is `<a href="#ref-n" data-ref-num="n">[n]</a>` (`EditableInput.svelte:408-420`) | An approved-difference list is the only way a decision changes what G-SEM expects. Entry of D8 under option A: inside an editable field the link is replaced by the asserted text `[n]`; in locked and print modes the link stays required. Under option B there is no entry. The instrument of AE1a checks the list | 1, 4.3, 4.3.1, 6.2, 8 |
| 3 (round 1) | NOT FIXED | Resolution of the DS gaps not verifiable: the solution of G-2 is unavailable to standalone consumers of chat-ui | Same check as R2-2 | Corrected with R2-2: the evidence of G-2 is the package stylesheet and its export, and its consumer test is the packed consumer of C6a | 3.5.1, 5.4 |
| 6 (round 1) | NOT FIXED | Paths missing from lots: CI tools affected by the introduction of the candidate and by the removal of `ui/` | Same check as R2-3 | Corrected with R2-3: every tool is a cell of section 6.13 with its lot; A0a, A14 and A15 declare those cells as conditional paths | 6.2, 6.3, 6.4, 6.13 |

Effect on the totals, itemised:

| Change | Lots | Hours | Finding |
|---|---|---|---|
| C2 split into C2a (22 h) and C2b (10 h), C3 from 20 h to 14 h: the 58 h redistributed along the import graph, each share rounded up | +1 | +2 | R2-1 |
| C1: empty Vue entries of the package | 0 | +2 | R2-1 |
| A9: `StreamMessage` adapter and lock module | 0 | +2 | R2-1 |
| C1: content stylesheet, its export and its contract test | 0 | +2 | R2-2 |
| A0a: candidate roots registered in the repository tooling | 0 | +4 | R2-3 |
| A15: `ui` removed from the repository tooling and from the API image inputs | 0 | +2 | R2-3 |
| **Total** | **+1** (42 → 43) | **+14** (498 → 512) | |

Effect on the schedule, with the same rule and the same assumptions:

| Milestone | Revision 2 | Revision 3 |
|---|---|---|
| Work that does not need the DS merged | 15/11 14:00 | 15/11 18:00 |
| First real route (A0b), four branches | 18/11 01:00 | 17/11 17:00 |
| chat-ui Vue packaged (C6a) | 18/11 17:00 | 19/11 05:00 |
| Critical path after V10a | 134 h | 146 h |
| M-APP (A10b) | 22/11 05:00 | 22/11 17:00 |
| Slack outside the chat chain, four branches | 2 to 6 h | 6 to 22 h |

The 12 h added to M-APP are the composition lot C2b on the critical path. The first route comes earlier because the longer chat chain frees a slot for A0b without moving M-APP.

### 9.9 Review record, round 3

Round 3: Astra max reviewed revision 3 (`.tmp/rv/SPEC_EVOL_APP_VUE_VAPOR_MIGRATION.v3.md`) and returned REWORK with 0 BLOCKER, 2 MAJOR and 0 MINOR (`.tmp/rv/app-vue-plan-astra.v3.md`). The four round-2 findings were judged FIXED, and with them the two round-1 items left open. The reviewer re-confirmed the main inventories, the sums of revision 3 (43 lots, 512 build hours) and both schedules (M-APP on 22/11 17:00). Round 4: section 9.10.

Reconciliation of round 3, in one row. Both findings were checked against the make recipes, the workflow, the CI scripts and the package manifest at `c40b8d1b5` before they were corrected; "also found" marks what the check added beyond the finding. Revision 4 changes no lot, hour, dependency or date.

| Item | Severity | Finding of the reviewer | Check against the code | Correction in revision 4 | Sections |
|---|---|---|---|---|---|
| R3-1, R3-2 | MAJOR, MAJOR | R3-1: the CI chain of chat-ui does not build the new deliverables and breaks when the version changes — `build-chat-ui` calls `svelte-package` with a fixed Svelte tool set (`Makefile:1792`), and `validate-chat-ui` passes `sentropic-chat-ui-1.0.1.tgz` (`.github/workflows/ci.yml:1255`) to a target that requires the file (`Makefile:1771`). R3-2: the check required by C6a, `make qualify-published-install`, rejects the mandatory stylesheet exports (`scripts/ci/qualify-published-install.mjs:57`; `qualify-published-install.test.mjs:90`), and C6a allows no change of it | Both confirmed. R3-1: recipe and literal as cited; the last version bump needed a second commit to edit the literal (`1e0caadd2`, then `2f397cda4`). Also found: the type-check, test and DOM-test recipes carry fixed Svelte tool lists too (`Makefile:1785`, `:2922`, `:2945`), and a list outside the committed catalog is refused (`scripts/ci/locked-tools.mjs:17-20`); the pack macro already returns the archive path for every package (`Makefile:985`); a bump also changes the root `package-lock.json`; the DS Vue pre-release cannot be locked before V10a. R3-2: a target that is not JavaScript is `unsupported` and fails the run (`qualify-published-install.mjs:57`, `:404`, `:453`). Also found: the check is not run on chat-ui today and would already fail on `./theme.css` (`packages/chat-ui/package.json:24`); the Svelte packed consumer exists and is wired (`qualify-chat-pair`, `ci.yml:1255`), and it relies on two peers that C6a makes optional | R3-1: C1 owns the chain, with its conditional paths — tool profiles, the four recipes, three build outputs from one target, the dist-form pack, the archive path read from the pack step as for chat-core, the wiring test. Its exit gate runs the whole job on the bumped version, with a witness on the prepack gate. The DS Vue pin is one commit at V10a; the root lock entry is a standing path of the `C*` lots. R3-2: the second option of the finding — a qualification of the package's own, `qualify-chat-ui-vue`, with an explicit validation of the stylesheet exports; the three packed consumers (Svelte, Vue classic, Vue Vapor) run in `validate-chat-ui` on the same archive; the computed-style assertions and the witness without the import are kept, and a witness of the resource validation is added; the files are conditional paths of C6a; the generic check and its test are not changed | 1 (one clause), 6.5, 9.1, 9.2, 9.3, 9.6 |

### 9.10 Review record, round 4

Round 4: Astra max reviewed revision 4 (`.tmp/rv/SPEC_EVOL_APP_VUE_VAPOR_MIGRATION.v4.md`) and returned REWORK with 0 BLOCKER, 2 MAJOR and 0 MINOR (`.tmp/rv/app-vue-plan-astra.v4.md`). The two round-3 findings were judged FIXED. The reviewer re-confirmed the main inventories, the sums of revision 4 (43 lots, 512 build hours, 152 of them before V10a) and both schedules on the declared graph (M-APP on 22/11 17:00), and did not validate the schedule for execution because of the dependency missing in finding R4-1. Round 5: section 9.11.

Reconciliation of round 4, in one row. Both findings were checked against the package sources, the make recipes, the workflow and the CI scripts at `c40b8d1b5` before they were corrected; "also found" marks what the check added beyond the finding.

| Item | Severity | Finding of the reviewer | Check against the code | Correction in revision 5 | Sections |
|---|---|---|---|---|---|
| R4-1, R4-2 | MAJOR, MAJOR | R4-1: a dependency between packages creates a cycle between A11 and A1a — the `cluster-mesh` screens are in A11 and the port of `auth-ui` in A1a, which waits for A11, while `LoginScreen.svelte:2` and `RegistrationScreen.svelte:2` import `AuthLogin` and `AuthRegister`. R4-2: the build and qualification chains of the other UI packages have no assigned work — `build-auth-ui` runs `tsc` on tools without a Vue compiler (`Makefile:2207`), `build-cited-source-viewer` runs `svelte-package` (`Makefile:4690`), the build of `cluster-mesh` goes through `cold-workspace.sh:115`, outside the `ui/**` paths of A11, and the jobs `validate-auth-ui` and `validate-cited-source-viewer` (`ci.yml:1463`, `:1263`) qualify no Vue consumer | Both confirmed. R4-1: imports as cited. Also found: `auth-flow.ts:1` imports the types of `auth-ui`, an optional peer of `cluster-mesh` (`package.json:263`); five authentication pages and four pages of the identity-provider front import `auth-ui` components directly, so A1b depends on that package and on no application route; no import goes the other way, so the packages themselves are not cyclic. R4-2: recipes and jobs as cited. Also found: the archive of `cluster-mesh` that CI qualifies and publishes is not built by `build-cluster-mesh` but by the candidate production, with `tsc` alone (`scripts/ci/package-candidate.mjs:86-93`; `Makefile:1418`, `:1426`); `auth-ui` is in that candidate closure, which follows peers, so its archive has a second producer; a package of the closure cannot take the manifest transform of chat-ui (`scripts/ci/publishable-manifests.mjs:641-647`); none of the three packages has a packed consumer, Svelte included; the install lane of `cluster-mesh` pins `auth-ui@0.9.0` and will import the compiled Vue entries (`Makefile:1314`); the purity gate of `cited-source-viewer` pins its peer set and reads no `.vue` file (`tests/purity.spec.ts:42`, `:105-109`); the type-check and test recipes carry fixed Svelte lists too. In the two other packages that the plan edits: the gate of A0a named the generic install check for `cowork-bridge`, which cannot pass on a src-form package (`scripts/ci/qualify-published-install.mjs:406-407`), and C1 had no path for the tests of the `chat-core` store | R4-1: A1a is split. A1d ports the `auth-ui` package; A11 follows it and mounts its two screens on the delivered Vue components; A1a keeps the routes and follows both; A1b follows A1d. Section 6.12 gains the imports between packages, and the rule of section 6.1 names them. Lots, hours and both schedules are recomputed with the rule of section 6.8. R4-2: section 6.14 inventories the seven package and front chains and assigns each link to a lot, with its conditional paths and exit gates — one build per package for the Svelte, classic and Vapor outputs, tool profiles, the candidate production, pinned peers, the purity gate, and three packed consumers per package (Svelte, kept until A16; Vue classic and Vapor, without any Svelte package), run by the package jobs on the archive actually produced, with negative controls. The gate of A0a for `cowork-bridge` and the paths and gate of C1 for `chat-core` are corrected | 1, 2.9, 3.9, 5.1, 5.3, 5.5, 6.1 to 6.5, 6.7 to 6.9, 6.12, 6.14, 7, 8, 9.1 to 9.4, 9.6 |

Effect on the totals: +1 lot (43 → 44) and +14 h (512 → 526) — +2 h by rounding the two shares of A1a, +6 h of chain work in A1d and +6 h in A11 (section 6.7); nothing changes before V10a. Effect on the schedule, with the same rule and the same assumptions: the critical path (146 h), the first route (17/11 17:00) and M-APP (22/11 17:00) do not move. With four branches the print layer T1c ends on 20/11 11:00 instead of 20/11 09:00 and its acceptance T3 on 21/11 01:00 instead of 20/11 23:00, the dashboard and matrix pages end 16 h and 14 h later, and the slack outside the chat chain is 6 to 20 h instead of 6 to 22 h. With five branches the slack before A10a is 16 h instead of 24 h.

### 9.11 Review record, round 5

Round 5: Astra max reviewed revision 5 (`.tmp/rv/SPEC_EVOL_APP_VUE_VAPOR_MIGRATION.v5.md`) and returned REWORK with 0 BLOCKER, 1 MAJOR and 0 MINOR (`.tmp/rv/app-vue-plan-astra.v5.md`). The two round-4 findings were judged FIXED. The reviewer re-confirmed the main inventories, the sums of revision 5 (44 lots, 526 build hours, 152 of them before V10a) and both schedules on the declared graph (M-APP on 22/11 17:00), and did not validate the schedule for execution because of finding R5-1. Round 6: not done; revision 6 is `unverified` by a reviewer.

Reconciliation of round 5, in one row. The finding was checked against the two manifests, the make recipes, the workflow, the CI scripts and the packaging suite of `cluster-mesh` at `c40b8d1b5` before it was corrected; "also found" marks what the check added beyond the finding.

| Item | Severity | Finding of the reviewer | Check against the code | Correction in revision 6 | Sections |
|---|---|---|---|---|---|
| R5-1 | MAJOR | The adaptation of the dependency of `cluster-mesh` on `auth-ui` comes too late for A1d to close: the gate of A1d requires the seven legs of `validate-cluster-mesh` green on the candidate archive of the new `auth-ui`, while the change of range and of pinned version is assigned to A11, which waits for the merge and the publication of A1d. The Vue exports are published as a minor (`PLAN.md:948`; `rules/workflow.md:116`), so `auth-ui` goes from `0.9.1` to `0.10.x`, which the range `^0.9.0` of `cluster-mesh` excludes, and the qualification rejects an excluded same-PR sibling, an optional peer included, before the install (`checkSiblingRanges`, `scripts/ci/qualify-published-install.mjs:149`, called at `:348`). Expected, owner A1d with s-conductor: the compatible change of the manifest, the pinned versions and their checks, with their paths and version changes; A11 keeps the port of the screens; the qualification of A1d really uses the archive of the new `auth-ui` | Confirmed as cited: version, range, publication rule and call order. Also found: (1) the range alone does not meet the criterion — the `install` leg takes the sibling archive only for exactly the pinned version and otherwise installs the pinned `auth-ui@0.9.0` from the registry (`:415`, `:421-426`), so it would pass without the new archive; (2) the pin is one tuple in three steps, held equal by the wiring test (`Makefile:1314`; `ci.yml:3524`, `:3739`; `publishable-ci-wiring.test.mjs:458`, `:464-471`), and revision 5 named the first step only; (3) a second leg depends on the bump: the suite of the `lazy` leg requires the `selected` fixture and its lock to carry the version and the peer set of the `auth-ui` and `cluster-mesh` manifests (`packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts:47-51`, `:76-84`), and the last patch of `auth-ui` needed an alignment commit of its own (`b703a26e6`); (4) a consumer whose range changes is bumped (`rules/workflow.md:124`), and a pre-release version of `cluster-mesh` is not published (`ci.yml:3477-3483`), so the merge of A1d publishes `auth-ui` only; (5) the paths of A11 named neither that fixture nor the two post-publication steps, which its own changes of the tuple, of the version and of the peer set of `cluster-mesh` also edit | The adaptation moves from A11 to A1d, into the PR that bumps `auth-ui`: range widened to the new minor with the 0.9 line kept, next development version of `cluster-mesh`, pinned `auth-ui` moved in the three steps and in the wiring test, `selected` fixture aligned and root lockfile refreshed — each a conditional path of A1d. Gate of A1d: the seven legs green in its PR, before any change of A11; in the report of the `install` leg, the edge to `auth-ui` accepted on the new version and `auth-ui` installed with the source `sibling-receipt`; the `lazy` leg green on the aligned fixture. A11 keeps the port of the screens, the Vue pinned peers and the UI lane; its conditional paths gain the fixture and the two post-publication steps. The order rule states what a branch of another lane does until the new version is published | 6.3 (rows A1d and A11), 6.14, 9.3, 9.4, 9.6 |

Effect on the totals and on the schedule: none. The lots (44), the build hours (526, 152 of them before V10a), the dependency graph of section 6.8, the critical path (146 h), the first route (17/11 17:00) and M-APP (22/11 17:00) are those of revision 5; the work moved is carried in the unchanged hours of A1d and A11 (assumption of section 9.3).
