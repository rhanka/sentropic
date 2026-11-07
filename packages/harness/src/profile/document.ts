import { readFileSync } from 'node:fs';
import type { HarnessProfile } from './profile.js';

/** JSON representation; regular expressions use sources without delimiters or flags. */
export interface HarnessProfileDocument extends Omit<HarnessProfile, 'exceptionIdPattern'> {
  $schema?: string;
  exceptionIdPattern: string;
}

export type ProfileErrorCode = 'UNKNOWN_KEY' | 'INVALID_PROFILE' | 'INVALID_REGEX' |
  'PROFILE_READ' | 'PROFILE_JSON' | 'UNKNOWN_PROFILE';

export class ProfileValidationError extends Error {
  constructor(readonly code: ProfileErrorCode, readonly path: string, detail: string) {
    super(`${code} at ${path}: ${detail}`);
    this.name = 'ProfileValidationError';
  }
}

interface Schema {
  $ref?: string;
  $defs?: Record<string, Schema>;
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  minLength?: number;
  pattern?: string;
  format?: string;
}

// Validate against the shipped schema itself so the runtime and published contract stay aligned.
const schema = JSON.parse(readFileSync(new URL('../../schema/harness-profile.schema.json', import.meta.url), 'utf8')) as Schema;

function validate(value: unknown, rule: Schema, path: string): void {
  if (rule.$ref) return validate(value, schema.$defs![rule.$ref.split('/').at(-1)!], path);
  const invalid = (detail: string): never => { throw new ProfileValidationError('INVALID_PROFILE', path, detail); };
  if (rule.enum && !rule.enum.includes(value)) invalid(`expected one of ${rule.enum.join(', ')}`);
  if (rule.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('expected an object');
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (rule.additionalProperties === false && !Object.hasOwn(rule.properties!, key)) {
        throw new ProfileValidationError('UNKNOWN_KEY', `${path}.${key}`, 'unknown profile key');
      }
    }
    for (const key of rule.required ?? []) {
      if (!Object.hasOwn(object, key)) invalid(`missing required key: ${key}`);
    }
    for (const [key, entry] of Object.entries(object)) validate(entry, rule.properties![key], `${path}.${key}`);
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) invalid('expected an array');
    (value as unknown[]).forEach((entry, index) => validate(entry, rule.items!, `${path}[${index}]`));
  } else if (rule.type === 'string') {
    if (typeof value !== 'string') invalid('expected a string');
    const text = value as string;
    if (text.length < (rule.minLength ?? 0)) invalid('expected a nonempty string');
    if (rule.pattern && !new RegExp(rule.pattern).test(text)) invalid('invalid string format');
    if (rule.format === 'regex') {
      try { new RegExp(text); }
      catch { throw new ProfileValidationError('INVALID_REGEX', path, 'invalid ECMAScript regular expression'); }
    }
  } else if (rule.type === 'boolean' && typeof value !== 'boolean') invalid('expected a boolean');
}

/** Strict parser: rejects unknown keys at every level and never substitutes another profile. */
export function parseHarnessProfile(value: unknown): HarnessProfile {
  validate(value, schema, '$');
  const document = value as HarnessProfileDocument;
  const { $schema: _schema, ...policy } = document;
  return { ...policy, exceptionIdPattern: new RegExp(document.exceptionIdPattern) };
}

export function toProfileDocument(profile: HarnessProfile): HarnessProfileDocument {
  return { ...profile, exceptionIdPattern: profile.exceptionIdPattern.source };
}
