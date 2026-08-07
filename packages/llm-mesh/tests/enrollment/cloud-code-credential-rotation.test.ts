import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fingerprint,
  parseCredential,
  renderCredentialBlock,
  replaceCredential,
  selectCredentialFromBinary,
  verifyDist,
} from '../../scripts/cloud-code-oauth-credential.mjs';

const credentialA = `GOCSPX-${'a'.repeat(28)}`;
const credentialB = `GOCSPX-${'b'.repeat(28)}`;
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('Cloud Code OAuth credential rotation', () => {
  it('renders and replaces the credential deterministically', () => {
    const source = `before\n${renderCredentialBlock(credentialA)}\nafter`;
    const replaced = replaceCredential(source, credentialB);

    expect(parseCredential(replaced)).toBe(credentialB);
    expect(replaceCredential(source, credentialB)).toBe(replaced);
    expect(replaced).not.toContain(credentialB);
  });

  it('pins the Antigravity binary and fails closed on ambiguous candidates', () => {
    const binary = Buffer.from(`${credentialA}\0${credentialB}`, 'latin1');
    const binaryHash = createHash('sha256').update(binary).digest('hex');

    expect(() => selectCredentialFromBinary(binary, '0'.repeat(64))).toThrow(
      'binary checksum mismatch',
    );
    let error = '';
    try {
      selectCredentialFromBinary(binary, binaryHash);
    } catch (caught) {
      error = String(caught);
    }
    expect(error).toContain('Expected exactly one');
    expect(error).not.toContain(credentialA);
    expect(error).not.toContain(credentialB);
    expect(selectCredentialFromBinary(binary, binaryHash, fingerprint(credentialB))).toBe(
      credentialB,
    );
  });

  it('accepts only the intended built module and rejects source-map leakage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cloud-code-credential-'));
    tempRoots.push(root);
    const enrollment = join(root, 'enrollment');
    await mkdir(enrollment, { recursive: true });
    await writeFile(join(enrollment, 'cloud-code.js'), renderCredentialBlock(credentialA));
    await writeFile(join(enrollment, 'cloud-code.js.map'), '{}');

    await expect(verifyDist(root, credentialA)).resolves.toBeUndefined();

    await writeFile(join(enrollment, 'cloud-code.js.map'), credentialA.slice(7, 21));
    await expect(verifyDist(root, credentialA)).rejects.toThrow('leaked outside');
  });
});
