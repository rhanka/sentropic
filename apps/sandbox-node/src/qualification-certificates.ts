import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

// Qualification-only ephemeral X.509 identities. Never reads installed credentials.
const der = (tag: number, ...parts: Buffer[]) => {
  const bytes = Buffer.concat(parts), n = bytes.length;
  return Buffer.concat([Buffer.from([tag, ...(n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255])]), bytes]);
};
const seq = (...parts: Buffer[]) => der(0x30, ...parts);
const oid = (...bytes: number[]) => der(6, Buffer.from(bytes));
const algorithm = seq(oid(43, 101, 112));
const integer = (n: number) => der(2, Buffer.from([n]));
const name = (cn: string) => seq(der(0x31, seq(oid(85, 4, 3), der(0x0c, Buffer.from(cn)))));
const pem = (bytes: Buffer) => `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
function certificate(subject: string, key: KeyObject, signer: KeyObject, serial: number, ca = false) {
  const extensions = ca ? seq(oid(85, 29, 19), der(1, Buffer.from([255])), der(4, seq(der(1, Buffer.from([255])))))
    : seq(oid(85, 29, 17), der(4, seq(der(0x82, Buffer.from('localhost')))));
  const tbs = seq(der(0xa0, integer(2)), integer(serial), algorithm, name('qualification-ca'),
    seq(der(0x17, Buffer.from('200101000000Z')), der(0x17, Buffer.from('400101000000Z'))), name(subject),
    key.export({ type: 'spki', format: 'der' }), der(0xa3, seq(extensions)));
  return pem(seq(tbs, algorithm, der(3, Buffer.from([0]), sign(null, tbs, signer))));
}
export function qualificationCertificates() {
  const root = generateKeyPairSync('ed25519'); let serial = 1;
  const identity = (cn: string) => {
    const key = generateKeyPairSync('ed25519');
    return { cert: certificate(cn, key.publicKey, root.privateKey, ++serial),
      key: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  };
  return { ca: certificate('qualification-ca', root.publicKey, root.privateKey, 1, true),
    server: identity('localhost'), dataPlane: identity('data-plane:artifact-content'),
    controlPlane: identity('control-plane:sentropic-api'), wrong: identity('qualification:wrong') };
}
