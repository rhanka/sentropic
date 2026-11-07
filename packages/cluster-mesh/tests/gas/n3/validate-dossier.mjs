#!/usr/bin/env node
// airbus-dossier-publish/1.0.0 — envelope validator (DRAFT). Node >= 20, zero npm dependency, no Python.
// The dossier body is validated by the vendored h2a focus-kit validator (pinned by sha256 below);
// this file only checks the outer publish envelope and the Airbus offline constraints (C1, C3, C5).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT = 'airbus-dossier-publish/1.0.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATOR_PATH = join(HERE, 'vendor', 'focus-kit', 'validator.mjs');
const VALIDATOR_SHA256 = 'c5b3afcebd966458c3721842d4dbacbff4605206bb5296b593d0d160efad2ea4'; // h2a focus-kit 0.98.8, validatorVersion 0.5.0
const RENDERER_PATH = join(HERE, 'vendor', 'focus-kit', 'renderer.html');
const RENDERER_SHA256 = '6a6e62aa90c4df44625539a763cdf6839de6ae6094bd1bb0b0dfd32ede77d305'; // A1/A6, h2a 0.98.8 rendererVersion 0.98.7
const SCHEMA_IDS = new Set(['urn:sentropic:focus:DecisionDossierDocument:1.0.0', 'urn:sentropic:focus:DecisionDossierDocument:2.0.0']);
const MAX_PAYLOAD_BYTES = 400_000;
const URL_ALLOW = []; // C1: intranet prefixes allowed by the owner (R3), empty by default
const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bya29\.[\w-]{20,}/, /\bAIza[\w-]{30,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bBearer\s+[\w.-]{20,}/i, /\bgh[pousr]_[A-Za-z0-9]{30,}/];

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// RFC 8785 (JCS) for JSON values produced by JSON.parse: sorted keys, ECMAScript number/string serialization.
export function canonicalize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
}

function closed(obj, allowed, path, errors) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errors.push({ path, msg: 'must be an object' }); return false; }
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push({ path: `${path}.${k}`, msg: 'unknown key' });
  return true;
}
const req = (cond, path, msg, errors) => { if (!cond) errors.push({ path, msg }); };

function walkStrings(v, path, fn) {
  if (typeof v === 'string') return fn(v, path);
  if (Array.isArray(v)) return v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn));
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, `${path}.${k}`, fn);
}

export async function validateEnvelope(env) {
  const errors = [];
  if (!closed(env, ['contract', 'artifact', 'producer', 'residency', 'payload', 'integrity'], '$', errors)) return errors;
  req(env.contract === CONTRACT, '$.contract', `must be ${CONTRACT}`, errors);

  const a = env.artifact;
  if (closed(a, ['id', 'version', 'title', 'createdAt', 'chapter'], '$.artifact', errors)) {
    req(typeof a.id === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(a.id), '$.artifact.id', 'must match ^[a-z0-9][a-z0-9-]{2,63}$', errors);
    req(Number.isInteger(a.version) && a.version >= 1, '$.artifact.version', 'integer >= 1', errors);
    req(typeof a.title === 'string' && a.title.length >= 1 && a.title.length <= 200, '$.artifact.title', '1..200 chars', errors);
    req(typeof a.createdAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(a.createdAt) && !Number.isNaN(Date.parse(a.createdAt)), '$.artifact.createdAt', 'RFC 3339 UTC', errors);
    if (a.chapter !== undefined && closed(a.chapter, ['index', 'of'], '$.artifact.chapter', errors)) {
      const { index, of } = a.chapter;
      req(Number.isInteger(index) && Number.isInteger(of) && index >= 1 && index <= of, '$.artifact.chapter', '1 <= index <= of', errors);
    }
  }

  const p = env.producer;
  if (closed(p, ['tool', 'llmRoute', 'model'], '$.producer', errors)) {
    req(['claude-code', 'apps-script', 'other'].includes(p.tool), '$.producer.tool', 'claude-code | apps-script | other', errors);
    req(['vertex-direct', 'sent-tech-proxy', 'none'].includes(p.llmRoute), '$.producer.llmRoute', 'vertex-direct | sent-tech-proxy | none', errors);
    req(p.model === undefined || (typeof p.model === 'string' && p.model.length <= 100), '$.producer.model', 'string <= 100', errors);
  }

  const r = env.residency;
  if (closed(r, ['classification', 'egress'], '$.residency', errors)) {
    req(r.classification === 'airbus-internal', '$.residency.classification', 'must be airbus-internal', errors);
    req(r.egress === 'none', '$.residency.egress', 'must be none', errors);
  }

  const pl = env.payload;
  if (closed(pl, ['schemaId', 'render'], '$.payload', errors)) {
    req(SCHEMA_IDS.has(pl.schemaId), '$.payload.schemaId', `one of ${[...SCHEMA_IDS].join(', ')}`, errors);
    const rd = pl.render;
    if (closed(rd, ['contract', 'mode', 'root'], '$.payload.render', errors)) {
      req(rd.contract === '1.0', '$.payload.render.contract', 'must be "1.0"', errors);
      req(rd.mode === undefined || rd.mode === 'snapshot', '$.payload.render.mode', 'snapshot only (C4)', errors);
      if (closed(rd.root, ['id', 'component', 'document', 'accessibility'], '$.payload.render.root', errors)) {
        req(rd.root.component === 'DecisionDossier', '$.payload.render.root.component', 'must be DecisionDossier', errors);
        req(typeof rd.root.id === 'string', '$.payload.render.root.id', 'string', errors);
        const doc = rd.root.document;
        const v2 = doc && doc.schemaVersion !== undefined;
        req(v2 === (pl.schemaId?.endsWith(':2.0.0') ?? false), '$.payload.schemaId', 'must match document.schemaVersion presence (absent = v1)', errors);
        const rActual = sha256(readFileSync(RENDERER_PATH, 'utf8'));
        if (rActual !== RENDERER_SHA256) errors.push({ path: 'vendor', msg: `focus-kit renderer sha256 mismatch: ${rActual}` });
        for (const [i, sec] of (doc?.sections ?? []).entries()) if (sec?.kind === 'diagram' && typeof sec.source === 'string' && sec.source.startsWith('ecosystem:')) errors.push({ path: `$.payload.render.root.document.sections[${i}].source`, msg: 'focus-ecosystem-forbidden (profile airbus@1)' });
        const actual = sha256(readFileSync(VALIDATOR_PATH, 'utf8'));
        if (actual !== VALIDATOR_SHA256) errors.push({ path: 'vendor', msg: `focus-kit validator sha256 mismatch: ${actual}` });
        else {
          const { validateDecisionDossierDocument, validateDecisionDossierForPresentation } = await import(VALIDATOR_PATH);
          let res = validateDecisionDossierDocument(doc);
          if (res.ok) res = validateDecisionDossierForPresentation(doc);
          if (!res.ok) for (const i of res.issues ?? []) errors.push({ path: `$.payload.render.root.document${String(i.path ?? '').replace(/^\$/, '')}`, msg: i.message ?? JSON.stringify(i) });
        }
      }
    }
    const bytes = Buffer.byteLength(canonicalize(pl), 'utf8');
    req(bytes <= MAX_PAYLOAD_BYTES, '$.payload', `canonical size ${bytes} > ${MAX_PAYLOAD_BYTES} (C3)`, errors);
    walkStrings(pl, '$.payload', (s, path) => {
      for (const m of s.matchAll(/\bhttps?:\/\/[^\s)"'<>]+/g)) if (!URL_ALLOW.some((pre) => m[0].startsWith(pre))) errors.push({ path, msg: `external URL not allowed offline (C1): ${m[0]}` });
      for (const re of SECRET_PATTERNS) if (re.test(s)) errors.push({ path, msg: `credential-like string (C5): ${re}` });
    });
  }

  const ig = env.integrity;
  if (closed(ig, ['canonicalization', 'payloadSha256'], '$.integrity', errors)) {
    req(ig.canonicalization === 'jcs-rfc8785', '$.integrity.canonicalization', 'must be jcs-rfc8785', errors);
    if (pl && typeof pl === 'object') req(ig.payloadSha256 === sha256(canonicalize(pl)), '$.integrity.payloadSha256', 'does not match sha256(JCS(payload)); run --seal', errors);
  }
  return errors;
}

export function seal(env) {
  return { ...env, integrity: { canonicalization: 'jcs-rfc8785', payloadSha256: sha256(canonicalize(env.payload)) } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const doSeal = args[0] === '--seal';
  const file = doSeal ? args[1] : args[0];
  if (!file) { console.error('usage: node validate-dossier.mjs [--seal] <envelope.json>'); process.exit(2); }
  let env = JSON.parse(readFileSync(file, 'utf8'));
  if (doSeal) env = seal(env);
  const errors = await validateEnvelope(env);
  for (const e of errors) console.error(JSON.stringify(e));
  if (doSeal && errors.length === 0) process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
  if (!doSeal && errors.length === 0) console.error(JSON.stringify({ ok: true, contract: CONTRACT, payloadSha256: env.integrity.payloadSha256 }));
  process.exit(errors.length ? 1 : 0);
}
