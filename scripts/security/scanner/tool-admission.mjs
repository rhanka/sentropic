import { digest, policy as defaultPolicy } from '../daily/toolchain-contract.mjs';
import { requireContract as check, text, hash, literal, record, equal, CONTRACT_ONLY } from './contract-schema.mjs';
import { TOOL_ROLES, moduleList, validateToolInventory, validateToolSelfSca, validateToolDependencies, validateZeroPython } from './tool-qualification.mjs';

const canonical = value => JSON.stringify(value);
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const reviewSchema = record({ identity: text, model: text, disposition: literal('approved'), digest: hash });

// Produces the candidate-bound tool admission receipt. Contract validation only:
// productionAdmitted stays false until independent live qualification (A15).
export function admitToolCandidate({ inventory, manifest, recipe, policy: p = defaultPolicy, evidenceFiles,
  reports, dependencies, zeroPython, review, now } = {}) {
  const { inventory: inv, unresolved } = validateToolInventory({ inventory, manifest, recipe, policy: p, evidenceFiles });
  check(unresolved.length === 0, `pending tool pins: ${unresolved.join(',')}`);
  check(Number.isFinite(now), 'observation time');
  check(reviewSchema(review), 'independent review');
  const byRole = Object.fromEntries(inv.roles.map(r => [r.role, r]));
  const tools = [];
  for (const role of TOOL_ROLES) {
    const tool = byRole[role];
    const sca = validateToolSelfSca(tool, reports?.[role], { now, policy: p });
    check(sca.highCritical === 0, `vulnerable tool ${role}: ${sca.highCritical} HIGH/CRITICAL`);
    const deps = dependencies?.[role];
    check(deps && moduleList(deps.embedded) && moduleList(deps.inventory), `dependency inventory: ${role}`);
    const dep = validateToolDependencies(tool, deps.embedded, deps.inventory);
    const zero = validateZeroPython(tool, zeroPython?.[role]);
    if (role === 'root-bootstrap') check(now <= Date.parse(tool.refreshBy), 'root bootstrap expired');
    tools.push({ role, digest: tool.digest, size: tool.size, selfScaDigest: sca.reportDigest,
      dependenciesDigest: dep.dependenciesDigest, zeroPythonDigest: zero.zeroPythonDigest });
  }
  return { type: 'ToolAdmissionReceiptV1', schemaVersion: 1, lot: 'ACT-L02',
    acceptanceIds: ['L2-A', 'L2-B', 'L2-E', 'T5-S2', 'T5-S3', 'T5-S4', 'T5-S5'],
    candidateBound: true, admittedAt: iso(now), inventoryDigest: digest(canonical(inv)),
    review, tools, contractValid: true, productionAdmitted: false };
}

// Recomputes the admission from the same inputs; any rehashed or tampered field refuses.
export function validateAdmissionReceipt(receipt, inputs = {}) {
  check(equal(receipt, admitToolCandidate(inputs)), 'admission receipt binding');
  return CONTRACT_ONLY;
}
