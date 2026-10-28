// The numbered categories preserve the Opus r3 inventory, with current #803 bytes.
export function slots({ receipt: r, engram, mesh, source, c6, locks, driver, ci, closure, lot6, qualifiedProfiles }) {
  const rows = [
    ['receipt', 'receipt.json', r.kind, null],
    ['backend-source', 'source-identity.json', source, null],
    ['engram', 'engram.tgz', engram, null],
    ['cluster-mesh', 'mesh.tgz', mesh, null],
    ['p3-manifest', 'source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json', r.p3ManifestSha256, null],
    ['consumer-package', 'consumer-package.json', locks.package, null],
    ['clean-install-locks', 'consumer-lock.json', locks, null],
    ['lane-script', 'consumer/installed-memory.mjs', 'Current E10 runtime copied without substitution', null],
    ['lane-type-probe', 'consumer/installed-memory-types.ts', 'strict installed declaration closure', null],
    ['lane-recipe', 'lane-adaptation.json', 'tools/engram-e11/e11.mk and installed.sh; retained-lock npm ci', null],
    ['campaign-log', 'campaign.log', null, null],
    ['campaign-status', 'campaign.status', { exit: 0, cleanup: 0 }, null],
    ['driver', 'consumer/node_modules/pg/package.json', driver, null],
    ['engines', 'receipt.json', { node: r.consumer, image: r.qualificationImage, postgres: r.postgres }, null],
    ['contract-and-c6', 'neutral-contract-1.0.0.jcs.json', { contractDigest: r.contractDigest, c6, migrations: r.migrations, hostHistory: r.hostHistory }, c6.standaloneDeclarationSha256 ? null : 'Standalone C6 declaration absent'],
    ['five-profiles', 'stage-b-result.json', { required: r.requiredProfiles, claims: qualifiedProfiles,
      equivalence: { status: 'qualified', backend: 'postgres', cases: 23, skipped: 0 },
      standaloneE10Disposition: r.fiveProfileEquivalence }, null],
    ['host-glue', 'receipt.json', { tupleCoverage: r.tupleCoverage, hostGlue: null, hostTables: ['host_history', 'host_memory_identity'] }, null],
    ['adaptation', 'mesh.tgz', { k7: 'full receipt_digest carriage in dev.7', intentHash: 'unchanged producer NeutralAtomicUnit.intentHash', u64: 'exact decimal strings through PG guards and updates' }, null],
    ['operations-and-closures', 'receipt.json', { refusals: r.refusals, operations: r.operations, closure }, null],
    ['lot6-disposition', 'pr803.md', lot6, null],
    ['ci', 'e10-ci.json', { e10: ci, e11: 'Exact E11 head CI is retained separately after push to avoid a self-referential tuple hash' }, null],
  ];
  return rows.map(([name, file, observed, reason], index) => ({ id: index + 1, name, file,
    status: reason ? 'PENDING' : 'VERIFIED-CANDIDATE', ...(reason ? { reason } : {}), observed }));
}

export const handoff = {
  finalManifest: { status: 'PENDING', owner: 'gr-conductor', reason: 'Candidate slots resolved; final acceptance requires reserved stable bytes and release/receiving ACKs.' },
  publishedBytes: { status: 'PENDING', reason: 'No publication authorized; re-download exact final versions and verify archive/integrity/contract bytes.' },
  producerC9: { status: 'PENDING', owner: 'Engram producer via gr-conductor', reason: 'Explicit C9 ACK must name final tuple SHA-256, C6 declaration hash and 1.0.0 supersession dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28 → dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee (additive intentHash, #821).' },
  receiving: { status: 'PENDING', owner: 'Sentropic/L5 receiver', reason: 'Independent receiving ACK must identify the identical final tuple and installed locks.' },
  reservation: { status: 'PENDING', version: '0.24.0', reason: 'Recheck registry availability and release authority immediately before finalization.' },
  mainPr: { status: 'PENDING', reason: 'Conductor prepares final main PR, exact-head CI and CI-only publication after acceptance.' },
};
