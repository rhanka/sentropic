// E2 integration after #821 and #803. L4 0.22.0 remains a separate L5 input.
export const candidate = {
  snapshotHead: '2d9d5da97669199091700e138de638ca28b559c9',
  qualifiedHead: '2d9d5da97669199091700e138de638ca28b559c9',
  qualifiedTree: '4f9ef09088d2fd28a451196c23151146bdd6bc64',
  engram: {
    name: '@sentropic/engram', version: '0.21.3',
    sha256: '32d47df1880cf5c43b0f16145f75aebeda5fd341d8b1317f3b89acc428bbd05b',
    integrity: 'sha512-eGoBIutpeISKgN4HOS3NSIj7K6rMtT6Y/FbBvoXMykLu0wbaKEaO1pjCLDxVFfdA6Zlj9zg2v2Ft7DIr5Vf7aw==',
  },
  mesh: {
    name: '@sentropic/cluster-mesh', version: '0.24.0-dev.7',
    sha256: '7aeb92cfb97ef013ee0d6d50162f5b8dedebd51a44af2018c2e24ada2395e271',
    integrity: 'sha512-riNCegTubf6lYa/WWJbdN6rWV0hztGPDmn+PemY1nSYjQIOI4ve2nMUXNo5PiAoZRhKEHvsyDoNF0ktJk3Ah2g==',
  },
  anchors: {
    // Campaign identities are bound by the generated tuple's files map.
    // CI reruns create their own logs/locks; they never overwrite a tuple.
    'neutral-contract-1.0.0.jcs.json': '55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759',
    'source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json': '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730',
  },
};
export const profileNames = ['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1', 'scope-outbox-v1', 'fenced-writers-v1'];
export const profileCases = {
  'atomic-units-v1': ['capture-completion', 'completion-conflict', 'rollback', 'crash-before', 'crash-after',
    'C5/9007199254740991', 'C5/9223372036854775807', 'C5/18446744073709551614'],
  'immutable-chains-v1': ['first-proof-reopen', 'destruction-replay/accept', 'destruction-replay/reject'],
  'immutable-boundaries-v1': ['bounded-journal', 'bounded-outbox', 'accepted-snapshot'],
  'scope-outbox-v1': ['checkpoint-resync-snapshot', 'poison-retry', 'authority-refusals'],
  'fenced-writers-v1': ['second-holder', 'store-bijection', 'revocation', 'two-process', 'final-guard', 'C7'],
};
