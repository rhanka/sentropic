// @sentropic/llm-mesh/node/cli/agy-token-reader.ts
//
// Reads and validates the local agy OAuth login without ever logging,
// echoing, or returning raw secrets in error messages. Checks an explicit
// token file, the headless fallback file (`~/.gemini/antigravity-cli/antigravity-oauth-token`),
// and on Linux the desktop Secret Service (`service=gemini`, `username=antigravity`)
// over the D-Bus session socket with zero external dependencies.

import { lstat, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_TOKEN_FILE_BYTES = 64 * 1024;
const DBUS_TIMEOUT_MS = 5_000;

export interface AgyOAuthCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
  email?: string;
}

export class AgyTokenReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgyTokenReadError';
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const align = (pos: number, boundary: number): number =>
  (pos + (boundary - 1)) & ~(boundary - 1);

const u32le = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

const readU32le = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);

class DbusWriter {
  private readonly chunks: Uint8Array[] = [];
  private len = 0;

  pad(boundary: number): void {
    const gap = align(this.len, boundary) - this.len;
    if (gap > 0) {
      this.chunks.push(new Uint8Array(gap));
      this.len += gap;
    }
  }

  u8(value: number): void {
    this.chunks.push(new Uint8Array([value]));
    this.len += 1;
  }

  u32(value: number): void {
    this.pad(4);
    this.chunks.push(u32le(value));
    this.len += 4;
  }

  str(value: string): void {
    const encoded = textEncoder.encode(value);
    this.u32(encoded.length);
    this.chunks.push(encoded, new Uint8Array([0]));
    this.len += encoded.length + 1;
  }

  sig(value: string): void {
    const encoded = textEncoder.encode(value);
    this.u8(encoded.length);
    this.chunks.push(encoded, new Uint8Array([0]));
    this.len += encoded.length + 1;
  }

  array(elemAlign: number, writeItems: () => void): void {
    this.pad(4);
    const lenSlot = new Uint8Array(4);
    this.chunks.push(lenSlot);
    this.len += 4;
    this.pad(elemAlign);
    const start = this.len;
    writeItems();
    new DataView(lenSlot.buffer).setUint32(0, this.len - start, true);
  }

  struct(writeFields: () => void): void {
    this.pad(8);
    writeFields();
  }

  variant(signature: string, writeValue: () => void): void {
    this.sig(signature);
    writeValue();
  }

  toBytes(): Uint8Array {
    return concatBytes(this.chunks);
  }
}

class DbusReader {
  pos: number;
  constructor(private readonly bytes: Uint8Array, offset = 0) {
    this.pos = offset;
  }

  pad(boundary: number): void {
    this.pos = align(this.pos, boundary);
  }

  u8(): number {
    return this.bytes[this.pos++];
  }

  u32(): number {
    this.pad(4);
    const value = readU32le(this.bytes, this.pos);
    this.pos += 4;
    return value;
  }

  str(): string {
    const n = this.u32();
    const out = textDecoder.decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n + 1;
    return out;
  }

  sig(): string {
    const n = this.u8();
    const out = textDecoder.decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n + 1;
    return out;
  }

  byteArray(): Uint8Array {
    const n = this.u32();
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  array<T>(elemAlign: number, readItem: () => T): T[] {
    const n = this.u32();
    this.pad(elemAlign);
    const end = this.pos + n;
    const out: T[] = [];
    while (this.pos < end) out.push(readItem());
    return out;
  }

  skipVariant(): void {
    const signature = this.sig();
    if (signature === 's' || signature === 'o') this.str();
    else if (signature === 'u' || signature === 'i' || signature === 'b') this.u32();
    else if (signature === 'y') this.u8();
    else if (signature === 'ay') this.byteArray();
    else throw new AgyTokenReadError('unsupported D-Bus variant');
  }
}

interface DbusMessage {
  type: number;
  replySerial?: number;
  errorName?: string;
  body: Uint8Array;
}

const buildMethodCall = (
  serial: number,
  dest: string,
  path: string,
  iface: string,
  member: string,
  bodySig = '',
  body: Uint8Array = new Uint8Array(0),
): Uint8Array => {
  const header = new DbusWriter();
  header.u8(0x6c); // little-endian
  header.u8(1); // METHOD_CALL
  header.u8(0); // flags
  header.u8(1); // protocol version
  header.u32(body.length);
  header.u32(serial);
  header.array(8, () => {
    const field = (code: number, sig: string, fn: () => void) =>
      header.struct(() => { header.u8(code); header.variant(sig, fn); });
    field(1, 'o', () => header.str(path));
    field(2, 's', () => header.str(iface));
    field(3, 's', () => header.str(member));
    field(6, 's', () => header.str(dest));
    if (bodySig) field(8, 'g', () => header.sig(bodySig));
  });
  header.pad(8);
  return concatBytes([header.toBytes(), body]);
};

const drainMessages = (
  state: { buf: Uint8Array },
  onMessage: (msg: DbusMessage) => void,
): void => {
  while (state.buf.length >= 16) {
    if (state.buf[0] !== 0x6c) throw new AgyTokenReadError('unexpected D-Bus endianness');
    const type = state.buf[1];
    const bodyLen = readU32le(state.buf, 4);
    const hdrArrayLen = readU32le(state.buf, 12);
    const hdrEnd = align(16 + hdrArrayLen, 8);
    const total = hdrEnd + bodyLen;
    if (state.buf.length < total) break;
    const msgBuf = state.buf.subarray(0, total);
    state.buf = state.buf.subarray(total);
    const hr = new DbusReader(msgBuf, 12);
    let replySerial: number | undefined;
    let errorName: string | undefined;
    hr.array(8, () => {
      hr.pad(8);
      const code = hr.u8();
      const vsig = hr.sig();
      if (vsig === 'u') {
        const val = hr.u32();
        if (code === 5) replySerial = val;
      } else if (vsig === 's' || vsig === 'o') {
        const val = hr.str();
        if (code === 4) errorName = val;
      } else if (vsig === 'g') {
        hr.sig();
      }
    });
    onMessage({ type, replySerial, errorName, body: msgBuf.subarray(hdrEnd) });
  }
};

const toAsciiHex = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    out += value.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return out;
};

const resolveDbusSocketPath = (env: Record<string, string | undefined>): string | null => {
  const addr = env.DBUS_SESSION_BUS_ADDRESS ?? '';
  const match = /unix:path=([^,;]+)/.exec(addr);
  if (match?.[1]) return match[1];
  const uid = process.getuid?.();
  return typeof uid === 'number' ? `/run/user/${uid}/bus` : null;
};

export const readAgyOAuthFromLinuxSecretService = async (
  socketPath: string,
  uid: number,
): Promise<string | null> => {
  const sock = createConnection(socketPath);
  sock.setTimeout(DBUS_TIMEOUT_MS);
  let serial = 1;
  let authed = false;
  let authRaw = new Uint8Array(0);
  const state = { buf: new Uint8Array(0) };
  const pending = new Map<number, { resolve: (m: DbusMessage) => void; reject: (e: Error) => void }>();

  const failAll = (err: Error) => {
    for (const waiter of pending.values()) waiter.reject(err);
    pending.clear();
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    sock.on('timeout', () => {
      const err = new AgyTokenReadError('OS keyring lookup timed out');
      failAll(err);
      sock.destroy();
      done(err);
    });
    sock.on('error', () => {
      const err = new AgyTokenReadError('OS keyring D-Bus connection unavailable');
      failAll(err);
      done(err);
    });
    sock.on('connect', () => {
      sock.write(`\0AUTH EXTERNAL ${toAsciiHex(String(uid))}\r\n`);
    });
    sock.on('data', (chunk) => {
      if (!authed) {
        authRaw = concatBytes([authRaw, chunk]);
        const text = textDecoder.decode(authRaw);
        const crlf = text.indexOf('\r\n');
        if (crlf === -1) return;
        const line = text.slice(0, crlf);
        if (!line.startsWith('OK ')) {
          done(new AgyTokenReadError('OS keyring D-Bus authentication refused'));
          return;
        }
        authed = true;
        const restOffset = textEncoder.encode(line).length + 2;
        if (restOffset < authRaw.length) {
          state.buf = concatBytes([state.buf, authRaw.subarray(restOffset)]);
        }
        sock.write('BEGIN\r\n');
        done();
        return;
      }
      state.buf = concatBytes([state.buf, chunk]);
      try {
        drainMessages(state, (msg) => {
          if ((msg.type === 2 || msg.type === 3) && msg.replySerial !== undefined) {
            const waiter = pending.get(msg.replySerial);
            if (!waiter) return;
            pending.delete(msg.replySerial);
            if (msg.type === 3) waiter.reject(new AgyTokenReadError(`OS keyring error: ${msg.errorName ?? 'unknown'}`));
            else waiter.resolve(msg);
          }
        });
      } catch (err) {
        failAll(err instanceof Error ? err : new AgyTokenReadError('OS keyring protocol error'));
      }
    });
  });

  const call = (
    dest: string,
    path: string,
    iface: string,
    member: string,
    bodySig = '',
    body?: Uint8Array,
  ): Promise<DbusMessage> => {
    const id = serial;
    serial += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      sock.write(buildMethodCall(id, dest, path, iface, member, bodySig, body));
    });
  };

  try {
    await call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'Hello');
    const osW = new DbusWriter();
    osW.str('plain');
    osW.variant('s', () => osW.str(''));
    const osReply = await call(
      'org.freedesktop.secrets', '/org/freedesktop/secrets',
      'org.freedesktop.Secret.Service', 'OpenSession', 'sv', osW.toBytes(),
    );
    const osR = new DbusReader(osReply.body);
    osR.skipVariant();
    const sessionPath = osR.str();

    const siW = new DbusWriter();
    siW.array(8, () => {
      siW.struct(() => { siW.str('service'); siW.str('gemini'); });
      siW.struct(() => { siW.str('username'); siW.str('antigravity'); });
    });
    const siReply = await call(
      'org.freedesktop.secrets', '/org/freedesktop/secrets',
      'org.freedesktop.Secret.Service', 'SearchItems', 'a{ss}', siW.toBytes(),
    );
    const siR = new DbusReader(siReply.body);
    const unlocked = siR.array(4, () => siR.str());
    if (unlocked.length === 0) return null;

    const gsW = new DbusWriter();
    gsW.str(sessionPath);
    const gsReply = await call(
      'org.freedesktop.secrets', unlocked[0],
      'org.freedesktop.Secret.Item', 'GetSecret', 'o', gsW.toBytes(),
    );
    const gsR = new DbusReader(gsReply.body);
    gsR.pad(8);
    gsR.str(); // session path
    gsR.byteArray(); // params
    return textDecoder.decode(gsR.byteArray());
  } finally {
    sock.end();
  }
};

const readRegularBoundedFile = async (filePath: string): Promise<string | null> => {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') {
      return null;
    }
    throw new AgyTokenReadError('agy token file could not be inspected');
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AgyTokenReadError('agy token path must be a regular file');
  }
  if (info.size > MAX_TOKEN_FILE_BYTES) {
    throw new AgyTokenReadError('agy token file exceeds maximum allowed size');
  }
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    throw new AgyTokenReadError('agy token file could not be read');
  }
};

const cleanToken = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
};

/** Parse agy OAuth JSON payload; never echoes raw content or secrets on error. */
export const parseAgyOAuthTokenPayload = (raw: string): AgyOAuthCredential => {
  if (textEncoder.encode(raw).length > MAX_TOKEN_FILE_BYTES) {
    throw new AgyTokenReadError('agy credential payload exceeds maximum allowed size');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new AgyTokenReadError('agy credential payload is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgyTokenReadError('agy credential payload must be a JSON object');
  }
  const root = parsed as Record<string, unknown>;
  const inner = root.token && typeof root.token === 'object' && !Array.isArray(root.token)
    ? (root.token as Record<string, unknown>)
    : root;
  const accessToken = cleanToken(inner.access_token ?? inner.accessToken);
  if (!accessToken) {
    throw new AgyTokenReadError('agy credential is missing a valid access token');
  }
  const refreshToken = cleanToken(inner.refresh_token ?? inner.refreshToken);
  if (!refreshToken) {
    throw new AgyTokenReadError('agy credential is missing a refresh token; re-authenticate agy first');
  }
  const rawExpiry = inner.expiry ?? inner.expiresAt;
  const parsedExpiry = typeof rawExpiry === 'string' && rawExpiry.trim()
    ? Date.parse(rawExpiry)
    : Number.NaN;
  const email = typeof root.id_token_email === 'string' && root.id_token_email.trim()
    ? root.id_token_email.trim()
    : undefined;
  return {
    accessToken,
    refreshToken,
    ...(Number.isFinite(parsedExpiry) ? { expiresAt: new Date(parsedExpiry).toISOString() } : {}),
    ...(email ? { email } : {}),
  };
};

export const readAgyOAuthCredential = async (options: {
  agyTokenFile?: string;
  env?: Record<string, string | undefined>;
  readRaw?: () => Promise<string>;
}): Promise<AgyOAuthCredential> => {
  if (options.readRaw) {
    return parseAgyOAuthTokenPayload(await options.readRaw());
  }
  if (options.agyTokenFile) {
    const fileRaw = await readRegularBoundedFile(options.agyTokenFile);
    if (fileRaw === null) {
      throw new AgyTokenReadError('agy token file not found');
    }
    return parseAgyOAuthTokenPayload(fileRaw);
  }
  const env = options.env ?? process.env;
  const home = env.HOME || homedir();
  const defaultPath = join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
  const fallbackRaw = await readRegularBoundedFile(defaultPath);
  if (fallbackRaw !== null) {
    return parseAgyOAuthTokenPayload(fallbackRaw);
  }
  if (process.platform === 'linux') {
    const socketPath = resolveDbusSocketPath(env);
    const uid = process.getuid?.();
    if (socketPath && typeof uid === 'number') {
      const secretRaw = await readAgyOAuthFromLinuxSecretService(socketPath, uid);
      if (secretRaw !== null) {
        return parseAgyOAuthTokenPayload(secretRaw);
      }
    }
  }
  throw new AgyTokenReadError(
    'agy OAuth credential not found in ~/.gemini/antigravity-cli/antigravity-oauth-token or OS keyring',
  );
};
