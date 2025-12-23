# Feature: Replace Icons with Lucide

## Objective
Replace all SVG icons throughout the application with Lucide icons from `@lucide/svelte` library. Also remove specific buttons in dossiers and entreprises pages, and modify buttons in UseCaseDetail.

## Plan / Todo
- [x] Install @lucide/svelte library
- [x] Create icon inventory by view/component
- [x] Replace icons in Header component
- [x] Replace icons in ChatWidget component
- [x] Replace icons in dossiers/+page (and remove "voir les cas d'usage" and "voir la matrice" buttons)
- [x] Replace icons in entreprises/+page (and remove "voir les détails" button)
- [x] Replace icons in UseCaseDetail component (and modify print/delete buttons)
- [x] Replace icons in StreamMessage component
- [x] Replace icons in other components (Toast, QueueMonitor, etc.)
- [x] Replace icons in auth pages (register, magic-link verify)
- [x] Replace icons in NavigationGuard, References components
- [x] Replace icons in matrice/+page.svelte
- [x] Replace icons in parametres/+page.svelte
- [x] Replace icons in dashboard/+page.svelte
- [x] Replace icons in ChatPanel component
- [x] Replace icons in UseCaseScatterPlot component
- [x] Test all changes (via make logs-ui)
- [ ] Verify CI passes

## Icon Inventory by View/Component

### Header.svelte
1. **Chevron down (user menu)** - Line 86-88
   - Current: SVG chevron down
   - Proposal: `ChevronDown` from Lucide

### ChatWidget.svelte
1. **Chat icon (main button)** - Line 147-159
   - Current: Custom SVG chat bubble with ellipsis
   - Proposal: `MessageCircle` or `MessageSquare` from Lucide
2. **Loading spinner** - Line 164-166
   - Current: SVG spinner
   - Proposal: `Loader2` (with animate-spin class) from Lucide
3. **Clock icon (active jobs badge)** - Line 171-173
   - Current: SVG clock
   - Proposal: `Clock` from Lucide
4. **X icon (failed jobs badge)** - Line 178-180
   - Current: SVG X
   - Proposal: `X` from Lucide
5. **Plus icon (new session)** - Line 221-223
   - Current: SVG plus
   - Proposal: `Plus` from Lucide
6. **Trash icon (delete session)** - Line 233-235
   - Current: SVG trash
   - Proposal: `Trash2` from Lucide
7. **Trash icon (purge my jobs)** - Line 244-246
   - Current: SVG trash
   - Proposal: `Trash2` from Lucide
8. **Minus icon (purge all jobs)** - Line 254-256
   - Current: SVG minus
   - Proposal: `Minus` from Lucide
9. **X icon (close button)** - Line 261-263
   - Current: SVG X
   - Proposal: `X` from Lucide

### dossiers/+page.svelte
1. **Document icon (voir les cas d'usage button)** - Line 253-255
   - Current: SVG document
   - Proposal: `FileText` from Lucide
   - **ACTION: REMOVE THIS BUTTON**
2. **Chart icon (voir la matrice button)** - Line 262-264
   - Current: SVG chart bars
   - Proposal: `BarChart3` from Lucide
   - **ACTION: REMOVE THIS BUTTON**
3. **Trash icon (delete folder)** - Line 272-274
   - Current: SVG trash
   - Proposal: `Trash2` from Lucide
4. **Document icon (use case count)** - Line 288-290
   - Current: SVG document
   - Proposal: `FileText` from Lucide

### entreprises/+page.svelte
1. **Eye icon (voir les détails button)** - Line 156-159
   - Current: SVG eye
   - Proposal: `Eye` from Lucide
   - **ACTION: REMOVE THIS BUTTON**
2. **Trash icon (delete company)** - Line 167-169
   - Current: SVG trash
   - Proposal: `Trash2` from Lucide
3. **Trash icon (delete company in enriching state)** - Line 128-130
   - Current: SVG trash
   - Proposal: `Trash2` from Lucide

### cas-usage/[id]/+page.svelte (UseCaseDetail actions)
1. **Print icon (print/export button)** - Line 206-208
   - Current: SVG printer (white on blue background)
   - Proposal: `Printer` from Lucide
   - **ACTION: Change to blue icon on transparent background**
2. **Trash icon (delete button)** - Line 215-217
   - Current: SVG trash (white on red background)
   - Proposal: `Trash2` from Lucide
   - **ACTION: Change to red stroke on transparent background (same as other trash buttons)**

### UseCaseDetail.svelte
1. **Check circle icon (Valeur calculée)** - Line 514-516
   - Current: SVG check circle
   - Proposal: `CheckCircle2` from Lucide
2. **Alert triangle icon (Complexité calculée)** - Line 539-541
   - Current: SVG alert triangle
   - Proposal: `AlertTriangle` from Lucide
3. **Clock icon (Délai)** - Line 569-571
   - Current: SVG clock
   - Proposal: `Clock` from Lucide
4. **Document icon (Description)** - Line 608-610
   - Current: SVG document
   - Proposal: `FileText` from Lucide
5. **Alert triangle icon (Problème)** - Line 645-647
   - Current: SVG alert triangle
   - Proposal: `AlertTriangle` from Lucide
6. **Lightbulb icon (Solution)** - Line 680-682
   - Current: SVG lightbulb
   - Proposal: `Lightbulb` from Lucide
7. **Trending up icon (Bénéfices)** - Line 719-721
   - Current: SVG trending up
   - Proposal: `TrendingUp` from Lucide
8. **Alert triangle icon (Risques)** - Line 760-762
   - Current: SVG alert triangle
   - Proposal: `AlertTriangle` from Lucide
9. **Bar chart icon (Mesures du succès)** - Line 799-801
   - Current: SVG bar chart
   - Proposal: `BarChart3` from Lucide
10. **Info icon (Informations)** - Line 843-845
    - Current: SVG info circle
    - Proposal: `Info` from Lucide
11. **Monitor icon (Technologies)** - Line 883-885
    - Current: SVG monitor
    - Proposal: `Monitor` from Lucide
12. **Database icon (Sources des données)** - Line 926-928
    - Current: SVG database/server
    - Proposal: `Database` from Lucide
13. **Check icon (data sources list items)** - Line 939-947
    - Current: SVG check
    - Proposal: `Check` from Lucide
14. **Database icon (Données)** - Line 976-978
    - Current: SVG database
    - Proposal: `Database` from Lucide
15. **Database icon (data objects list items)** - Line 989-997
    - Current: SVG database
    - Proposal: `Database` from Lucide
16. **Clipboard icon (Prochaines étapes)** - Line 1030-1032
    - Current: SVG clipboard
    - Proposal: `ClipboardList` from Lucide
17. **Check circle icon (Axes de Valeur)** - Line 1082-1084
    - Current: SVG check circle
    - Proposal: `CheckCircle2` from Lucide
18. **Alert triangle icon (Axes de Complexité)** - Line 1140-1142
    - Current: SVG alert triangle
    - Proposal: `AlertTriangle` from Lucide
19. **Star icons (rating stars)** - Multiple locations
    - Current: SVG star (filled/empty)
    - Proposal: `Star` (filled) and `Star` (outline) from Lucide
20. **X icon (complexity stars)** - Line 549-551, 1162-1164
    - Current: SVG X
    - Proposal: `X` from Lucide
21. **Minus icon (complexity stars empty)** - Line 553-555, 1166-1168
    - Current: SVG minus
    - Proposal: `Minus` from Lucide

### StreamMessage.svelte
1. **Chevron down icon (expand/collapse)** - Line 319-321, 338-345
   - Current: SVG chevron down
   - Proposal: `ChevronDown` from Lucide

### QueueMonitor.svelte
1. **Status icons (getStatusIcon function)** - Line 34
   - Current: Emoji/text icons
   - Proposal: Use appropriate Lucide icons based on status:
     - Pending: `Clock`
     - Processing: `Loader2` (animated)
     - Completed: `CheckCircle2`
     - Failed: `XCircle` or `AlertCircle`

### Toast.svelte
1. **Toast type icons (getIcon function)** - Line 22
   - Current: Emoji/text icons
   - Proposal: Use appropriate Lucide icons:
     - Success: `CheckCircle2`
     - Error: `XCircle` or `AlertCircle`
     - Warning: `AlertTriangle`
     - Info: `Info`

## Remaining SVG Icons (1 custom animation kept)

### Files with remaining SVG:
1. **ui/src/lib/components/UseCaseScatterPlot.svelte** - Custom loading animation SVG (3 animated circles) - **KEPT INTENTIONALLY** as it's a custom animation that cannot be replaced with a Lucide icon

## Commits & Progress
- [x] **Commit 1**: Replace icons in Header component
- [x] **Commit 2**: Replace icons in ChatWidget component
- [x] **Commit 3**: Replace icons in ChatPanel component
- [ ] **Commit 4**: Replace icons in StreamMessage component
- [ ] **Commit 5**: Replace icons in Toast component
- [ ] **Commit 6**: Replace icons in QueueMonitor component
- [ ] **Commit 7**: Replace icons in StarRating component
- [ ] **Commit 8**: Replace icons in References component
- [ ] **Commit 9**: Replace icons in NavigationGuard component
- [ ] **Commit 10**: Replace icons in UseCaseDetail component
- [ ] **Commit 11**: Replace icons in UseCaseScatterPlot component
- [ ] **Commit 12**: Replace icons in dossiers page and remove buttons
- [ ] **Commit 13**: Replace icons in entreprises page and remove button
- [ ] **Commit 14**: Replace icons in cas-usage/+page
- [ ] **Commit 15**: Replace icons in cas-usage/[id]/+page and modify buttons
- [ ] **Commit 16**: Replace icons in dashboard page
- [ ] **Commit 17**: Replace icons in matrice page
- [ ] **Commit 18**: Replace icons in parametres page
- [ ] **Commit 19**: Replace icons in auth/register page
- [ ] **Commit 20**: Replace icons in auth/magic-link/verify page

## Status
- **Progress**: In progress - Creating atomic commits
- **Remaining**: All files modified, ready for commits
- **Next**: Create commits one file at a time with BRANCH.md updates

