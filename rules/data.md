---
description: "Schema evolution, migrations, PostgreSQL, Drizzle ORM, backup/recovery"
alwaysApply: false
paths: ["api/src/db/**", "api/drizzle/**", "spec/DATA_MODEL.md"]
globs: ["api/src/db/**", "api/drizzle/**", "spec/DATA_MODEL.md"]
tags: [database, migrations, drizzle]
---

# DATABASE MANAGEMENT

## Architecture
- **Database**: PostgreSQL 17 (Docker volume: `pg_data`)
- **ORM**: Drizzle ORM with TypeScript (`drizzle-orm/node-postgres`)
- **Migration Tool**: Drizzle Kit
- **Schema Location**: `api/src/db/schema.ts`
- **Migration Files**: `api/drizzle/`
- **Connection**: `DATABASE_URL` env var

## Core Tables
- `companies` -- company profiles and metadata
- `folders` -- project folders with matrix configuration
- `use_cases` -- AI use cases with scoring data
- `settings` -- application configuration and prompts
- `business_config` -- business sectors and processes
- `sessions` -- user authentication sessions
- `job_queue` -- async job processing queue

## Data Model Diagrams
- ERD (Mermaid) documented in `spec/DATA_MODEL.md` (source of truth aligned with `api/src/db/schema.ts`)
- If Drizzle schema changes, update `spec/DATA_MODEL.md`

## Schema Conventions
- **Primary Keys**: UUID strings
- **Timestamps**: ISO strings with `CURRENT_TIMESTAMP` default
- **JSON Fields**: PostgreSQL JSONB
- **Foreign Keys**: proper references with cascade deletes
- **Naming**: snake_case for columns, camelCase for TypeScript

## Migration Workflow
1. Modify schema: `api/src/db/schema.ts`
2. Generate migration: `make db-generate`
3. Review generated SQL in `api/drizzle/`
4. Apply migration: `make db-migrate`
5. Test changes

## Migration Commands (Make only)
- `make db-generate` -- generate migration files from schema changes
- `make db-migrate` -- apply pending migrations
- `make db-reset` -- drop + recreate + migrate
- `make db-init` -- initialize with all migrations
- `make db-status` -- check status and table structure
- `make db-seed` -- populate with sample data

## Production Migration Strategy
1. Backup first: `make db-backup`
2. Test on staging
3. Keep backup for rollback
4. Monitor health after migration
5. Verify: `make db-status`

## Schema Evolution Rules

### Safe Changes (no migration needed)
- Adding nullable columns, new tables, new indexes, new constraints on new data

### Breaking Changes (require migration)
- Renaming columns/tables, changing column types, dropping columns/tables
- Adding NOT NULL to existing columns, changing primary keys

## Migration Best Practices
- **Atomic**: one logical change per migration
- **Backward compatible**: maintain compatibility during transitions
- **Data migration**: include data transformation in scripts
- **Validation**: add integrity checks
- **Single migration per branch**: only one `api/drizzle/*.sql` per branch; patch down to a single final migration before completion

## Backup & Recovery
- **Backup**: `make db-backup` (pg_dump)
- **Restore**: `make db-restore BACKUP_FILE=filename`
- Recovery: stop app, restore, verify schema (`make db-status`), run tests, restart

## Data Integrity
- **Type Safety**: Drizzle provides TypeScript types
- **Runtime Validation**: Zod schemas for API endpoints
- **Required Fields**: enforce NOT NULL constraints
- **Foreign Keys**: maintain referential integrity
- **JSON Validation**: validate in application layer
- **Business Rules**: implement in application logic, not database

## Development Guidelines
- Docker volume `pg_data` for local dev
- Use `make db-reset` for clean state, `make db-seed` for test data
- Separate test database via `DATABASE_URL` override
- Add indexes for frequently queried columns
- Use connection pooling (node-postgres pool)
- Monitor slow queries with EXPLAIN ANALYZE

## Troubleshooting
- **Migration conflicts**: regenerate migrations
- **Schema drift**: `make db-status`
- **Connection issues**: verify `DATABASE_URL` and PostgreSQL service health
- **Debug**: `make db-status`, `make logs-db`, `make sh-api`

## Feature Development Integration
1. Document schema changes in BRANCH.md
2. Test migrations before committing
3. Backup before major schema changes
4. CI runs migrations on test database
