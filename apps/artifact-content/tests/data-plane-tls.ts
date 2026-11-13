import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

// Minimal test-only X.509 writer: ephemeral keys, no committed credentials or openssl dependency.
const der = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts); const hex = body.length.toString(16).padStart(2, '0');
  const length = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  return Buffer.concat([Buffer.from([tag]), body.length < 128 ? Buffer.from([body.length])
    : Buffer.concat([Buffer.from([0x80 | length.length]), length]), body]);
};
const seq = (...parts: Buffer[]) => der(0x30, ...parts);
const oid = (hex: string) => der(6, Buffer.from(hex, 'hex'));
const integer = (value: number) => der(2, Buffer.from([value]));
const algorithm = seq(oid('2a864886f70d01010b'), der(5));
const name = (cn: string) => seq(der(0x31, seq(oid('550403'), der(12, Buffer.from(cn)))));
const time = (date: Date) => der(0x17, Buffer.from(date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const extension = (id: string, bytes: Buffer) => seq(oid(id), der(4, bytes));
function certificate(cn: string, issuer: string, key: KeyObject, ca: KeyObject, isCa = false) {
  const tbs = seq(der(0xa0, integer(2)), integer(1), algorithm, name(issuer),
    seq(time(new Date(Date.now() - 60_000)), time(new Date(Date.now() + 3600_000))), name(cn),
    key.export({ type: 'spki', format: 'der' }), der(0xa3, seq(
      extension('551d13', seq(...(isCa ? [der(1, Buffer.from([0xff]))] : []))),
      extension('551d11', seq(der(0x87, Buffer.from([127, 0, 0, 1])))),
    )));
  const bytes = seq(tbs, algorithm, der(3, Buffer.from([0]), sign('sha256', tbs, ca)));
  return `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}
export function testTls() {
  const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ca = pair(); const server = pair(); const client = pair();
  const cert = certificate('data-plane:artifact-content', 'test-ca', client.publicKey, ca.privateKey);
  const caCert = certificate('test-ca', 'test-ca', ca.publicKey, ca.privateKey, true);
  const serverCert = certificate('test-node', 'test-ca', server.publicKey, ca.privateKey);
  const pem = (key: KeyObject) => key.export({ type: 'pkcs8', format: 'pem' }).toString();
  const b64 = (value: string) => Buffer.from(value).toString('base64');
  return {
    server: { cert: serverCert, key: pem(server.privateKey), ca: caCert, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3' as const },
    ca: caCert,
    env: { APP_ARTIFACT_SANDBOX_BACKEND: 'execution-node', SANDBOX_NODE_URL: 'https://127.0.0.1',
      SANDBOX_MTLS_DATA_PLANE_CERT_B64: b64(cert), SANDBOX_MTLS_DATA_PLANE_KEY_B64: b64(pem(client.privateKey)),
      SANDBOX_MTLS_CA_CERT_B64: b64(caCert) },
  };
}
