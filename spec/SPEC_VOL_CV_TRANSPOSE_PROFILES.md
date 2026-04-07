# SPEC VOL — CV Transpose & Profile Management (BR-21)

Status: Intent (2026-03-23)

## User vision (raw)

Workflow de traduction/transposition de CV avec gestion de profils :
- Les dossiers associés seront des folders dans un workspace
- Les objets seront d'un nouveau type : `profile` (ou `person`) — notion de ressource pouvant être incluse dans un proposal (réponse AO), pas d'une personne cliente
- Pour un dossier donné : uploader un ensemble de CVs, créer les profils associés, générer les CVs selon template
- Le usecase doit être géré rapidement — soit juste après BR-20, soit plus vite

## Reference implementation

Existing Python CLI in `/home/antoinefa/src/scalian-transpose-cv`:
- `scalian_xml.py` (364 lines) — OOXML builders for Scalian CV format (section headers, skill bullets, job entries, education, languages)
- `scalian_docx_tools.py` (342 lines) — DOCX unpack/pack/validate (ZIP, XML parsing, font stripping)
- `Scalian_Template.docx` — Scalian branded template with embedded fonts, custom header
- `CLAUDE.md` — Complete spec with rules, examples, escaping requirements
- 14 profiles generated (7 nominative Elinext, 7 anonymized Scalo) in `outputs/`
- Pipeline: PDF/DOCX → pdftotext/pandoc → LLM extraction → Python OOXML generation → DOCX pack

## Profile data model (from reference)

A profile contains:
- **Header**: name, title (2 lines), years of experience
- **Technical skills**: 5-7 descriptive bullets (label + description with duration)
- **Sector-specific skills**: sectors (3-5 categories with sub-items) + domains (3-5 categories with sub-items)
- **Work experience**: chronological reverse list of positions (company, description, dates, title, tasks, achievements, tech environment)
- **Languages**: language + level pairs
- **Education/certification**: year + description pairs

## Workflow in top-ai-ideas

1. User creates a folder (= a batch of CVs for an RFP response)
2. User uploads source CVs (PDF/DOCX) into the folder
3. Generation: for each CV → text extraction → LLM structures the profile → `profile` object created
4. User reviews/edits each profile in the UI (structured data, not free text)
5. Export: generate formatted DOCX from profile data (Scalian template or custom)
6. Optional: attach profiles to a proposal object (extended objects from BR-04B)

## Relationship to other objects

- Profile is a **resource** (human resource with skills/experience)
- Profile can be **included in a proposal** (the proposal references profiles for staffing)
- Profile can be **linked to initiatives** (the person works on initiative X)
- The `profile` vs `person` naming: `profile` preferred (it's the CV/competency view of a person, not the person entity itself)

## Dependencies

- BR-04B (view templates, extended objects, workflows) — prerequisite
- BR-20 (workspace neutral) — NOT a hard prerequisite. Can use current workspace types with a `cv-transpose` type, or run in an `opportunity` workspace.
- scalian_xml.py + scalian_docx_tools.py — to be imported or ported to Node.js
