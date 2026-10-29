// Decode the native Go build-info header; no Go toolchain or install hooks are needed.
import { readFile, writeFile } from 'node:fs/promises';
import { digest, requireEvidence } from './toolchain-contract.mjs';
const requested = process.argv.slice(2);
for (const name of requested.length ? requested : ['trivy', 'cosign']) {
  requireEvidence(['trivy', 'cosign', 'cosign-latest'].includes(name), 'native inventory filename');
  const bytes = await readFile(`/evidence/${name}`);
  const offset = bytes.indexOf(Buffer.from('\xff Go buildinf:', 'latin1'));
  requireEvidence(offset >= 0 && bytes[offset + 14] === 8 && bytes[offset + 15] === 2, 'Go inline build info');
  let position = offset + 32;
  const readString = () => {
    let size = 0, shift = 0, next;
    do { next = bytes[position++]; size += (next & 127) * 2 ** shift; shift += 7; }
    while (next & 128 && shift < 53);
    requireEvidence(size > 0 && position + size <= bytes.length, 'Go build-info size');
    const value = bytes.subarray(position, position + size).toString();
    position += size;
    return value;
  };
  const goVersion = readString();
  const module = readString().slice(16, -16);
  await writeFile(`/evidence/${name}-buildinfo.txt`, `${goVersion}\n${module}`);
  console.log(JSON.stringify({ name, sha256: digest(bytes), bytes: bytes.length, goVersion,
    buildInfoHash: digest(`${goVersion}\n${module}`), dependencyCount: module.split('\n').filter(line => line.startsWith('dep\t')).length }));
}
