# Infrastructure Technical Debt

## Database & Cache Stack
| Component | Current | Latest | EOL | Breaking Change | Priority | Notes |
|-----------|---------|--------|-----|-----------------|----------|-------|
| postgres | 16 | (check) | no | (check) | (check) | To be audited |

## Base Images (OS)
| Component | Current | Latest | EOL | Breaking Change | Priority | Notes |
|-----------|---------|--------|-----|-----------------|----------|-------|
| alpine | (check) | (check) | no | (check) | (check) | To be audited |

---

**Priority Levels**: 1d (critical), 1w (high), 1m (medium), 1y (low/deprecated)  
**EOL**: End of Life - version no longer supported

## ⚠️ Breaking Changes Identified
- None identified yet (initial setup)

## 🔍 Breaking Change Assessment Required
Before updating these components:
1. **PostgreSQL updates**: Review for breaking changes in SQL syntax and extensions
2. **Docker updates**: Check for breaking changes in Docker Compose and image compatibility
3. **Test thoroughly**: Run all infrastructure tests after major version updates
4. **Update incrementally**: Consider updating one major component at a time

**Last Security Audit**: `make test-security-iac` + `make test-api-security-container` + `make test-ui-security-container` (automatic)  
**Last Version Audit**: 2025-11-06 (initial setup)  
**Next Version Audit**: 2025-11-13 (manual)

## Audit Commands
```bash
# Infrastructure-specific component audit (if implemented)
# Usage: make audit-infra COMPONENT=<component-type>
# Examples:
make audit-infra COMPONENT=docker
make audit-infra COMPONENT=postgres
make audit-infra COMPONENT=nginx

# Infrastructure-specific security audit
make test-security-iac
make test-api-security-container
make test-ui-security-container
```

