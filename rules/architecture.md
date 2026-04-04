---
description: "Tech stack, architecture diagram, storage, AI, CI/CD, language policy"
alwaysApply: false
paths: ["api/src/**", "ui/src/**", "docker-compose*.yml"]
globs: ["api/src/**", "ui/src/**", "docker-compose*.yml"]
tags: [architecture, boundaries]
---

# ARCHITECTURE

## Tech Stack
- **UI**: SvelteKit 5 (`ui/`) -- bilingual FR/EN (FR-first, EN to-be), i18n, static build, Tailwind CSS
- **API**: Hono + TypeScript (`api/`) -- REST/OpenAPI, Drizzle ORM
- **Database**: PostgreSQL 17 + Make targets for Drizzle ORM -- Docker volume persistence
- **Queue**: Custom PostgreSQL-based job queue with QueueManager (no external libs)
- **AI**: OpenAI integration via Node.js (no separate Python service)
- **Tests**: Make targets + Vitest (unit/integration) + Playwright (E2E)
- **Security**: OIDC sessions (Google/LinkedIn), human approval on critical actions
- **CI/CD**: Make for local dev, GitHub Actions (based on make targets) for automation
- **Dev environment**: Docker Compose with volume mounts
- **Prod environment**: Scaleway Container Serverless (to-be)

## Architecture Diagram

```mermaid
flowchart TB
    subgraph "Browser"
        User[User]
    end
    subgraph "Frontend"
        UI["SvelteKit 5 UI<br/>Tailwind CSS<br/>i18n EN/FR"]
    end
    subgraph "Backend Services"
        API["Hono API<br/>TypeScript<br/>REST/OpenAPI"]
        AI["OpenAI Integration<br/>Node.js SDK"]
    end
    subgraph "Data Layer"
        DB[("PostgreSQL 17")]
        Queue["Custom PostgreSQL Queue<br/>QueueManager"]
    end
    subgraph "External Services"
        OpenAI["OpenAI API<br/>GPT Models"]
        OIDC["OIDC Providers<br/>Google/LinkedIn"]
    end

    User --> UI
    UI -->|REST/JSON| API
    API --> AI
    AI --> OpenAI
    API --> DB
    API --> Queue
    Queue --> AI
    API -->|OIDC Auth| OIDC

    style UI fill:#e1f5fe
    style API fill:#f3e5f5
    style DB fill:#e8f5e8
```

## Bilingual Policy
- FR-first for user-facing content, EN to-be
- All code, comments, commit messages, and technical docs in English

## WARNING: No Generic UI Abstractions Without Spec

NEVER create generic UI abstractions (ViewTemplateRenderer, generic widget system, etc.) without:
1. A user-validated prototype or mockup
2. A concrete UI spec showing before/after screens
3. Preservation of existing working components (EditableInput, cards, StreamMessage, comments, field types)

**Incident context**: ViewTemplateRenderer was created as a "generic rendering infra" that replaced the existing design (editable cards, streaming, comments, markdown/list types) with a raw JSON renderer. The result was unusable and required complete eradication. If a template system is needed, it must USE existing components, not replace them.
