// The numbered categories preserve the Opus r3 inventory, with current #803 bytes.
export function slots({ receipt: r, engram, mesh, source, c6, locks, driver, ci, closure, lot6 }) {
  const rows = [
    ['receipt', 'receipt.json', r.kind, null],
    ['backend-source', 'source-identity.json', source, null],
    ['engram', 'engram.tgz', engram, null],
    ['cluster-mesh', 'mesh.tgz', mesh, null],
    ['p3-manifest', 'source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json', r.p3ManifestSha256, null],
    ['consumer-package', 'consumer-package.json', locks.package, null],
    ['clean-install-locks', 'consumer-lock.json', locks, null],
    ['lane-script', 'consumer/installed-memory.mjs', 'E10 runtime with explicit E2 version/archive adaptation', null],
    ['lane-type-probe', 'consumer/installed-memory-types.ts', 'strict installed declaration closure', null],
    ['lane-recipe', 'lane-adaptation.json', 'tools/engram-e11/e11.mk and installed.sh; retained-lock npm ci', null],
    ['campaign-log', 'campaign.log', null, null],
    ['campaign-status', 'campaign.status', { exit: 0, cleanup: 0 }, null],
    ['driver', 'consumer/node_modules/pg/package.json', driver, null],
    ['engines', 'receipt.json', { node: r.consumer, image: r.qualificationImage, postgres: r.postgres }, null],
    ['contract-and-c6', 'neutral-contract-1.0.0.jcs.json', { contractDigest: r.contractDigest, c6, migrations: r.migrations, hostHistory: r.hostHistory }, 'Producer 1.0.0 JCS bytes/digest resolved; dev.6 inventory still requires a missing standalone contracts/engram-memory-neutral-contract-v1.d.ts and producer agreement.'],
    ['five-profiles', 'receipt.json', { required: r.requiredProfiles, claims: r.declaredProfileClaims, equivalence: r.fiveProfileEquivalence }, 'Integration durable-memory.spec.ts explicitly blocks 23 Stage B cases on E7-fenced-writers (three also on E7 host reads); installed receipt does not qualify them.'],
    ['host-glue', 'receipt.json', { tupleCoverage: r.tupleCoverage, hostGlue: null, hostTables: ['host_history', 'host_memory_identity'] }, null],
    ['adaptation', 'mesh.tgz', { k7: 'full receipt_digest carriage in dev.6', intentHash: 'unchanged producer NeutralAtomicUnit.intentHash' }, null],
    ['operations-and-closures', 'receipt.json', { refusals: r.refusals, operations: r.operations, closure }, null],
    ['lot6-disposition', 'pr803.md', lot6, null],
    ['ci', 'ci.json', ci, 'Exact E11 head CI is retained separately after push to avoid a self-referential tuple hash; integration merge has no E10 pull_request run. CI does not qualify Stage B.'],
  ];
  return rows.map(([name, file, observed, reason], index) => ({ id: index + 1, name, file,
    status: reason ? 'PENDING' : 'VERIFIED-CANDIDATE', ...(reason ? { reason } : {}), observed }));
}

export const handoff = {
  finalManifest: { status: 'PENDING', owner: 'gr-conductor', reason: 'E2 producer/archive slots resolved; final acceptance requires Stage B qualification and the standalone C6 declaration, then reserved stable bytes.' },
  publishedBytes: { status: 'PENDING', reason: 'No publication authorized; re-download exact final versions and verify archive/integrity/contract bytes.' },
  producerC9: { status: 'PENDING', owner: 'Engram producer via gr-conductor', reason: 'Explicit C9 ACK must name final tuple SHA-256 and final C6 1.0.0 bytes.' },
  receiving: { status: 'PENDING', owner: 'Sentropic/L5 receiver', reason: 'Independent receiving ACK must identify the identical final tuple and installed locks.' },
  reservation: { status: 'PENDING', version: '0.24.0', reason: 'Recheck registry availability and release authority immediately before finalization.' },
  mainPr: { status: 'PENDING', reason: 'Conductor prepares final main PR, exact-head CI and CI-only publication after acceptance.' },
};
