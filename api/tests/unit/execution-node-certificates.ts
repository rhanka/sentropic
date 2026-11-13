import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

// Synthetic Ed25519 X.509 fixtures generated in memory. No host tools, keys on disk or network CA.
const der = (tag: number, ...parts: Buffer[]) => {
  const bytes = Buffer.concat(parts); const size = bytes.length;
  return Buffer.concat([Buffer.from([tag, ...(size < 128 ? [size] : size < 256 ? [0x81, size] : [0x82, size >> 8, size & 255])]), bytes]);
};
const seq = (...parts: Buffer[]) => der(0x30, ...parts);
const oid = (...bytes: number[]) => der(6, Buffer.from(bytes));
const algorithm = seq(oid(43, 101, 112));
const integer = (value: number) => der(2, Buffer.from([value]));
const name = (cn: string) => seq(der(0x31, seq(oid(85, 4, 3), der(0x0c, Buffer.from(cn)))));
const pem = (type: string, bytes: Buffer) => `-----BEGIN ${type}-----\n${bytes.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${type}-----\n`;
function certificate(subject: string, key: KeyObject, issuer: string, signer: KeyObject, serial: number, ca = false) {
  const extensions = ca ? seq(oid(85, 29, 19), der(1, Buffer.from([255])), der(4, seq(der(1, Buffer.from([255])))))
    : seq(oid(85, 29, 17), der(4, seq(der(0x82, Buffer.from('localhost')))));
  const tbs = seq(der(0xa0, integer(2)), integer(serial), algorithm, name(issuer),
    seq(der(0x17, Buffer.from('200101000000Z')), der(0x17, Buffer.from('400101000000Z'))), name(subject),
    key.export({ type: 'spki', format: 'der' }), der(0xa3, seq(extensions)));
  return pem('CERTIFICATE', seq(tbs, algorithm, der(3, Buffer.from([0]), sign(null, tbs, signer))));
}
export function nodeCertificates() {
  const root = generateKeyPairSync('ed25519'); const server = generateKeyPairSync('ed25519');
  const client = generateKeyPairSync('ed25519');
  const ca = certificate('test-ca', root.publicKey, 'test-ca', root.privateKey, 1, true);
  return { ca, server: { cert: certificate('localhost', server.publicKey, 'test-ca', root.privateKey, 2),
    key: server.privateKey.export({ type: 'pkcs8', format: 'pem' }) },
    dataPlane: { cert: certificate('data-plane:artifact-content', client.publicKey, 'test-ca', root.privateKey, 4),
      key: client.privateKey.export({ type: 'pkcs8', format: 'pem' }) },
    client: { cert: certificate('control-plane:sentropic-api', client.publicKey, 'test-ca', root.privateKey, 3),
      key: client.privateKey.export({ type: 'pkcs8', format: 'pem' }) } };
}
