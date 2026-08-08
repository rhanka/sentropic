// Exception-aware npm-audit gate (replaces the raw `npm audit --audit-level=high`
// in api/Dockerfile + ui/Dockerfile). It FAILS the build on any HIGH/CRITICAL
// advisory whose GHSA id is NOT in .security/audit-allowlist.json, and FAILS
// unconditionally once an allowlisted entry passes its review_due (so time-boxed
// exceptions cannot linger silently). Human record + justification for each
// allowlisted GHSA lives in .security/vulnerability-register.yaml.
//
// Usage (mirrors the audit scope of each Dockerfile stage):
//   node .security/audit-gate.mjs --omit=dev --workspaces --include-workspace-root
//   node .security/audit-gate.mjs --omit=dev
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2).join(' ') || '--omit=dev';
// AUDIT_GATE_TODAY overridable only for tests; production uses the real date.
const today = process.env.AUDIT_GATE_TODAY || new Date().toISOString().slice(0, 10);

const allowlist = JSON.parse(
  readFileSync(new URL('./audit-allowlist.json', import.meta.url), 'utf8'),
);
const allowed = new Map((allowlist.allow || []).map((e) => [e.ghsa, e]));

// Hard-expire: a past-due exception fails the build so it must be revisited.
const expired = [...allowed.values()].filter((e) => today > e.review_due);
if (expired.length) {
  console.error('audit-gate: FAIL — allowlist entries past review_due, revisit:');
  for (const e of expired) console.error(`  ${e.ghsa} (review_due ${e.review_due})`);
  process.exit(1);
}

// npm audit exits non-zero when vulnerabilities exist; capture stdout either way.
let raw = '';
try {
  raw = execSync(`npm audit --json ${args}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  raw = e.stdout ? e.stdout.toString() : '';
}
if (!raw) {
  console.error('audit-gate: FAIL — no audit output');
  process.exit(1);
}
const vulns = JSON.parse(raw).vulnerabilities || {};

// Collect every GHSA id reachable for a package through the `via` graph.
const ghsaOf = (name, seen = new Set()) => {
  if (seen.has(name)) return [];
  seen.add(name);
  const v = vulns[name];
  if (!v) return [];
  const ids = [];
  for (const via of v.via || []) {
    if (typeof via === 'string') ids.push(...ghsaOf(via, seen));
    else if (via && via.url) {
      const m = via.url.match(/GHSA-[a-z0-9-]+/i);
      if (m) ids.push(m[0]);
    }
  }
  return ids;
};

const offenders = [];
for (const [name, v] of Object.entries(vulns)) {
  if (!['high', 'critical'].includes(v.severity)) continue;
  const ids = [...new Set(ghsaOf(name))];
  const unallowed = ids.filter((g) => !allowed.has(g));
  // Fail if we cannot map it to any GHSA, or any of its GHSAs is not allowlisted.
  if (ids.length === 0 || unallowed.length) {
    offenders.push(
      `${name} (${v.severity}) ghsa=[${ids.join(',') || 'unresolved'}]` +
        (unallowed.length ? ` unallowlisted=[${unallowed.join(',')}]` : ''),
    );
  }
}

if (offenders.length) {
  console.error('audit-gate: FAIL — unallowlisted HIGH/CRITICAL advisories:');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log(
  `audit-gate: OK — only allowlisted HIGH/CRITICAL remain [${[...allowed.keys()].join(', ')}]`,
);
