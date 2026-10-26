#!/usr/bin/env bash
# Read-only inspection of candidate bytes; does not execute or replace L5 proofs.
set -euo pipefail
candidate=/home/antoinefa/src/graphify-wt-mcpl4
archive="$candidate/.graphify/scratch/l4-r2-artifacts/sentropic-engram-0.21.2.tgz"
out=spec/evidence/memory-mcp-l5/candidate-0212
manifest="$out/l4-candidate-manifest.json"
pre=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json
sha=$(sha256sum "$archive" | cut -d' ' -f1)
integrity="sha512-$(openssl dgst -sha512 -binary "$archive" | openssl base64 -A)"
test "$sha" = a295eef8a1733fd8c00f72ccd6938a5ea11678fdf33848f8849c4d531bd43af8
test "$integrity" = 'sha512-vzIjuznMAk9IXdzBJdJgSAe7Lf0pLxC1UGK6LrSoXcYYbFIR2BVL20e6Eej4YY4MZxZTljmnn5xdYO4l7MXBSA=='
pre_sha=$(sha256sum "$pre" | cut -d' ' -f1)
test "$pre_sha" = 2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b
jq -e --arg sha "$sha" --arg integrity "$integrity" --arg pre "$pre_sha" \
  '.tarball.sha256 == $sha and .tarball.integrity == $integrity and .builtAgainstPreCandidateSha256 == $pre' "$manifest" >/dev/null
cmp "$manifest" "$candidate/candidate-manifest.json"
entry_digest=$(tar -xOf "$archive" package/registry/entries.v1.json | jq -cSj '.entries[0]' | sha256sum | cut -d' ' -f1)
jq -e --arg digest "$entry_digest" '.registryArtifacts.registryEntryDigest == $digest' "$manifest" >/dev/null
jq -e --arg sha "$sha" --arg integrity "$integrity" --arg digest "$entry_digest" \
  '.tarballSha256 == $sha and .tarballIntegrity == $integrity and .entryJcsSha256 == $digest' "$candidate/registry/publisher-assets.v1.json" >/dev/null
tar -xOf "$archive" package/dist/registry/base-manifest.json | jq -c '[.tools[].name]' > "$out/tool-names.json"
jq -e '. == ["engram_memory_search","engram_memory_get","engram_memory_capture","engram_memory_request_admission","engram_memory_withdraw","engram_memory_forget"]' "$out/tool-names.json" >/dev/null
tar -xOf "$archive" package/package.json | jq -c '{name,version,exports,peerDependencies,peerDependenciesMeta,optionalDependencies}' > "$out/package-surface.json"
jq -e --slurpfile m "$manifest" '.exports == $m[0].exports and
  .peerDependencies["@sentropic/mcp-platform"] == "0.4.0" and
  .peerDependencies["@sentropic/mcp-broker"] == "0.1.0" and
  .peerDependenciesMeta["@sentropic/mcp-platform"].optional == true and
  .peerDependenciesMeta["@sentropic/mcp-broker"].optional == true and
  .optionalDependencies["@modelcontextprotocol/sdk"] == "^1.31.0"' "$out/package-surface.json" >/dev/null
: > "$out/registry-digests.tsv"
: > "$out/registry-errors.log"
while IFS=$'\t' read -r path expected; do
  if test "$path" = registry/publisher-assets.v1.json; then
    # The upstream generator explicitly excludes this self-referential receipt from npm files.
    actual=$(sha256sum "$candidate/$path" | cut -d' ' -f1)
    test "$actual" = "$expected"
    jq -c . "$candidate/$path" > "$out/l4-publisher-assets.json"
    printf '%s\t%s\tPASS-EXTERNAL\n' "$path" "$actual" >> "$out/registry-digests.tsv"
    continue
  fi
  if actual=$(tar -xOf "$archive" "package/$path" 2>> "$out/registry-errors.log" | sha256sum | cut -d' ' -f1); then
    status=PASS
    if test "$actual" != "$expected"; then status=FAIL-DIGEST; fi
  else
    actual=MISSING
    status=FAIL-MISSING
  fi
  printf '%s\t%s\t%s\n' "$path" "$actual" "$status" >> "$out/registry-digests.tsv"
done < <(jq -r '.registryArtifacts | to_entries[] | select(.key != "registryEntryDigest") | [.key,.value] | @tsv' "$manifest")
: > "$out/p2-archives.tsv"
while IFS=$'\t' read -r path expected expected_integrity; do
  actual=$(sha256sum "$path" | cut -d' ' -f1)
  actual_integrity="sha512-$(openssl dgst -sha512 -binary "$path" | openssl base64 -A)"
  test "$actual" = "$expected" && test "$actual_integrity" = "$expected_integrity"
  printf '%s\t%s\t%s\tPASS\n' "$path" "$actual" "$actual_integrity" >> "$out/p2-archives.tsv"
done < <(jq -r '.artifacts[] | [.archive,.sha256,.integrity] | @tsv' "$pre")
: > "$out/proof-availability.jsonl"
while IFS= read -r proof; do
  missing='[]'
  while IFS= read -r file; do
    if ! test -f "$file"; then missing=$(jq -cn --argjson a "$missing" --arg f "$file" '$a+[$f]'); fi
  done < <(jq -r '.files[]' <<< "$proof")
  jq -cn --argjson p "$proof" --argjson missing "$missing" \
    '{id:$p.id,requiresE4:$p.requiresE4,command:$p.command,missingFiles:$missing,result:"unverified",executed:false}' >> "$out/proof-availability.jsonl"
done < <(jq -c '.proofs[]' tools/memory-mcp-l5/proof-catalog-v1.json)
{
  printf 'candidate SHA-256: %s\ncandidate integrity: %s\nP2 SHA-256: %s\n' "$sha" "$integrity" "$pre_sha"
  printf 'candidate checkout HEAD: %s\n' "$(git -C "$candidate" rev-parse HEAD)"
  printf 'L4 manifest source commit: %s\n' "$(jq -r '.engramSourceCommit' "$manifest")"
  printf 'L4 manifest SHA-256: %s\n' "$(sha256sum "$manifest" | cut -d' ' -f1)"
  printf 'Required candidate manifest fields absent from L4 handoff:\n'
  jq -r --slurpfile m "$manifest" '.oneOf[] | select(.properties.stage.const == "candidate") | .required[] as $k | select($m[0] | has($k) | not) | $k' tools/memory-mcp-l5/schemas/artifact-manifest-v1.schema.json
  printf 'Frozen exports inventory entries:\n'
  jq -r 'to_entries[] | select(.value | type == "object") | .value.entry // empty' tools/memory-mcp-l5/exports-v1.json
  printf 'Required import graph roots absent from checkout:\n'
  while IFS= read -r path; do test -f "$path" || printf '%s\n' "$path"; done < <(jq -r '.importGraphRoots[] | select(startswith("@") | not)' tools/memory-mcp-l5/proof-catalog-v1.json)
  printf 'Installed six-tool behaviour: unverified (packed suite absent)\n'
  printf 'Disabled-install 0/0/0/0: unverified (suite absent; no observed counters)\n'
  printf 'Registry entry canonical digest: %s (PASS; sorted compact JSON matches upstream canonicalizer for these bytes)\n' "$entry_digest"
  printf 'Publisher receipt is external by design (upstream gen-mcp-memory-assets.mjs:10-14).\n'
  printf 'Full candidate gate: NOT EXECUTED (standalone Docker forbidden; candidate lot absent)\n'
  printf 'L5-MEMORY-V1 receipt: NOT ISSUED\n'
} > "$out/inspection.log"
