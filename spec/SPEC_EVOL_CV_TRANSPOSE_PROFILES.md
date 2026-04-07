# SPEC EVOL - CV Transpose & Profile Management (BR-21)

Status: Draft (2026-03-23)

## 1) Objective

Deliver a CV transpose workflow within top-ai-ideas: upload source CVs (PDF/DOCX), extract structured profile data via officeparser + LLM, allow user editing, and export formatted DOCX/PPTX. Profiles are first-class entities stored in a dedicated `profiles` table, attachable to proposals for staffing purposes.

Key capabilities:
- **Template generation from example**: user uploads a target CV example (DOCX or PPTX) → system analyzes structure/formatting → generates a reusable template automatically.
- **PPTX export**: in addition to DOCX, generate one-page PPTX CVs using `pptxgenjs`.
- **Batch export**: export all profiles in a folder as DOCX/PPTX in one click (ZIP download).
- **Profile synthesis report**: folder-level "dashboard" analyzing the profiles pool (skills distribution, experience coverage, seniority mix, gaps).
- **Proposal integration**: attach profiles to proposals with role/allocation, adapt the qualification workflow to include staffing step.

## 2) Scope

### In scope

- **Dedicated `profiles` table** with structured JSON data model (not initiatives with objectType).
- **CV transpose workflow**: upload CVs → officeparser text extraction → LLM structuring → profile creation → user edit → DOCX/PPTX export.
- **DOCX generation**: port `scalian_xml.py` + `scalian_docx_tools.py` OOXML builders to Node.js using `jszip`.
- **PPTX generation**: add `pptxgenjs` for one-page CV slides. Support generating a PPTX template from an uploaded example PPTX.
- **Template generation from example**: upload a target CV (DOCX or PPTX) → LLM analyzes structure → generates a reusable template descriptor (section mapping, styles, layout).
- **Profile editor UI**: structured data editing (skills, experience, education, languages) using template-driven rendering.
- **Batch export**: folder-level bulk export of all profiles as DOCX/PPTX (ZIP download).
- **Profile synthesis report**: folder-level dashboard/report analyzing the profile pool (skills distribution, experience heatmap, seniority mix, gaps). Generated as a `folder_report` object (see BR-20 spec).
- **Proposal integration**: link profiles to proposals with role/allocation. Adapt the qualification workflow to include a staffing step.
- **Template management**: upload/manage DOCX and PPTX templates for profile export.

### Out of scope

- Workspace type changes (BR-20 concern).
- Agent sandbox / skill catalog (BR-19).
- Multi-language DOCX generation (French variant deferred to post-MVP).
- Anonymization workflows (deferred — reference impl supports it but not MVP).
- Batch processing UI (conductor/sub-agent pattern stays CLI-side for now).

## 3) Profile data model

### 3.1 `profiles` table (SQL)

```sql
CREATE TABLE profiles (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  folder_id text NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  source_document_id text REFERENCES context_documents(id),  -- link to uploaded CV
  status text NOT NULL DEFAULT 'draft',  -- 'draft' | 'extracting' | 'completed' | 'failed'
  model text,                             -- LLM model used for extraction
  job_id text REFERENCES job_queue(id) ON DELETE SET NULL,  -- extraction job
  data jsonb NOT NULL DEFAULT '{}',       -- structured profile (see 3.2)
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);
CREATE INDEX profiles_workspace_id_idx ON profiles(workspace_id);
CREATE INDEX profiles_folder_id_idx ON profiles(folder_id);
CREATE INDEX profiles_status_idx ON profiles(status);
```

### 3.2 Profile JSON structure (`data` column)

```typescript
interface ProfileData {
  // Header
  header: {
    name: string;               // Full name (or "Candidate XXXXX" if anonymized)
    titleLine1: string;         // Role line 1 (e.g. "DevOps / Platform")
    titleLine2: string;         // Role line 2 (e.g. "Engineer")
    yearsOfExperience: number;  // Total years
  };

  // Technical skills (5-7 descriptive bullets)
  technicalSkills: Array<{
    label: string;              // Category label (e.g. "Cloud & Infrastructure:")
    description: string;        // Descriptive text (verbose, not just tool lists)
    duration?: string;          // e.g. ">5y" (optional)
  }>;

  // Sector-specific skills
  sectorSkills: {
    sectors: Array<{
      name: string;             // Sector category (e.g. "Banking & Finance")
      items: string[];          // Sub-items
    }>;
    domains: Array<{
      name: string;             // Domain category (e.g. "IT Governance")
      items: string[];          // Sub-items
    }>;
  };

  // Work experience (reverse chronological)
  workExperience: Array<{
    company: string;            // "Company — Location"
    description: string;        // Context one-liner
    dates: string;              // "MM/YYYY — MM/YYYY"
    title: string;              // Job title
    tasks: string[];            // 3-6 action verb items
    achievements: string[];     // 0-3 quantified items (optional)
    techEnvironment: string;    // Comma-separated tech stack
  }>;

  // Languages
  languages: Array<{
    language: string;           // e.g. "English"
    level: string;              // e.g. "Fluent", "Native", "B2"
  }>;

  // Education / Certification (reverse chronological)
  education: Array<{
    year: string;               // e.g. "2020"
    description: string;        // "Degree — Institution"
  }>;
}
```

### 3.3 `proposal_profiles` junction table

```sql
CREATE TABLE proposal_profiles (
  id text PRIMARY KEY,
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text,                    -- role label in the proposal context (nullable)
  data jsonb NOT NULL DEFAULT '{}',  -- rate, allocation, notes
  created_at timestamp NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_id, profile_id)
);
CREATE INDEX proposal_profiles_proposal_id_idx ON proposal_profiles(proposal_id);
CREATE INDEX proposal_profiles_profile_id_idx ON proposal_profiles(profile_id);
```

### 3.4 `profile_templates` table

```sql
CREATE TABLE profile_templates (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  template_data bytea NOT NULL,  -- DOCX template binary
  config jsonb NOT NULL DEFAULT '{}',  -- section mapping, font preferences
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);
CREATE INDEX profile_templates_workspace_id_idx ON profile_templates(workspace_id);
```

## 4) Workflow design

### 4.1 Upload flow

1. User navigates to a folder in a workspace.
2. User clicks "Upload CVs" and selects one or more PDF/DOCX files.
3. For each file: `POST /api/v1/documents` (existing endpoint) stores the file in S3/MinIO, creates a `context_documents` row.
4. User clicks "Create Profiles" (or auto-triggered after upload).
5. `POST /api/v1/profiles/extract` with `{ folderId, documentIds: [...] }`.

### 4.2 Extraction pipeline

For each document:
1. **Text extraction**: `@llamaindex/liteparse` extracts text with spatial layout awareness from the PDF/DOCX bytes.
2. **LLM structuring**: Send extracted text to the configured LLM with a structured output prompt requesting the `ProfileData` JSON schema. Use Zod schema for validation.
3. **Profile creation**: Insert into `profiles` table with `status='completed'` and the structured `data`.
4. **Error handling**: If extraction or LLM fails, set `status='failed'` with error details in `data.error`.

Job queue integration: extraction runs as a `profile_extract` job type in the existing `job_queue` system.

### 4.3 API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/profiles/extract` | Trigger extraction from uploaded documents |
| `GET` | `/api/v1/profiles` | List profiles (filterable by folderId, workspaceId) |
| `GET` | `/api/v1/profiles/:id` | Get single profile with full data |
| `PUT` | `/api/v1/profiles/:id` | Update profile data (user edits) |
| `DELETE` | `/api/v1/profiles/:id` | Delete profile |
| `POST` | `/api/v1/profiles/:id/export` | Generate DOCX from profile data |
| `GET` | `/api/v1/profiles/:id/export/:exportId` | Download generated DOCX |
| `POST` | `/api/v1/proposals/:id/profiles` | Attach profile to proposal |
| `DELETE` | `/api/v1/proposals/:id/profiles/:profileId` | Detach profile from proposal |
| `GET` | `/api/v1/proposals/:id/profiles` | List profiles attached to a proposal |
| `GET` | `/api/v1/profile-templates` | List available DOCX templates |
| `POST` | `/api/v1/profile-templates` | Upload a new DOCX template |
| `DELETE` | `/api/v1/profile-templates/:id` | Delete a template |

### 4.4 Export flow

1. User clicks "Export DOCX" on a profile.
2. `POST /api/v1/profiles/:id/export` with `{ templateId }`.
3. Server-side:
   a. Load profile data + template DOCX.
   b. Unpack template ZIP (using `jszip`).
   c. Build OOXML paragraphs from profile data (ported from `scalian_xml.py`).
   d. Replace `document.xml` content with generated paragraphs.
   e. Update `header2.xml` with profile header info.
   f. Pack and return DOCX.
4. Generated DOCX stored temporarily or streamed directly.

## 5) Text extraction (officeparser — kept)

`officeparser@6.0.7` is used in `api/src/services/document-text.ts`. Benchmark (2026-03-24) concluded keeping officeparser over `@llamaindex/liteparse`:
- officeparser: stable (271K dl/week), 8 native formats, rich metadata, AST structure, zero system deps
- liteparse: too new (v1.0 3 days old), requires LibreOffice, minimal metadata, no structure

No changes to text extraction in BR-21. The existing pipeline is sufficient for CV parsing.

## 5b) PPTX generation (new — pptxgenjs)

Add `pptxgenjs` to API dependencies for generating one-page CV slides.

### 5b.1 Template from example

User uploads an example PPTX (one-page CV). The system:
1. Parses the PPTX structure (slide dimensions, text boxes positions, fonts, colors).
2. LLM maps each text zone to a profile field (name, title, skills, experience, etc.).
3. Generates a `profile_template` descriptor (JSON) that maps profile fields to slide positions.

### 5b.2 PPTX generation flow

1. Load profile data + PPTX template descriptor.
2. Create slide using `pptxgenjs` with the template dimensions/layout.
3. Fill text boxes with profile data according to the mapping.
4. Return PPTX binary.

## 5c) Profile synthesis report (folder-level dashboard)

A folder containing profiles can generate a synthesis report analyzing the pool:
- Skills distribution: most common technical skills, coverage gaps
- Experience heatmap: seniority distribution, industry coverage
- Language coverage
- Education/certification summary

Generated as a report object (similar to executive summary for initiatives). Displayed in the folder view as a dashboard tab or section.

## 6) DOCX generation (porting strategy from Python)

### 6.1 Reference implementation

- `scalian_xml.py` (364 lines): OOXML paragraph builders using raw XML string concatenation. Functions: `section_header()`, `skill_bullet()`, `sector_category()`, `sector_item()`, `job_entry()`, `education_line()`, `update_header()`, `assemble_document()`.
- `scalian_docx_tools.py` (342 lines): DOCX unpack/pack/validate using Python `zipfile` + `xml.etree.ElementTree`.

### 6.2 Porting approach: Node.js OOXML builders

Port `scalian_xml.py` functions to TypeScript as `api/src/services/profile-docx.ts`:

- Each Python function becomes a TypeScript function producing OOXML XML strings.
- Use `jszip` (already in dependencies) for DOCX unpack/pack (replaces `scalian_docx_tools.py`).
- Template unpacking: `jszip.loadAsync(templateBuffer)` -> modify `word/document.xml` and `word/header2.xml` -> `zip.generateAsync()`.
- XML escaping: dedicated `escapeXml()` utility (handles `&`, `<`, `>`, em-dash, accented chars).

### 6.3 Alternative considered: `docx` npm package

The `docx@9.5.1` package (already in dependencies) generates DOCX programmatically but uses a high-level API that may not reproduce exact Scalian template formatting (specific fonts, colors, numbering styles). The raw OOXML approach from `scalian_xml.py` is more faithful to the template.

Decision: use raw OOXML string builders (ported from Python) + `jszip` for packing. Keep `docx` npm for other DOCX generation needs (reports, etc.).

### 6.4 Template management

- Default template: bundled Scalian template (committed as `api/assets/profile-templates/default.docx`).
- Custom templates: uploaded via `/api/v1/profile-templates` endpoint, stored in `profile_templates` table.
- Template requirements: must contain `word/document.xml` and `word/header2.xml` with expected placeholder patterns.

## 7) UI design

### 7.1 Upload flow

- Folder page: "Upload CVs" button (accepts multiple PDF/DOCX files).
- Upload progress bar per file.
- After upload: "Create Profiles" action button that triggers extraction for all uploaded documents without existing profiles.
- Extraction progress: status badges per document (extracting -> completed / failed).

### 7.2 Profile editor

Structured data widgets (not free-text editing):

- **Header section**: editable text fields for name, title (2 lines), years of experience.
- **Technical skills**: sortable list of {label, description, duration} items. Add/remove/reorder.
- **Sector skills**: two sub-sections (Sectors, Domains), each with nested lists. Add/remove categories and items.
- **Work experience**: sortable list of job entries. Each entry expands to show company, description, dates, title, tasks (editable list), achievements (editable list), tech environment.
- **Languages**: simple key-value list.
- **Education**: sortable list of {year, description} items.

All fields auto-save on blur (existing pattern in the app).

### 7.3 Profile list view

- Table/card view in folder page under a "Profiles" tab.
- Columns: name, title, years of experience, status, source document, created date.
- Actions: view/edit, export DOCX, delete, attach to proposal.

### 7.4 DOCX export

- "Export" button on profile card/detail page.
- Template selector dropdown (default + custom templates).
- Download triggered after generation.

### 7.5 Bid integration UI

- Bid detail page: "Staffing" section listing attached profiles.
- "Add Profile" button opens a picker (profiles in the same workspace).
- Role and allocation fields per attached profile.

## 8) Dependencies and sequencing

### Hard prerequisites

- **BR-04B** (extended objects: proposals, products, solutions, view templates, workflows) — must be merged. Profiles depend on `proposals` table for proposal integration and on the extended object patterns.

### Soft prerequisites (nice-to-have but not blocking)

- **BR-20** (workspace neutral refactor) — NOT required. Profiles work within current workspace type system. A folder in an `opportunity` workspace can contain profiles. Post BR-20, profiles would work in any workspace.
- **BR-19** (agent sandbox + skills) — NOT required. Profile extraction uses the existing job queue + LLM service. Post BR-19, the extraction pipeline could be exposed as a skill.

### Independent of

- BR-06 (Chrome extension / CSP).
- BR-09 (SSO Google).
- BR-14 (Chat modularization).

### Impact on other branches

- BR-20: the `profiles` table is independent and does not conflict. BR-20 may later add `objectType` to profiles if needed.
- BR-17 (RAG): profile documents contribute to the document corpus. No conflict.

## 9) Open questions

- `Q1`: ~~LiteParse~~ **Resolved: keep officeparser.** Benchmark 2026-03-24 concluded liteparse too immature.
- `Q2`: **Template portability** — The Scalian template uses Cambria font and specific OOXML numbering definitions. Abstract the OOXML builders to read numbering IDs from the template.
- `Q3`: **Profile versioning** — Simple overwrite for MVP, versioning deferred.
- `Q4`: ~~Batch export deferred~~ **Resolved: in scope.** Folder-level bulk export as ZIP.
- `Q5`: **Profile data validation** — Lenient (accept partial) with UI warnings. LLM output can be incomplete.
- `Q6`: **Full port to Node.js** (no Python subprocess). `jszip` for DOCX, `pptxgenjs` for PPTX.
- `Q7`: **Template from example** — LLM analyzes uploaded example CV to map text zones to profile fields. How accurate can this be? May need manual correction of the generated mapping.
- `Q8`: **PPTX template** — One-page CV slide. How to handle varying content lengths (long experience list)? Truncate or scale font?
