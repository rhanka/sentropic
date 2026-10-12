/**
 * RFC 8785 canonical JSON serialization (SPEC §4.4).
 *
 * Only values the closed hash envelopes can contain are accepted: strings
 * (valid Unicode, lone surrogates rejected), booleans, null, safe integers
 * (untyped floats are rejected), arrays in order, and plain objects with
 * string keys sorted by UTF-16 code units. Absence differs from null: absent
 * fields are omitted from the canonical bytes; null is serialized as `null`.
 */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reject lone (unpaired) surrogates: exact UTF-8 bytes cannot encode them. */
const isValidUnicode = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
};

const escapeString = (value: string): string => {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0d) out += '\\r';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += value[i];
  }
  return `${out}"`;
};

/** Serialize one accepted value; numbers must be safe integers, never floats. */
const serialize = (value: unknown): string => {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      if (!isValidUnicode(value)) {
        throw new CanonicalizationError('String contains a lone surrogate');
      }
      return escapeString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
        throw new CanonicalizationError('Only safe integers are hashable, floats are rejected');
      }
      return Object.is(value, -0) ? '0' : value.toString();
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((item) => serialize(item)).join(',')}]`;
      }
      if (isPlainObject(value)) {
        const keys = Object.keys(value).sort();
        return `{${keys
          .map((key) => `${escapeString(key)}:${serialize(value[key])}`)
          .join(',')}}`;
      }
      throw new CanonicalizationError(`Unsupported value type: ${Object.prototype.toString.call(value)}`);
    default:
      throw new CanonicalizationError(`Unsupported value: ${typeof value}`);
  }
};

/**
 * Canonical JSON bytes of one accepted value. `undefined` is never a hashable
 * value: absent fields must be omitted by the caller before hashing.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === undefined) {
    throw new CanonicalizationError('undefined is not hashable; omit the field instead');
  }
  return serialize(value);
};
