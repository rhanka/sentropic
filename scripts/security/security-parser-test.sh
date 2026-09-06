#!/bin/bash

set -euo pipefail

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

expect_failure() {
    local label="$1"
    local input="$2"
    if bash scripts/security/security-parser.sh container "$input" "$TMP_DIR/output.yaml" api >/dev/null 2>&1; then
        echo "FAIL: $label was accepted"
        exit 1
    fi
    echo "PASS: $label was rejected"
}

: > "$TMP_DIR/empty.json"
printf '%s\n' '{not-json' > "$TMP_DIR/malformed.json"
printf '%s\n' '{"Results":[]}' > "$TMP_DIR/synthetic-empty.json"

expect_failure "empty report" "$TMP_DIR/empty.json"
expect_failure "malformed report" "$TMP_DIR/malformed.json"
expect_failure "synthetic empty Trivy report" "$TMP_DIR/synthetic-empty.json"

cat > "$TMP_DIR/npm-audit.json" <<'JSON'
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "example": {
      "name": "example",
      "severity": "high",
      "fixAvailable": false
    }
  },
  "metadata": {
    "vulnerabilities": {"high": 1, "critical": 0, "total": 1}
  }
}
JSON

bash scripts/security/security-parser.sh sca "$TMP_DIR/npm-audit.json" "$TMP_DIR/npm-output.yaml" api >/dev/null
jq -e '.findings_count == 1 and .findings[0].id == "npm_audit_api_example_high"' \
    "$TMP_DIR/npm-output.json" >/dev/null
echo "PASS: npm-audit HIGH finding was preserved"

cat > "$TMP_DIR/trivy-clean.json" <<'JSON'
{
  "SchemaVersion": 2,
  "ArtifactName": "example:test",
  "Results": []
}
JSON

bash scripts/security/security-parser.sh container "$TMP_DIR/trivy-clean.json" "$TMP_DIR/trivy-output.yaml" ui >/dev/null
jq -e '.findings_count == 0 and (.findings | length) == 0' "$TMP_DIR/trivy-output.json" >/dev/null
echo "PASS: complete clean Trivy report was accepted"
