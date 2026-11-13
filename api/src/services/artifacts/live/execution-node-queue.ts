import type { ExecutionNodeTenantId } from '../../../../../apps/sandbox-node/src/contract';
import { ExecutionNodeRefusal } from './execution-node-transport';

type Work = { run(): Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void };
/** Quantum-one eligible-head alternation. Two outstanding per tenant includes active service.
 * Agent AdmissionLedger remains the cross-replica authority; callers must retain this service
 * until stop/export/DELETE confirms destruction, never release it at child build exit.
 */
export function executionNodeQueue() {
  const queues: Record<ExecutionNodeTenantId, Work[]> = { sentropic: [], immo: [] };
  const counts = { sentropic: 0, immo: 0 };
  let active = false; let last: ExecutionNodeTenantId = 'immo';
  async function next() {
    if (active) return;
    const other = last === 'sentropic' ? 'immo' : 'sentropic';
    const tenant = queues[other].length ? other : last;
    const work = queues[tenant].shift(); if (!work) return;
    active = true; last = tenant;
    try { work.resolve(await work.run()); } catch (error) { work.reject(error); }
    finally { counts[tenant]--; active = false; void next(); }
  }
  return {
    run<T>(tenant: ExecutionNodeTenantId, work: () => Promise<T>): Promise<T> {
      if (!Object.hasOwn(queues, tenant) || counts[tenant] >= 2) return Promise.reject(new ExecutionNodeRefusal('tenant_quota_exceeded', 429, 1000));
      counts[tenant]++;
      return new Promise<T>((resolve, reject) => {
        queues[tenant].push({ run: work, resolve: value => resolve(value as T), reject }); void next();
      });
    },
  };
}

/** D3-A: no mirror or mutable checkout on API disks. Coalesce only concurrent observations;
 * delete on settlement so every later observation sees external branch changes immediately.
 * Key includes tenant, binding generation and repository coordinates, supplied by host auth.
 */
export function statelessNodeSources<T>(observe: (key: string) => Promise<T>) {
  const pending = new Map<string, Promise<T>>();
  return (tenant: ExecutionNodeTenantId, authorizedBinding: string) => {
    const key = JSON.stringify([tenant, authorizedBinding]);
    let result = pending.get(key);
    if (!result) {
      result = observe(key).finally(() => { if (pending.get(key) === result) pending.delete(key); });
      pending.set(key, result);
    }
    return result;
  };
}
