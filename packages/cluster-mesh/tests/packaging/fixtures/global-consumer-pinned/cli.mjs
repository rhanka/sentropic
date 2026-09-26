#!/usr/bin/env node
// Negative: the consumer keeps its own cluster-mesh (nested in its global tree) next to
// the separately installed runtime's copy, so two physical copies load in one process.
import { verifyClusterMeshTopology } from '@sentropic/cluster-mesh';

const error = await import('fixture-separate-runtime').then(() => undefined, (caught) => caught);
let preflight;
try {
  verifyClusterMeshTopology();
} catch (caught) {
  preflight = caught.reason;
}
console.log(JSON.stringify({ code: error?.code, reason: error?.reason, paths: error?.paths, preflight }));
