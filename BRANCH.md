# Feature: Dashboard Executive Summary Enhancement

## Objective
Transform the dashboard into an executive summary view with improved visualization, ROI quadrant (relative to medians), executive summary generation (automatic after use case completion), and DOCX report export capabilities.

## Scope
- **UI Changes**: Dashboard layout, scatter plot improvements, ROI quadrant, executive summary section, dashboard configuration accordion
- **API Changes**: New endpoint for executive summary generation (AI-powered), automatic generation after use case completion
- **Data Storage**: Executive summary stored in database (folders table), dashboard config in localStorage initially
- **No Breaking Changes**: Existing functionality remains intact

## Plan / Todo

### Phase 1: UI Improvements (Scatter Plot & Layout)
- [ ] **Task 1.1**: Adjust scatter plot to max 50% screen width and increase height
  - Modify `UseCaseScatterPlot.svelte` component styling
  - Update container classes to limit width (max 50%) and increase height
  - Test responsive behavior

- [ ] **Task 1.2**: Display use case labels directly on scatter plot (no hover required)
  - Modify Chart.js configuration to show labels by default
  - Adjust label positioning to avoid overlaps
  - Ensure labels are readable

- [ ] **Task 1.3**: Update tooltip to show description, value, and complexity (not status)
  - Modify tooltip callbacks in `UseCaseScatterPlot.svelte`
  - Display: description, value score, complexity score
  - Remove status from tooltip

### Phase 2: ROI Quadrant (Relative to Medians)
- [ ] **Task 2.1**: Calculate medians for value and complexity scores
  - Calculate median value score from all use cases
  - Calculate median complexity score from all use cases
  - Only display quadrant if > 2 use cases exist

- [ ] **Task 2.2**: Add ROI quadrant visualization (top-left quadrant, green)
  - Design ROI quadrant overlay on scatter plot (value > median, complexity < median)
  - Identify use cases in ROI quadrant (high value, low complexity)
  - Add visual indicator (green background/shading) for ROI quadrant
  - Hide quadrant if ≤ 2 use cases

- [ ] **Task 2.3**: Add ROI statistics card
  - Create new KPI card showing count of use cases in ROI quadrant
  - Display average value and complexity for ROI quadrant
  - Position in dashboard layout

- [ ] **Task 2.4**: Create dashboard configuration accordion
  - Add accordion component above dashboard with gear icon (⚙️) on the right
  - Store configuration in localStorage (initialized to median values)
  - Allow configuration of ROI quadrant boundaries (value/complexity thresholds)
  - Configuration will be stored in backend later (not in this phase)

### Phase 3: Executive Summary Generation
- [ ] **Task 3.1**: Add executive summary prompt to default-prompts.ts
  - Create prompt template with 5 markdown sections:
    - Introduction
    - Analyse
    - Top cas
    - Recommandation (including prochaines étapes)
    - Synthèse exécutive
  - Prompt takes: use cases, company info (if available), folder info
  - Return JSON with 5 markdown sections

- [ ] **Task 3.2**: Create API endpoint for executive summary generation
  - New endpoint: `POST /api/v1/analytics/executive-summary`
  - Input: `folder_id`
  - Fetch folder description, company context, and all use cases
  - Generate prompt for OpenAI with all context
  - Return JSON with 5 markdown sections
  - Store result in database (folders table - new field `executive_summary`)

- [ ] **Task 3.3**: Add database field for executive summary
  - Add `executive_summary` JSON field to folders table (migration)
  - Store JSON with 5 sections: { introduction, analyse, top_cas, recommandation, synthese_executive }

- [ ] **Task 3.4**: Integrate automatic generation after use case completion
  - Modify `QueueManager.processUseCaseDetail` to check if all use cases are completed
  - When all use cases completed, automatically trigger executive summary generation
  - Add new job type: `executive_summary` to queue
  - Update folder status to show executive summary generation in progress

- [ ] **Task 3.5**: Add UI component for executive summary display
  - Create `ExecutiveSummary.svelte` component
  - Display sections in order: Synthèse exécutive, Introduction, Analyse, Recommandations
  - Show loading state when generating
  - Add manual "Generate Summary" button for historical folders without summary
  - Position: Synthèse exécutive FIRST, then Dashboard, then Introduction/Analyse/Recommandations

### Phase 4: Report Generation (DOCX)
- [ ] **Task 4.1**: Install and configure docx library
  - Add `docx` npm package to API
  - Add `pizzip` and `docx-preview` if needed for PDF conversion
  - Or use `docx` with separate PDF conversion library

- [ ] **Task 4.2**: Create report template structure
  - Page de garde: folder name, company name (if available), report date
  - Deuxième page: Synthèse exécutive
  - Troisième page: Sommaire (table of contents)
  - Introduction section
  - One page per use case (all details)
  - Dashboard section (screenshot or description)
  - Analyse section
  - Recommandations section

- [ ] **Task 4.3**: Implement report generation logic
  - Create service to generate DOCX report
  - Use docx library to build structured document
  - Include all sections from template
  - Generate downloadable DOCX file
  - Add option to export as PDF (convert DOCX to PDF)

- [ ] **Task 4.4**: Add report export UI
  - Add "Export Report" button in dashboard
  - Show loading state during generation
  - Download DOCX file
  - Option to download as PDF

### Phase 5: Testing & Validation
- [ ] **Task 5.1**: Update unit tests for new API endpoint
  - Test executive summary generation endpoint
  - Test error handling
  - Test with various folder/company combinations
  - Test automatic generation trigger

- [ ] **Task 5.2**: Update E2E tests for dashboard
  - Test scatter plot improvements
  - Test ROI quadrant display (with > 2 use cases and ≤ 2 use cases)
  - Test dashboard configuration accordion
  - Test executive summary generation flow (automatic and manual)
  - Test report export (DOCX and PDF)

- [ ] **Task 5.3**: Manual testing and validation
  - Verify all UI changes work correctly
  - Test responsive design
  - Validate AI-generated summaries quality
  - Test report generation and formatting

## Commits & Progress
- [x] **Initial commit**: Branch creation and BRANCH.md

## Status
- **Progress**: 1/20 tasks completed
- **Current**: Starting Phase 1 - UI improvements
- **Next**: Task 1.1 - Adjust scatter plot dimensions

## Specifications Confirmed

### ROI Quadrant
- **Boundaries**: Relative to medians (value > median AND complexity < median)
- **Display**: Only if > 2 use cases exist
- **Configuration**: Stored in localStorage initially, configurable via accordion with gear icon
- **Visual**: Green background/shading for top-left quadrant

### Executive Summary
- **Format**: JSON with 5 markdown sections:
  - `introduction` (markdown)
  - `analyse` (markdown)
  - `top_cas` (markdown)
  - `recommandation` (markdown, includes prochaines étapes)
  - `synthese_executive` (markdown)
- **Storage**: JSON field in folders table
- **Generation**: Automatic after all use cases completed, manual button for historical folders
- **UI Order**: Synthèse exécutive FIRST, then Dashboard, then Introduction/Analyse/Recommandations

### Report
- **Format**: DOCX (primary), with PDF option
- **Library**: npm `docx` package
- **Structure**:
  1. Page de garde (folder name, company, date)
  2. Synthèse exécutive
  3. Sommaire
  4. Introduction
  5. One page per use case
  6. Dashboard
  7. Analyse
  8. Recommandations

### Dashboard Configuration
- **UI**: Accordion above dashboard with gear icon (⚙️) on right
- **Storage**: localStorage initially (no DB changes in this phase)
- **Initial Values**: Median-based thresholds
- **Future**: Will be stored in backend (not in this phase)

## Technical Notes

- **UI Framework**: SvelteKit 5 with Tailwind CSS
- **Chart Library**: Chart.js (already in use)
- **API Framework**: Hono with TypeScript
- **AI Service**: OpenAI Node.js SDK (existing integration)
- **Report Library**: docx (npm package)
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Database**: PostgreSQL 16 with Drizzle ORM

## Dependencies
- `docx` - DOCX report generation
- May need PDF conversion library (to be determined)
- OpenAI service already available

