#!/bin/bash

# Security Parser using jq
# Usage: ./security-parser.sh <scan_type> <input_file> <output_file> [service_name]
# Example: ./security-parser.sh sast sast-output.json parsed-results.yaml api

set -e

SCAN_TYPE="$1"
INPUT_FILE="$2"
OUTPUT_FILE="$3"
SERVICE_NAME="$4"

if [ -z "$SCAN_TYPE" ] || [ -z "$INPUT_FILE" ] || [ -z "$OUTPUT_FILE" ]; then
    echo "Usage: $0 <scan_type> <input_file> <output_file> [service_name]"
    echo "Scan types: sast, sca, container, iac"
    echo "Service name: api, ui (for proper path construction)"
    exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file $INPUT_FILE not found"
    exit 1
fi

echo "🔍 Parsing $SCAN_TYPE results from $INPUT_FILE..."

case "$SCAN_TYPE" in
    "sast"|"semgrep")
        # Parse Semgrep JSON output (SAST)
        if command -v jq >/dev/null 2>&1; then
            # Extract findings count
            FINDINGS_COUNT=$(jq '.results | length' "$INPUT_FILE" 2>/dev/null || echo "0")
            
            if [ "$FINDINGS_COUNT" -gt 0 ]; then
                echo "Found $FINDINGS_COUNT findings"
                
                # Extract structured findings and create proper JSON array
                # Adapt path: packages/X -> X
                jq -r --arg service "$SERVICE_NAME" '{
                    scan_type: "semgrep",
                    timestamp: now,
                    findings_count: (.results | length),
                    findings: [.results[] | {
                        id: (.check_id + "_" + ($service + "_" + .path | gsub("/"; "_") | gsub("\\."; "_")) + "_L" + (.start.line | tostring)),
                        rule_id: .check_id,
                        severity: .extra.severity,
                        file: ($service + "/" + .path),
                        line: .start.line,
                        message: .extra.message,
                        fix: (.extra.fix // null),
                        cwe: (.extra.metadata.cwe // []),
                        owasp: (.extra.metadata.owasp // []),
                        category: (.extra.metadata.category // null),
                        confidence: (.extra.metadata.confidence // null)
                    }]
                }' "$INPUT_FILE" > "${OUTPUT_FILE%.yaml}.json"
                
                # Add context for each finding
                echo "🔍 Extracting context for findings..."
                
                for i in $(seq 0 $((FINDINGS_COUNT - 1))); do
                    FILE_PATH=$(jq -r ".findings[$i].file" "${OUTPUT_FILE%.yaml}.json")
                    LINE_NUM=$(jq -r ".findings[$i].line" "${OUTPUT_FILE%.yaml}.json")
                    
                    echo "  Extracting context for $FILE_PATH:$LINE_NUM"
                    
                    if [ -f "$FILE_PATH" ]; then
                        CONTEXT=$(sed -n "$((LINE_NUM - 3)),$((LINE_NUM + 3))p" "$FILE_PATH" 2>/dev/null || echo "Context not available")
                        CONTEXT=$(echo "$CONTEXT" | sed '/^$/d' | head -7 | tail -7)
                    else
                        CONTEXT="File not found: $FILE_PATH"
                    fi
                    
                    jq --arg context "$CONTEXT" ".findings[$i].context = \$context" "${OUTPUT_FILE%.yaml}.json" > "${OUTPUT_FILE%.yaml}.tmp" && mv "${OUTPUT_FILE%.yaml}.tmp" "${OUTPUT_FILE%.yaml}.json"
                done
                
                # Convert JSON to YAML if needed
                if [[ "$OUTPUT_FILE" == *.yaml ]] || [[ "$OUTPUT_FILE" == *.yml ]]; then
                    echo "🔄 Converting to YAML format..."
                    if command -v yq >/dev/null 2>&1; then
                        yq eval -P '.' "${OUTPUT_FILE%.yaml}.json" > "$OUTPUT_FILE"
                    else
                        echo "⚠️  yq not found - keeping JSON format"
                        cp "${OUTPUT_FILE%.yaml}.json" "$OUTPUT_FILE"
                    fi
                fi
                
                echo "✅ Parsed $FINDINGS_COUNT findings to $OUTPUT_FILE"
            else
                echo "No findings found"
                echo '{"findings_count": 0, "findings": []}' > "${OUTPUT_FILE%.yaml}.json"
                if [[ "$OUTPUT_FILE" == *.yaml ]] || [[ "$OUTPUT_FILE" == *.yml ]]; then
                    if command -v yq >/dev/null 2>&1; then
                        echo '{"findings_count": 0, "findings": []}' | yq eval -P '.' > "$OUTPUT_FILE"
                    else
                        echo 'findings_count: 0' > "$OUTPUT_FILE"
                        echo 'findings: []' >> "$OUTPUT_FILE"
                    fi
                else
                    cp "${OUTPUT_FILE%.yaml}.json" "$OUTPUT_FILE"
                fi
            fi
        else
            echo "Error: jq is required for parsing Semgrep output"
            exit 1
        fi
        ;;
        
    "sca"|"container"|"iac")
        # Parse Trivy JSON output
        if command -v jq >/dev/null 2>&1; then
            # For IaC, handle multiple JSON objects (one per file scanned)
            if [ "$SCAN_TYPE" = "iac" ]; then
                # Merge multiple JSON objects into array and extract findings
                FINDINGS_COUNT=$(jq -s '[.[] | .Results[]?.Misconfigurations[]?] | length' "$INPUT_FILE" 2>/dev/null || echo "0")
            else
                FINDINGS_COUNT=$(jq '[.Results[]?.Vulnerabilities[]?] | length' "$INPUT_FILE" 2>/dev/null || echo "0")
            fi
            
            # Clean up FINDINGS_COUNT (remove newlines)
            FINDINGS_COUNT=$(echo "$FINDINGS_COUNT" | tr -d '\n' | head -1)
            
            if [ "$FINDINGS_COUNT" -gt 0 ] && [ "$FINDINGS_COUNT" != "null" ] && [ "$FINDINGS_COUNT" != "" ]; then
                echo "Found $FINDINGS_COUNT findings"
                
                # Extract structured findings from Trivy format
                if [ "$SCAN_TYPE" = "iac" ]; then
                    # For IaC, handle multiple JSON objects and extract Misconfigurations
                    jq -s -r --arg service "$SERVICE_NAME" '{
                        scan_type: "'$SCAN_TYPE'",
                        timestamp: now,
                        findings_count: ([.[] | .Results[]?.Misconfigurations[]?] | length),
                        findings: ([.[] | .Results[]?.Misconfigurations[]?] | map({
                            id: (.ID + "_" + ($service + "_" + (.Type // "unknown") | gsub("/"; "_") | gsub("\\."; "_")) + "_" + (.CauseMetadata?.Resource // "unknown")),
                            rule_id: .ID,
                            severity: .Severity,
                            file: (.CauseMetadata?.Resource // "unknown"),
                            line: (.CauseMetadata?.EndLine // 1),
                            message: (.Message // .Title // "No description available"),
                            fix: (.Resolution // null),
                            cwe: (.CweIDs // []),
                            owasp: [],
                            category: "misconfiguration",
                            confidence: "HIGH"
                        }))
                    }' "$INPUT_FILE" > "${OUTPUT_FILE%.yaml}.json"
                else
                    # For SCA and Container, extract Vulnerabilities
                    jq -r --arg service "$SERVICE_NAME" '{
                        scan_type: "'$SCAN_TYPE'",
                        timestamp: now,
                        findings_count: ([.Results[]?.Vulnerabilities[]?] | length),
                        findings: [.Results[]?.Vulnerabilities[]? | {
                            id: (.VulnerabilityID + "_" + ($service + "_" + (.PkgName // "unknown") | gsub("/"; "_") | gsub("\\."; "_")) + "_" + (.InstalledVersion // "unknown")),
                            rule_id: .VulnerabilityID,
                            severity: .Severity,
                            file: (.PkgPath // "unknown"),
                            line: 1,
                            message: (.Description // .Title // "No description available"),
                            fix: (.FixedVersion // null),
                            cwe: (.CweIDs // []),
                            owasp: [],
                            category: "vulnerability",
                            confidence: "HIGH"
                        }]
                    }' "$INPUT_FILE" > "${OUTPUT_FILE%.yaml}.json"
                fi
                
                # Convert JSON to YAML if needed
                if [[ "$OUTPUT_FILE" == *.yaml ]] || [[ "$OUTPUT_FILE" == *.yml ]]; then
                    echo "🔄 Converting to YAML format..."
                    if command -v yq >/dev/null 2>&1; then
                        yq eval -P '.' "${OUTPUT_FILE%.yaml}.json" > "$OUTPUT_FILE"
                    else
                        echo "⚠️  yq not found - keeping JSON format"
                        cp "${OUTPUT_FILE%.yaml}.json" "$OUTPUT_FILE"
                    fi
                fi
                
                echo "✅ Parsed findings to $OUTPUT_FILE"
            else
                echo "No findings found"
                echo '{"findings_count": 0, "findings": []}' > "${OUTPUT_FILE%.yaml}.json"
                if [[ "$OUTPUT_FILE" == *.yaml ]] || [[ "$OUTPUT_FILE" == *.yml ]]; then
                    if command -v yq >/dev/null 2>&1; then
                        echo '{"findings_count": 0, "findings": []}' | yq eval -P '.' > "$OUTPUT_FILE"
                    else
                        echo 'findings_count: 0' > "$OUTPUT_FILE"
                        echo 'findings: []' >> "$OUTPUT_FILE"
                    fi
                else
                    cp "${OUTPUT_FILE%.yaml}.json" "$OUTPUT_FILE"
                fi
            fi
        else
            echo "Error: jq is required for parsing Trivy output"
            exit 1
        fi
        ;;
        
    *)
        echo "Error: Unknown scan type '$SCAN_TYPE'"
        echo "Supported types: sast, sca, container, iac"
        exit 1
        ;;
esac
