# UI Service Technical Debt

## Frontend Stack (ui/)
| Component | Current | Latest | EOL | Breaking Change | Priority | Notes |
|-----------|---------|--------|-----|-----------------|----------|-------|
| @sveltejs/kit | 2.43.5 | (check) | no | (check) | (check) | To be audited |
| svelte | 5.0.0 | (check) | no | (check) | (check) | To be audited |
| vite | 6.3.0 | (check) | no | (check) | (check) | To be audited |
| typescript | 5.4.5 | (check) | no | (check) | (check) | To be audited |
| vitest | 1.5.0 | (check) | no | (check) | (check) | To be audited |

## Base Images
| Component | Current | Latest | EOL | Breaking Change | Priority | Notes |
|-----------|---------|--------|-----|-----------------|----------|-------|
| node | 24-alpine | (check) | no | (check) | (check) | To be audited |
| alpine | (check) | (check) | no | (check) | (check) | To be audited |
| nginx | 1.29-alpine | 1.29-alpine | no | no | none | ✅ Security: Updated from 1.25-alpine to 1.29-alpine (vulnerability fixes) |

---

**Priority Levels**: 1d (critical), 1w (high), 1m (medium), 1y (low/deprecated)  
**EOL**: End of Life - version no longer supported

## ⚠️ Breaking Changes Identified
- None identified yet (initial setup)

## 🔍 Breaking Change Assessment Required
Before updating these components:
1. **Svelte/SvelteKit updates**: Review for breaking changes in component API and syntax
2. **Vite updates**: Check build configuration and plugin compatibility
3. **Test thoroughly**: Run all UI tests after major version updates
4. **Update incrementally**: Consider updating one major component at a time

**Last Security Audit**: `make test-ui-security-sca` (automatic)  
**Last Version Audit**: 2025-11-06 (initial setup)  
**Next Version Audit**: 2025-11-13 (manual)

## Audit Commands
```bash
# UI-specific component audit (if implemented)
# Usage: make audit-ui COMPONENT=<component-type>
# Examples:
make audit-ui COMPONENT=npm
make audit-ui COMPONENT=svelte
make audit-ui COMPONENT=vite
make audit-ui COMPONENT=node

# UI-specific security audit
make test-ui-security-sca
```

