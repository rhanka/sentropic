// Retain the published substrate separately from the read-only L4 candidate.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { sha256Hex, sha512Integrity } from './schema-validator.mjs';
const root = 'spec/evidence/memory-mcp-l5/lot2';
const response = await fetch('https://registry.npmjs.org/@sentropic%2fengram/0.21.2');
if (!response.ok) throw Error(`E2 metadata: ${response.status}`);
const pkg = await response.json();
if (pkg.name !== '@sentropic/engram' || pkg.version !== '0.21.2' || !pkg.dist?.tarball?.startsWith('https://registry.npmjs.org/')) throw Error('E2 identity mismatch');
const archive = await fetch(pkg.dist.tarball);
if (!archive.ok) throw Error(`E2 archive: ${archive.status}`);
const bytes = Buffer.from(await archive.arrayBuffer()), sha256 = sha256Hex(bytes), integrity = sha512Integrity(bytes);
if (integrity !== pkg.dist.integrity) throw Error('E2 registry integrity mismatch');
mkdirSync(`${root}/archives`, { recursive: true });
writeFileSync(`${root}/archives/${sha256}.tgz`, bytes);
const e4Sha = '26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10';
const e4 = readFileSync(`${root}/archives/${e4Sha}.tgz`);
const e4Integrity = 'sha512-/TV03olHbzG+3haTC5j5YJ282egCrXak1yQE0I8DHF1kAQDwsKUe1QlMwibvBCEmPGdWeTgSHT4fF8lZJTH8cw==';
if (sha256Hex(e4) !== e4Sha || sha512Integrity(e4) !== e4Integrity) throw Error('E4 immutable archive mismatch');
const binding = { status: 'unverified', purpose: 'artifact retention only; host-bound lot2-manifest pending',
  preCandidateManifestSha256: '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730',
  e2: { name: pkg.name, version: pkg.version, path: `${root}/archives/${sha256}.tgz`, sha256, integrity, registryTarball: pkg.dist.tarball },
  e4: { name: '@sentropic/engram', version: '0.22.0', path: `${root}/archives/${e4Sha}.tgz`, sha256: e4Sha,
    integrity: e4Integrity, builtAgainstPreCandidateSha256: '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730',
    repository: 'rhanka/engram', sourceHead: 'dec7c55d5' } };
writeFileSync(`${root}/artifact-binding.json`, JSON.stringify(binding, null, 2) + '\n');
console.log(JSON.stringify(binding));
