import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

const drizzleRoot = fileURLToPath(new URL('../../drizzle/', import.meta.url));

function readJournal(stream: string): Journal {
  const journalPath = `${drizzleRoot}${stream}/meta/_journal.json`;
  expect(existsSync(journalPath), `missing journal ${journalPath}`).toBe(true);
  return JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
}

function sqlFiles(stream: string): string[] {
  return readdirSync(`${drizzleRoot}${stream}`).filter((f) => f.endsWith('.sql'));
}

const numericPrefix = (tag: string): number => Number.parseInt(tag.split('_')[0] ?? '', 10);

function assertJournalIntegrity(stream: string): void {
  const journal = readJournal(stream);
  expect(journal.dialect).toBe('pg');

  const { entries } = journal;
  expect(entries.length, `${stream}: journal must not be empty`).toBeGreaterThan(0);

  entries.forEach((entry, i) => {
    expect(entry.idx, `${stream}: entry ${i} idx must match array position`).toBe(i);
  });

  const tags = entries.map((entry) => entry.tag);
  const duplicates = tags.filter((tag, i) => tags.indexOf(tag) !== i);
  expect(duplicates, `${stream}: duplicate journal tags`).toEqual([]);

  for (let i = 1; i < entries.length; i += 1) {
    expect(
      numericPrefix(entries[i].tag),
      `${stream}: tag order regression at idx ${i}: ${entries[i - 1].tag} then ${entries[i].tag}`,
    ).toBeGreaterThan(numericPrefix(entries[i - 1].tag));
    expect(
      entries[i].when,
      `${stream}: when regression at idx ${i}: ${entries[i - 1].tag} then ${entries[i].tag}`,
    ).toBeGreaterThan(entries[i - 1].when);
  }

  const prefixes = entries.map((entry) => numericPrefix(entry.tag));
  const duplicatePrefixes = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
  expect(duplicatePrefixes, `${stream}: duplicate numeric prefixes (drizzle-kit generate collision)`).toEqual([]);

  // drizzle-kit numbers the next generated migration from the journal entry
  // count; that slot must be free or the generated file collides with an
  // existing migration.
  const nextSlot = Number(entries.length);
  expect(
    prefixes.includes(nextSlot),
    `${stream}: next generate slot ${String(nextSlot).padStart(4, '0')} already used`,
  ).toBe(false);

  entries.forEach((entry) => {
    const migrationPath = `${drizzleRoot}${stream}/${entry.tag}.sql`;
    expect(existsSync(migrationPath), `${stream}: journal tag without file ${entry.tag}.sql`).toBe(true);
  });

  const journalTags = new Set(tags);
  sqlFiles(stream).forEach((file) => {
    const tag = file.replace(/\.sql$/, '');
    expect(journalTags.has(tag), `${stream}: migration file ${file} missing from journal`).toBe(true);
  });
}

describe('drizzle journal integrity', () => {
  it('public stream journal is linear, monotonic and consistent with its files', () => {
    assertJournalIntegrity('');
  });

  it('control stream journal is linear, monotonic and consistent with its files', () => {
    assertJournalIntegrity('control');
  });
});
