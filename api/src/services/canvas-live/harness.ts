import type { AdmissionRecord } from './admission';
import type { FieldBindingIdentity } from './contracts';
import { SessionRegistry } from './session-registry';

export type OfflineHarnessProvider = 'hocuspocus' | 'in-memory-double';

export interface OfflineHarnessResult {
  provider: OfflineHarnessProvider;
  resolvedByFullIdentity: boolean;
  twoFieldsConverge: boolean;
  survivorStaysLive: boolean;
  missingCoordinateFailsClosed: boolean;
  wrongFieldFailsClosed: boolean;
  dependencyClosure: Record<string, string>;
}

/**
 * Dependency closure pinned by the H3 lot and verified against the workspace
 * install by tests/api/canvas-live-harness.test.ts.
 */
export function H3_DEPENDENCY_CLOSURE(): Record<string, string> {
  return {
    yjs: '13.6.33',
    'y-protocols': '1.0.7',
    '@hocuspocus/server': '4.7.1',
    '@hocuspocus/provider': '4.7.1',
  };
}

export async function runOfflineHarness(options: {
  provider: OfflineHarnessProvider;
  registry: SessionRegistry;
  record: AdmissionRecord;
  applyRemoteText: (identity: FieldBindingIdentity, text: string) => void | Promise<void>;
  readText: (identity: FieldBindingIdentity) => string;
}): Promise<OfflineHarnessResult> {
  const first = options.registry.open(options.record, 'description');
  const second = options.registry.open(options.record, 'notes');
  const byFullIdentity =
    options.registry.resolveBinding(options.record, first.identity).identity === first.identity &&
    options.registry.resolveBinding(options.record, second.identity).identity === second.identity;
  await options.applyRemoteText(first.identity, 'hello');
  await options.applyRemoteText(second.identity, 'world');
  const twoFieldsConverge =
    options.readText(first.identity).includes('hello') && options.readText(second.identity).includes('world');
  await first.dispose();
  let survivorStaysLive = false;
  try {
    await options.applyRemoteText(second.identity, 'world+local');
    survivorStaysLive = options.readText(second.identity).includes('world+local');
  } catch {
    survivorStaysLive = false;
  }
  let missingCoordinateFailsClosed = false;
  try {
    options.registry.resolveBinding(options.record, {
      documentId: options.record.documentId,
      sessionId: options.record.sessionId,
      fieldKey: '',
    });
  } catch {
    missingCoordinateFailsClosed = true;
  }
  let wrongFieldFailsClosed = false;
  try {
    options.registry.resolveBinding(options.record, {
      documentId: options.record.documentId,
      sessionId: options.record.sessionId,
      fieldKey: 'other',
    });
  } catch {
    wrongFieldFailsClosed = true;
  }
  await second.dispose();
  return {
    provider: options.provider,
    resolvedByFullIdentity: byFullIdentity,
    twoFieldsConverge,
    survivorStaysLive,
    missingCoordinateFailsClosed,
    wrongFieldFailsClosed,
    dependencyClosure: H3_DEPENDENCY_CLOSURE(),
  };
}

export function assertHarnessForDsWitness8(result: OfflineHarnessResult): void {
  const failures: string[] = [];
  if (!result.resolvedByFullIdentity) failures.push('handle.identity resolution');
  if (!result.twoFieldsConverge) failures.push('R-BIND-3 two-fields convergence');
  if (!result.survivorStaysLive) failures.push('R-BIND-3 survivor liveness');
  if (!result.missingCoordinateFailsClosed) failures.push('missing-coordinate fail-closed');
  if (!result.wrongFieldFailsClosed) failures.push('wrong-field fail-closed');
  if (failures.length > 0) throw new Error(`DS witness 8(i) incomplete: ${failures.join(', ')}`);
}
