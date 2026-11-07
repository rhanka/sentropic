// DigestPort: sha256 over BYTES only. The core encodes UTF-8 itself (no TextEncoder) and the GAS adapter
// calls Utilities.computeDigest on a byte array (never the string overload).
export interface DigestPort {
  /** Lower-case hex sha256 of unsigned bytes (0..255). */
  sha256Bytes(bytes: readonly number[]): string;
}

/** Pure UTF-8 encoder; lone surrogates become U+FFFD like TextEncoder. */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha256Utf8(digest: DigestPort, text: string): string {
  return digest.sha256Bytes(utf8Bytes(text));
}

export interface GasUtilities {
  readonly DigestAlgorithm: { readonly SHA_256: unknown };
  computeDigest(algorithm: unknown, value: readonly number[]): readonly number[];
}

/** GAS adapter: bytes -> signed bytes -> computeDigest -> hex via & 0xff. */
export function createGasDigest(utilities: GasUtilities): DigestPort {
  return {
    sha256Bytes(bytes) {
      const signed = bytes.map((b) => (b << 24) >> 24);
      const raw = utilities.computeDigest(utilities.DigestAlgorithm.SHA_256, signed);
      return raw.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
    },
  };
}
