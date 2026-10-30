import { readFile, writeFile } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';

const root = JSON.parse(await readFile('/evidence/trusted_root.json'));
const unrelatedCA = rootCertificates[0].replace(/-----[^-]+-----|\s/g, '');
for (const authority of root.certificateAuthorities) {
  authority.certChain.certificates = [{ rawBytes: unrelatedCA }];
}
await writeFile('/controls/wrong-root.json', JSON.stringify(root));
const bundle = JSON.parse(await readFile('/evidence/bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json'));
const signature = bundle.dsseEnvelope.signatures[0];
const bytes = Buffer.from(signature.sig, 'base64');
bytes[0] ^= 1;
signature.sig = bytes.toString('base64');
await writeFile('/controls/wrong-bundle.json', JSON.stringify(bundle));
