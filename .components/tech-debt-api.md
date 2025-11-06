# API Service Technical Debt

## Backend Stack (api/)
| Component | Current | Latest | EOL | Breaking Change | Priority | Notes |
|-----------|---------|--------|-----|-----------------|----------|-------|
| hono | 4.3.7 | 4.10.2+ | no | no | 1w | ⚠️ Security: CVE-2025-62610 (JWT aud verification) - update to 4.10.2+ |
| drizzle-orm | 0.36.4 | (check) | no | (check) | (check) | To be audited |
| drizzle-kit | 0.28.1 | (check) | no | (check) | (check) | To be audited |
| vitest | 1.6.1 | (check) | no | (check) | (check) | To be audited |
| typescript | 5.4.5 | (check) | no | (check) | (check) | To be audited |
| node | 24 | 24 | no | no | none | LTS version |

## Base Images
| Component | Current | Latest | EOL | Breaking Change | Priority | Notes |
|-----------|---------|--------|-----|-----------------|----------|-------|
| node | 24-alpine | (check) | no | (check) | (check) | To be audited |
| alpine | (check) | (check) | no | (check) | (check) | To be audited |

---

**Priority Levels**: 1d (critical), 1w (high), 1m (medium), 1y (low/deprecated)  
**EOL**: End of Life - version no longer supported

## ⚠️ Breaking Changes Identified
- **Hono**: ⚠️ 4.9.10 → 4.10.2+ (Security update required - CVE-2025-62610)

## 🔍 Breaking Change Assessment Required
Before updating these components:
1. **Hono updates**: Review for breaking changes in JWT middleware and API
2. **Drizzle ORM updates**: Check for breaking changes in schema and query API
3. **Test thoroughly**: Run all API tests after major version updates
4. **Update incrementally**: Consider updating one major component at a time

**Last Security Audit**: `make test-api-security-sca` (automatic)  
**Last Version Audit**: 2025-11-06 (initial setup)  
**Next Version Audit**: 2025-11-13 (manual)

## Audit Commands
```bash
# API-specific component audit (if implemented)
# Usage: make audit-api COMPONENT=<component-type>
# Examples:
make audit-api COMPONENT=hono
make audit-api COMPONENT=npm
make audit-api COMPONENT=node
make audit-api COMPONENT=drizzle-orm

# API-specific security audit
make test-api-security-sca
```

