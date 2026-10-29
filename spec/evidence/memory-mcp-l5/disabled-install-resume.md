# Disabled-install recovery verification

Exact candidate: `965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9`.

The pre-reboot packed test repeated the ordinary network installation inside a five-second Vitest case and exceeded that timer. The Make target now performs the installation before launching Vitest. The case verifies the manifest, candidate, observer, predicate and retained compressed evidence hashes before accepting the observed result. No timeout was increased.

Commands ran under the shared Docker flock with ports 9625/5825/1725 and `ENV=test-memory-l5` last:

- `make memory-l5-tooling`: 140 passed, zero failed/skipped/todo.
- `make memory-l5-packed SCOPE=packed/disabled-install.test.ts ARTIFACT_MANIFEST=tmp/disabled-test-manifest.json NATIVE_OUTPUT=tmp/disabled-resume-final MEMORY_L5_REPORT=/workspace/tmp/disabled-resume-final/vitest.json`: passed.
- `make scope-check`: PASS C2.

The ordinary installation used lifecycle scripts and optional dependencies, exited zero, and recorded zero candidate-attributed native attempts. The actual node-gyp rebuild positive control produced two observations; disabled provider/store/identity/native runtime counts were all zero. Version/help/configuration and clean-only commands are excluded; verbose compiler and clean-plus-build commands remain detectable.

These local observations do not establish installed P01–P09 completeness, final-head CI, authenticated owner UAT or role acceptance. The original R5 failure is retained separately.
