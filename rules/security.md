---
description: "SAST, SCA, container scanning, vulnerability register, Dockerfile hardening"
alwaysApply: false
paths: [".security/**", "**/Dockerfile*", "docker-compose*.yml"]
globs: [".security/**", "**/Dockerfile*", "docker-compose*.yml"]
tags: [security]
---

# SECURITY

## Core Principles
- Forbidden: destructive operations in production; secrets in plain text
- Require "approval" for: DB migrations in prod, merges, release publishing
- Always produce a preview (diff/plan) before acting

## Coverage Requirements
- Critical/High vulnerabilities not allowed unless documented with mitigation plan
- Security checks in CI on every PR for changed components

## Scan Categories

### 1. Dependency Vulnerabilities (SCA)
- Detect vulnerable dependencies early, block on Critical/High
- Tooling: `npm audit` (Dockerfile, blocking), Trivy SCA (CI)

### 2. Authentication & Authorization
- Verify access controls and session/token handling
- Tooling: future functional tests

### 3. Input Validation & Sanitization
- Protect against XSS, CSRF, injections
- Tooling: Semgrep static analysis + future functional tests

### 4. Data Protection
- Protect secrets, encryption, PII boundaries
- Tooling: Semgrep + future functional tests

### 5. API Security
- Rate limiting, schema validation, injection resilience
- Tooling: Semgrep + future functional tests

### 6. Infrastructure & Container Security
- Secure images and IaC configs
- Tooling: Trivy (container + IaC + SCA), Semgrep (SAST)

## Dockerfile Hardening
- Non-root execution: all services as non-root (nodejs:1001, nginx, python)
- File permissions: 755 dirs, 644 files
- Isolation between build stages
- Compliance: OWASP Docker Security, CIS Docker Benchmark

## Make Targets
- `make test-<service>-security-<type>` where type: `sast`, `sca`, `container`
- `make test-security-iac` (docker-compose.yml, Makefile)
- Aggregates: `make test-security-sast`, `make test-security-sca`, `make test-security-container`
- All scans: `make test-security`

## Exit Criteria

### SAST (Semgrep)
- Exit 1 if ANY findings not in vulnerability register
- All severity levels (INFO, WARNING, ERROR) trigger failure unless documented

### SCA (Trivy)
- Exit 1 if HIGH/CRITICAL not in register
- MEDIUM/LOW are warnings only

### IaC (Trivy)
- Exit 1 if HIGH/CRITICAL misconfigurations not in register

### Container (Trivy)
- Exit 1 if HIGH/CRITICAL not in register
- Scans actual built image only (no base image fallback)

### Dockerfile Dependency Gating
- Docker builds fail on HIGH/CRITICAL from `npm audit`
- API: `npm audit --audit-level=high` in base + production stages
- UI: `npm audit --audit-level=high` in base stage

## Vulnerability Register (`.security/vulnerability-register.yaml`)
- All HIGH/CRITICAL/ERROR findings must be documented
- Categories: `false_positive`, `accepted_risk`, `planned_mitigation`, `technical_debt`
- Justification mandatory for every entry
- Fix timeline required: 1d, 1w, 1m, 1y

### Lifecycle
1. Discovery: security scan detects vulnerability
2. Assessment: categorize and risk-assess
3. Documentation: add to register with justification + timeline
4. Acceptance: CI passes if properly documented
5. Mitigation: fix per planned timeline
6. Verification: re-scan to confirm resolution
7. Cleanup: remove from register after fix

### Maintenance Rules
- Monthly review for outdated entries
- Reassess risk levels periodically
- Keep justifications and timelines current
- Post-mitigation: remove resolved entries, update metadata

## Final Validation Workflow
- Run all security scans (SAST, SCA, Container, IaC) before branch completion
- Sync vulnerability register: add new findings, remove resolved, update timestamps
- Verify all scans pass with no new HIGH/CRITICAL/ERROR
- Verify CI pipeline passes all security checks

## Production Notes
- Falco (runtime security): out of scope for CI, include in Kubernetes production hardening
