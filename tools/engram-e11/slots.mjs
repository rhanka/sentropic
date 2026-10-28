// The numbered categories preserve the Opus r3 inventory, with current #803 bytes.
export function slots({ receipt: r, engram, mesh, source, c6, locks, driver, ci, closure, lot6 }) {
  const rows = [
    ['receipt', 'receipt.json', r.kind, 'Regenerate after the final producer/mesh installed rerun.'],
    ['backend-source', 'source-identity.json', source, 'Producer intentHash carriage changes mesh source and qualified head/tree.'],
    ['engram', 'engram.tgz', engram, 'Await Engram owner merge of #410 and 0.21.3 published bytes with NeutralAtomicUnit.intentHash.'],
    ['cluster-mesh', 'mesh.tgz', mesh, 'Replace dev.5 host formula with carried intentHash in a new pack-only dev archive.'],
    ['p3-manifest', 'source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json', r.p3ManifestSha256, null],
    ['consumer-package', 'consumer-package.json', locks.package, 'Update exact Engram and mesh references for the successor tuple.'],
    ['clean-install-locks', 'consumer-lock.json', locks, 'Retain successor consumer/workspace locks; final install must use npm ci without re-resolution.'],
    ['lane-script', 'source/packages/cluster-mesh/tests/engram-memory/installed-memory.mjs', null, 'Reconcile version assertions and receipt metadata with the successor tuple.'],
    ['lane-type-probe', 'source/packages/cluster-mesh/tests/engram-memory/installed-memory-types.ts', null, 'Compile against the producer intentHash declaration and successor installed mesh.'],
    ['lane-recipe', 'source/packages/cluster-mesh/tests/engram-memory/qualification.mk', null, 'Replace candidate assertions and lock generation with retained-lock npm ci.'],
    ['campaign-log', 'campaign.log', null, 'Rerun after producer/mesh transition and retain new qualification evidence.'],
    ['campaign-status', 'campaign.status', { exit: 0, cleanup: 0 }, 'New campaign must establish exit=0 and cleanup=0.'],
    ['driver', 'consumer/node_modules/pg/package.json', driver, null],
    ['engines', 'receipt.json', { node: r.consumer, image: r.qualificationImage, postgres: r.postgres }, 'Re-attest pinned Node 24/PostgreSQL images and runtime on the successor campaign.'],
    ['contract-and-c6', 'mesh.tgz', { contractDigest: r.contractDigest, c6, migrations: r.migrations, hostHistory: r.hostHistory }, 'C6 1.0.0 final standalone bytes are absent; intentHash changes declarations; final sha256 and producer agreement required.'],
    ['five-profiles', 'receipt.json', { required: r.requiredProfiles, claims: r.declaredProfileClaims, equivalence: r.fiveProfileEquivalence }, 'Five claims are declared, equivalence not-covered (E9 #790, 23 cases); exact successor tuple needs qualified evidence.'],
    ['host-glue', 'receipt.json', { tupleCoverage: r.tupleCoverage, hostGlue: null, hostTables: ['host_history', 'host_memory_identity'] }, null],
    ['adaptation', 'mesh.tgz', { k7: 'full receipt_digest carriage in dev.5', intentHash: 'interim host formula' }, 'Replace interim host formula with unchanged producer-supplied NeutralAtomicUnit.intentHash; recheck lossless K7 bytes.'],
    ['operations-and-closures', 'receipt.json', { refusals: r.refusals, operations: r.operations, closure }, 'Repeat refusals, hydration, restart and closure checks on the new installed bytes.'],
    ['lot6-disposition', 'pr803.md', lot6, null],
    ['ci', 'ci.json', ci, 'E10 and E11 each need completed/success CI on their exact final heads; CI does not execute the installed lane.'],
  ];
  return rows.map(([name, file, observed, reason], index) => ({ id: index + 1, name, file,
    status: reason ? 'PENDING' : 'VERIFIED-CANDIDATE', ...(reason ? { reason } : {}), observed }));
}

export const handoff = {
  finalManifest: { status: 'PENDING', owner: 'gr-conductor', reason: 'Final generation follows stable E9/E10 inputs; preparation is not delivery or ACK.' },
  publishedBytes: { status: 'PENDING', reason: 'No publication authorized; re-download exact final versions and verify archive/integrity/contract bytes.' },
  producerC9: { status: 'PENDING', owner: 'Engram producer via gr-conductor', reason: 'Explicit C9 ACK must name final tuple SHA-256 and final C6 1.0.0 bytes.' },
  receiving: { status: 'PENDING', owner: 'Sentropic/L5 receiver', reason: 'Independent receiving ACK must identify the identical final tuple and installed locks.' },
  reservation: { status: 'PENDING', version: '0.24.0', reason: 'Recheck registry availability and release authority immediately before finalization.' },
  mainPr: { status: 'PENDING', reason: 'Conductor prepares final main PR, exact-head CI and CI-only publication after acceptance.' },
};
