#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const START = '// cloud-code-oauth-credential:start';
const END = '// cloud-code-oauth-credential:end';
const DEFAULT_SOURCE = fileURLToPath(
  new URL('../src/enrollment/cloud-code.ts', import.meta.url),
);

export const fingerprint = (value) =>
  createHash('sha256').update(value).digest('hex');

export function validateCredential(value) {
  if (!/^GOCSPX-[A-Za-z0-9_-]{28}$/.test(value)) {
    throw new Error('OAuth client credential has an invalid format');
  }
  return value;
}

const fragmentsFor = (value) => [value.slice(0, 7), value.slice(7, 21), value.slice(21)];

export function renderCredentialBlock(value) {
  const fragments = fragmentsFor(validateCredential(value));
  return [
    START,
    `export const CLOUD_CODE_CLIENT_SECRET = [${fragments.map((part) => `'${part}'`).join(', ')}].join('');`,
    END,
  ].join('\n');
}

export function parseCredential(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error('OAuth credential markers are missing');
  const block = source.slice(start, end + END.length);
  const declaration = block.match(
    /export const CLOUD_CODE_CLIENT_SECRET = \[([\s\S]*?)\]\.join\(['"]{2}\);/,
  );
  if (!declaration) throw new Error('OAuth credential declaration is malformed');
  const fragments = [...declaration[1].matchAll(/['"]([A-Za-z0-9_-]+)['"]/g)].map(
    (match) => match[1],
  );
  if (fragments.length !== 3) throw new Error('OAuth credential fragments are malformed');
  return validateCredential(fragments.join(''));
}

export function replaceCredential(source, value) {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error('OAuth credential markers are missing');
  return `${source.slice(0, start)}${renderCredentialBlock(value)}${source.slice(end + END.length)}`;
}

export function selectCredentialFromBinary(buffer, expectedBinaryHash, expectedCredentialHash) {
  const actualBinaryHash = createHash('sha256').update(buffer).digest('hex');
  if (actualBinaryHash !== expectedBinaryHash.toLowerCase()) {
    throw new Error('Antigravity binary checksum mismatch');
  }
  const candidates = [
    ...new Set(buffer.toString('latin1').match(/GOCSPX-[A-Za-z0-9_-]{28}/g) ?? []),
  ].map(validateCredential);
  const matches = expectedCredentialHash
    ? candidates.filter((candidate) => fingerprint(candidate) === expectedCredentialHash.toLowerCase())
    : candidates;
  if (matches.length !== 1) {
    const hashes = candidates.map(fingerprint).sort().join(', ') || 'none';
    throw new Error(`Expected exactly one OAuth credential candidate; fingerprints: ${hashes}`);
  }
  return matches[0];
}

async function walkFiles(root) {
  const entries = await readdir(root);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry);
    if ((await stat(path)).isDirectory()) files.push(...(await walkFiles(path)));
    else files.push(path);
  }
  return files;
}

export async function verifyDist(distDir, expected) {
  const target = resolve(distDir, 'enrollment/cloud-code.js');
  const targetText = await readFile(target, 'utf8');
  if (parseCredential(targetText) !== expected) {
    throw new Error('Built OAuth credential does not match the protected reference');
  }
  const sensitiveFragments = fragmentsFor(expected).filter((part) => part.length >= 12);
  for (const path of await walkFiles(distDir)) {
    if (resolve(path) === target) continue;
    const content = await readFile(path, 'utf8');
    if (sensitiveFragments.some((fragment) => content.includes(fragment))) {
      throw new Error(`OAuth credential fragment leaked outside enrollment/cloud-code.js: ${path}`);
    }
  }
}

function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') options.write = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[key] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = await readFile(options.source, 'utf8');
  let credential;
  if (options.credentialFile) {
    credential = validateCredential((await readFile(options.credentialFile, 'utf8')).trim());
  } else if (options.agyBinary) {
    if (!options.agySha256) throw new Error('--agy-sha256 is required with --agy-binary');
    credential = selectCredentialFromBinary(
      await readFile(options.agyBinary),
      options.agySha256,
      options.expectedFingerprint,
    );
  } else {
    credential = parseCredential(source);
  }
  if (
    options.expectedFingerprint &&
    fingerprint(credential) !== options.expectedFingerprint.toLowerCase()
  ) {
    throw new Error('OAuth credential fingerprint mismatch');
  }
  if (options.write) await writeFile(options.source, replaceCredential(source, credential), 'utf8');
  else if (parseCredential(source) !== credential) {
    throw new Error('Committed OAuth credential does not match the protected reference');
  }
  if (options.distDir) await verifyDist(options.distDir, credential);
  process.stdout.write(`OAuth credential verified: sha256:${fingerprint(credential)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : 'unknown failure'}\n`);
    process.exitCode = 1;
  });
}
