export const PLATFORM_BLOCKED_CASES = [
  'P01.mesh.memory-context', 'P03.platform.schema-profile-2020-12', 'P04.platform.wire-profile-v1',
  'P01.packed.identity-source-refusal', 'P02.packed.audit-verdict-refusal', 'P04.packed.sdk-discovery-call',
];
export const WAITING_FOR = [
  ...PLATFORM_BLOCKED_CASES.map(id => ({ id, owner: 'gr-conductor',
    status: 'blocked: platform-admitBridgeTools', missing: 'separate platform 0.4.1 proposal; adoption and successor freeze decision pending' })),
  { id: 'P01.packed', owner: 'gr-conductor', missing: 'verified P3-bound lot2-manifest/sidecar, host context/source closure; E4 identity-source-refusal suite' },
  { id: 'P02.packed', owner: 'gr-conductor', missing: 'same manifest and canonical E2 audit/literal-true verdict receipts; E4 refusal suite' },
  { id: 'P03', owner: 'gr-conductor', missing: 'manifest-bound neutral declarations, profile and lock closure for installed schema/digest qualification' },
  { id: 'P04.packed', owner: 'gr-conductor', missing: 'manifest-bound transport tuple; E4 sdk-discovery-call suite' },
  { id: 'P05', owner: 'gr-conductor', missing: 'verified backend/PG-driver/configuration and canonical fenced-store original/replay report' },
  { id: 'P06', owner: 'gr-conductor', missing: 'same-tuple restart, crash/lost-ack and recovery evidence on E4' },
  { id: 'P07', owner: 'gr-conductor', missing: 'same-tuple assurance/confirmation continuation receipts and E4 step-up suite' },
  { id: 'P08', owner: 'gr-conductor', missing: 'complete installed lock/archive closure; E4 exports and disabled-install suites' },
  { id: 'P10', owner: 'gr-conductor', missing: 'verified manifest/sidecar, G1-G4/C9 dispositions; final tuple-bound receipts, owner UAT and co-acceptances' },
];
export function catalogDispositions(catalog, exists) {
  const ids = catalog.proofs.map(p => p.id).sort();
  if (ids.join() !== Array.from({ length: 10 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`).join()) {
    throw Error('Lot 3 requires a disposition for every P01-P10 proof');
  }
  return catalog.proofs.flatMap(proof => {
    const mapped = Object.values(proof.fileCases).flat();
    if (proof.requiredCases.some(id => !mapped.includes(id)) || mapped.some(id => !proof.requiredCases.includes(id)) ||
        Object.keys(proof.fileCases).some(file => !proof.files.includes(file))) throw Error(`Unmapped catalog item: ${proof.id}`);
    return proof.files.map(file => {
      if (!proof.fileCases[file]?.length) throw Error(`Unmapped catalog file: ${file}`);
      const blocked = proof.fileCases[file].some(id => PLATFORM_BLOCKED_CASES.includes(id));
      const here = !blocked && ['P01', 'P02', 'P03', 'P04', 'P07', 'P09'].includes(proof.id) &&
        /^packages\/(mcp-platform|cluster-mesh)\//.test(file);
      let disposition;
      if (blocked) disposition = 'blocked: platform-admitBridgeTools';
      else if (here) disposition = 'run here: published platform 0.4.0 regression only';
      else if (['P05', 'P06', 'P07', 'P08'].includes(proof.id) || file.startsWith('tools/memory-mcp-l5/packed/')) {
        disposition = 'deferred to lot2-manifest and same-tuple E4 qualification';
      } else if (file.startsWith('packages/mcp-broker/')) disposition = 'run by other gate: memory-l5-gate LOT=reference';
      else if (file.startsWith('tools/memory-mcp-l5/tests/')) disposition = 'run by other gate: memory-l5-tooling; final tuple receipts pending lot2-manifest';
      else throw Error(`Undisposed catalog file: ${file}`);
      const present = exists(file);
      if (here && !present) throw Error(`Lot 3 required file absent: ${file}`);
      return { id: proof.id, cases: proof.fileCases[file], file, present,
        status: blocked ? 'blocked: platform-admitBridgeTools' : here ? 'run-here' : 'out-of-lot', disposition };
    });
  });
}
