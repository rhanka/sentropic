---
description: "Version auditing, tech-debt tracking, component lifecycle"
alwaysApply: false
paths: [".components/**", "api/package.json", "ui/package.json"]
globs: [".components/**", "api/package.json", "ui/package.json"]
tags: [components]
---

# COMPONENTS

## Audit Process
1. **OS & Stack Audit**: `make audit-infra COMPONENT=<component>`
2. **Security Audit**: `make test-security-sca` (vulnerabilities only)
3. **Service Audit**: `make audit-<service> COMPONENT=<component>`
4. **Version Audit**: manual review using audit commands
5. **Prioritize**: Critical/High 1d, Medium 1w, Low 1m, Deprecated 1y
6. **Update**: create `feat/update-<component>-<version>` branch
7. **Validate**: follow workflow (see `workflow.mdc`)
8. **Document**: update `.components/tech-debt-<service>.md` and `TODO.md`

## Audit Commands

**Never** use direct `npm` or `pip` -- always use `make` targets.

```bash
# OS & Stack (Priority 1)
make audit-infra COMPONENT=docker|postgres|nginx|node|alpine

# Service-Specific (Priority 2)
make audit-api COMPONENT=hono|npm|node|drizzle-orm
make audit-ui COMPONENT=npm|svelte|vite

# Docker Images
make audit-infra COMPONENT=docker|postgres|nginx|node|alpine
```

## Current Base Images
- **Node.js**: `node:24-alpine` (api, ui)
- **Nginx**: `nginx:1.25-alpine` (ui production)
- **PostgreSQL**: `postgres:16` (database)

## Core Components to Monitor

### Frontend (ui/)
- Svelte, SvelteKit, Vite, TypeScript, Playwright

### Backend (api/)
- Node.js, Hono, Drizzle ORM, Vitest

### Infrastructure
- Docker, PostgreSQL, Nginx, Alpine Linux

## Priority Levels

| Priority | Timeframe | Trigger |
|----------|-----------|---------|
| Critical | 1 day | Security vulns, EOL versions, breaking core changes |
| High | 1 week | Major version updates, perf improvements |
| Medium | 1 month | Minor versions, bug fixes, dep updates |
| Low | 1 year | Patches, doc updates, deprecated features |

## Monitoring Cadence
- **Weekly**: `make test-security-sca`
- **Monthly**: `make audit-<service> COMPONENT=<component>` for core components
- **Quarterly**: full audit of all components

## Tech-Debt Tracking

```
.components/
  tech-debt-api.md      # Hono, Drizzle ORM, Node.js
  tech-debt-ui.md       # Svelte, Vite, TypeScript
  tech-debt-infra.md    # Docker, PostgreSQL, Nginx
```

### Benefits of Service-Specific Approach
- Independent lifecycles per service
- Focused priority assessment
- Clear team ownership
- Granular updates without cross-service impact

## Component Upgrade Process
1. Create branch: `feat/update-<component>-<version>`
2. Audit current state: `make audit-<service> COMPONENT=<component>`
3. Update component (package.json/Dockerfile)
4. Update `.components/tech-debt-<service>.md` with new version
5. Test thoroughly
6. Commit upgrade + tech-debt update atomically

## Tech-Debt Update Requirements
- **MANDATORY**: tech-debt files updated on every component upgrade
- **Same commit**: component upgrade and tech-debt update must be atomic
- **Version sync**: tech-debt current version must match actual component version
- **All tests must pass** before commit

## Temporary Security Exception Lifecycle
1. Document in `.security/vulnerability-register.yaml` with scope, justification, review date
2. Add remediation task in `TODO.md` and `.components/tech-debt-<service>.md`
3. Remove exception once upgrade done and `make test-<service>-security-container` passes

## Quality Gates
- Before upgrade: tech-debt reflects current state
- During upgrade: tech-debt updated with new version info
- After upgrade: tech-debt validated against actual versions
- Before commit: all tests pass, tech-debt current
- Before merge: tech-debt consistent across all services
