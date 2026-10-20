// lock-fingerprint.mjs — versioned fingerprint of the resolved P1 dependency + build-tool closure.
//
// The P1 packed gate must NOT compare the whole root package-lock.json: any unrelated PR that
// touches the lockfile (new workspace dep, registry churn) would break P1 even when the packed
// bytes cannot change. Instead pack.mjs pins a fingerprint over ONLY the lock entries that feed
// the P1 output or its build, and precandidate.mjs recomputes it from the live lockfile.
// Unrelated lock edits leave the fingerprint unchanged (gate passes); relevant edits change it
// (gate fails and requires a P1 regeneration). The full lockfile sha stays in the manifest
// source as generation provenance and is never compared against later checkouts.
import { createHash } from 'node:crypto';
import { canonicalizeJson } from './schema-validator.mjs';

export const LOCK_FINGERPRINT_VERSION = 1;

// Build inputs pinned outside the lockfile that shape the packed bytes.
// typescript must match the `typescript@x.y.z` pin used by the Makefile build targets;
// sdkRange must match the platform dependency range the P1 closure is qualified against.
export const P1_BUILD_INPUTS = Object.freeze({ sdkRange: '^1.31.0', typescript: '5.4.5' });

// Resolution slots: first existing key wins so npm hoisting shifts do not count as changes.
const P1_LOCK_RESOLUTION = [
  { slot: 'workspace/mcp-platform', keys: ['packages/mcp-platform'], project: 'workspace' },
  { slot: 'workspace/mcp-broker', keys: ['packages/mcp-broker'], project: 'workspace' },
  { slot: 'resolved/@modelcontextprotocol/sdk', keys: ['node_modules/@modelcontextprotocol/sdk'], project: 'resolved' },
  {
    slot: 'resolved/typescript',
    keys: ['packages/mcp-platform/node_modules/typescript', 'packages/mcp-broker/node_modules/typescript', 'node_modules/typescript'],
    project: 'resolved',
  },
  {
    slot: 'resolved/@types/node/platform',
    keys: ['packages/mcp-platform/node_modules/@types/node', 'node_modules/@types/node'],
    project: 'resolved',
  },
  {
    slot: 'resolved/@types/node/broker',
    keys: ['packages/mcp-broker/node_modules/@types/node', 'node_modules/@types/node'],
    project: 'resolved',
  },
];

function projectWorkspace(entry) {
  return { version: entry.version ?? null, dependencies: entry.dependencies ?? null };
}

function projectResolved(entry) {
  return { version: entry.version ?? null, resolved: entry.resolved ?? null, integrity: entry.integrity ?? null };
}

export function computeLockFingerprint(lockDoc, build = P1_BUILD_INPUTS) {
  const packages = lockDoc && typeof lockDoc.packages === 'object' && lockDoc.packages !== null ? lockDoc.packages : {};
  const slots = {};
  for (const { slot, keys, project } of P1_LOCK_RESOLUTION) {
    let found = null;
    for (const key of keys) {
      const entry = packages[key];
      if (entry && typeof entry === 'object') {
        found = project === 'workspace' ? projectWorkspace(entry) : projectResolved(entry);
        break;
      }
    }
    slots[slot] = found;
  }
  return createHash('sha256').update(Buffer.from(canonicalizeJson({ version: LOCK_FINGERPRINT_VERSION, slots, build }), 'utf8')).digest('hex');
}
