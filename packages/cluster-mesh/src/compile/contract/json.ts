import { CompileContractError, compileCanonicalJson } from './encoding.js';

/** Parse wire JSON without losing duplicate-key evidence to JSON.parse's last-key rule. */
export function parseCompileJson(text: string): unknown {
  const tokens = text.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]|\s+|./gu) ?? [];
  let index = 0;
  const next = (): string | undefined => {
    while (tokens[index] !== undefined && /^\s+$/u.test(tokens[index]!)) index++;
    return tokens[index];
  };
  const fail = (): never => { throw new CompileContractError('invalid_recipe'); };
  const take = (expected: string): void => { if (next() !== expected) fail(); index++; };
  function value(depth: number): unknown {
    if (depth > 64) return fail();
    const token = next();
    if (token === '{') {
      index++;
      const object: Record<string, unknown> = Object.create(null);
      if (next() !== '}') {
        do {
          const keyToken = next();
          if (!keyToken?.startsWith('"')) return fail();
          const key = JSON.parse(keyToken) as string;
          if (Object.hasOwn(object, key)) return fail();
          index++;
          take(':');
          object[key] = value(depth + 1);
          if (next() !== ',') break;
          index++;
        } while (true);
      }
      take('}');
      return object;
    }
    if (token === '[') {
      index++;
      const array: unknown[] = [];
      if (next() !== ']') {
        do {
          array.push(value(depth + 1));
          if (next() !== ',') break;
          index++;
        } while (true);
      }
      take(']');
      return array;
    }
    if (!token || !/^(?:"|-?\d|true$|false$|null$)/u.test(token)) return fail();
    index++;
    try { return JSON.parse(token) as unknown; } catch { return fail(); }
  }
  try {
    const result = value(0);
    if (next() !== undefined) return fail();
    compileCanonicalJson(result);
    return result;
  } catch { return fail(); }
}
