// Bounded JCS/strict JSON, aligned with h2a's frozen F2 JSON primitive.
export function remoteCanonicalJson(value: unknown): string {
  let nodes = 0;
  function encode(v: unknown, depth: number): string {
    if (++nodes > 10000 || depth > 32) throw new Error('invalid_request');
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isSafeInteger(v)) return JSON.stringify(v);
    if (typeof v === 'string' && Buffer.from(v).toString('utf8') === v) return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map((x) => encode(x, depth + 1)).join(',')}]`;
    if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      return `{${Object.keys(v).sort().map((k) =>
        `${encode(k, depth + 1)}:${encode((v as Record<string, unknown>)[k], depth + 1)}`).join(',')}}`;
    }
    throw new Error('invalid_request');
  }
  return encode(value, 0);
}

export function parseRemoteJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > 8192) throw new Error('oversize');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let at = 0, nodes = 0;
  const ws = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  const fail = (): never => { throw new Error('invalid_request'); };
  function string(): string {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '\\') at++;
      else if (c === '"') {
        const result: unknown = JSON.parse(text.slice(start, at));
        if (typeof result !== 'string' || Buffer.from(result).toString('utf8') !== result) return fail();
        return result;
      }
    }
    return fail();
  }
  function value(depth: number): unknown {
    if (++nodes > 10000 || depth > 32) return fail();
    ws();
    if (text[at] === '"') return string();
    const c = text[at];
    if (c === '{' || c === '[') {
      at++; ws();
      const object = Object.create(null) as Record<string, unknown>, array: unknown[] = [];
      const close = c === '{' ? '}' : ']';
      if (text[at] === close) { at++; return c === '{' ? object : array; }
      while (true) {
        ws();
        if (c === '{') {
          if (text[at] !== '"') return fail();
          const key = string(); ws();
          if (Object.hasOwn(object, key) || text[at++] !== ':') return fail();
          object[key] = value(depth + 1);
        } else array.push(value(depth + 1));
        ws();
        if (text[at] === close) { at++; break; }
        if (text[at++] !== ',') return fail();
      }
      return c === '{' ? object : array;
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) return fail();
    at += match[0].length;
    const result: unknown = JSON.parse(match[0]);
    if (typeof result === 'number' && !Number.isSafeInteger(result)) return fail();
    return result;
  }
  const result = value(0); ws();
  if (at !== text.length) return fail();
  return result;
}
