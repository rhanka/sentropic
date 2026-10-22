import { writable } from 'svelte/store';
import english from './i18n-en.json' with { type: 'json' };

const storageKey = 'governance-dossier-language';
let initial = 'fr';
try { if (typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === 'en') initial = 'en'; } catch { /* Storage is optional. */ }
export const language = writable(initial);
export function setLanguage(value) {
  if (!['fr', 'en'].includes(value)) return;
  language.set(value);
  try { localStorage.setItem(storageKey, value); } catch { /* Keep the viewer's in-memory choice. */ }
}
const brand = value => value.split(/(«[\s\S]*?»|`[^`]*`)/).map((part, i) => i % 2 ? part : part.replace(/(?<![@/\w.-])sentropic(?![\w/.-])/g, 'Sentropic')).join('');
export function t(value, lang = 'fr') {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (lang !== 'en') return brand(value);
  if (Object.hasOwn(english, value)) return brand(english[value]);
  return brand(Object.hasOwn(english, text) ? value.replace(text, english[text]) : value);
}
const verbatim = new Set(['rawText', 'ownerRemarks', 'ownerQuote']);
const identifiers = new Set(['id', 'key', 'schema', 'revision', 'architectureHash', 'sourceHash', 'ownerChoice', 'sourceHandle', 'targetHandle', 'parentId', 'tone', 'kind', 'cardIcon', 'status', 'path', 'file', 'hash']);
export function localize(value, lang = 'fr', key = '') {
  if (verbatim.has(key) || identifiers.has(key)) return value;
  if (typeof value === 'string') return t(value, lang);
  if (Array.isArray(value)) return value.map(item => localize(item, lang));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, localize(item, lang, k)]));
  return value;
}
