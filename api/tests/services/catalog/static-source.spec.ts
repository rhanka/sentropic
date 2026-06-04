/**
 * StaticCatalogSource — unit tests (BR-42b Lot 1)
 *
 * Verifies:
 *   - Snapshot wraps FOUNDATION_SKILLS as skill-kind entries.
 *   - Order is preserved (matches FOUNDATION_SKILLS array order).
 *   - Snapshot is synchronous and always-fresh (no caching layer).
 *   - Source id and kind are set correctly.
 *   - CatalogEntryMetadata carries the shared intersection fields.
 *   - Skill-specific fields (sandbox, toolNames) live in entry.skill.metadata,
 *     NOT in entry.metadata (CatalogEntryMetadata).
 */

import { describe, expect, it } from 'vitest';

import { FOUNDATION_SKILLS } from '../../../../packages/skills/src/index';
import {
  StaticCatalogSource,
  foundationCatalogSource,
} from '../../../src/services/catalog/sources/static-source';
import type { SkillEntry } from '../../../src/services/catalog/types';

// ---------------------------------------------------------------------------
// § 1  Source identity
// ---------------------------------------------------------------------------

describe('StaticCatalogSource — identity', () => {
  it('default source id is "foundation"', () => {
    const src = new StaticCatalogSource();
    expect(src.id).toBe('foundation');
  });

  it('accepts a custom id', () => {
    const src = new StaticCatalogSource('test-static');
    expect(src.id).toBe('test-static');
  });

  it('source kind is "static"', () => {
    const src = new StaticCatalogSource();
    expect(src.kind).toBe('static');
  });

  it('foundationCatalogSource singleton has id "foundation"', () => {
    expect(foundationCatalogSource.id).toBe('foundation');
    expect(foundationCatalogSource.kind).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// § 2  snapshot() — synchronous and always-fresh
// ---------------------------------------------------------------------------

describe('StaticCatalogSource.snapshot() — sync + always-fresh', () => {
  it('is synchronous — returns an array, not a Promise', () => {
    const src = new StaticCatalogSource();
    const result = src.snapshot();
    expect(result).toBeInstanceOf(Array);
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('returns the same reference on repeated calls (no recomputation)', () => {
    const src = new StaticCatalogSource();
    const a = src.snapshot();
    const b = src.snapshot();
    expect(a).toBe(b);
  });

  it('has no refresh() method (static sources are always-fresh)', () => {
    const src = new StaticCatalogSource();
    expect((src as { refresh?: unknown }).refresh).toBeUndefined();
  });

  it('has no health() method', () => {
    const src = new StaticCatalogSource();
    expect((src as { health?: unknown }).health).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// § 3  Entries — skill-kind, count, and order
// ---------------------------------------------------------------------------

describe('StaticCatalogSource — entries shape and order', () => {
  const src = new StaticCatalogSource();
  const entries = src.snapshot() as SkillEntry[];

  it('contains exactly 16 entries (one per foundation skill)', () => {
    expect(entries).toHaveLength(16);
  });

  it('all entries have kind="skill"', () => {
    for (const entry of entries) {
      expect(entry.kind).toBe('skill');
    }
  });

  it('all entries have sourceId matching the source id', () => {
    for (const entry of entries) {
      expect(entry.sourceId).toBe('foundation');
    }
  });

  it('entry order matches FOUNDATION_SKILLS array order', () => {
    const entryNames = entries.map((e) => e.metadata.name);
    const skillNames = FOUNDATION_SKILLS.map((s) => s.metadata.name);
    expect(entryNames).toEqual(skillNames);
  });

  it('the canonical 16 skill names are present in registration order', () => {
    const EXPECTED_NAMES = [
      'workspace',
      'web',
      'organizations',
      'folders',
      'initiatives',
      'solutions',
      'proposals',
      'products',
      'executive_summary',
      'matrix',
      'history_analyze',
      'gate_review',
      'documents',
      'comment_assistant',
      'plan',
      'document_generate',
    ];
    const entryNames = entries.map((e) => e.metadata.name);
    expect(entryNames).toEqual(EXPECTED_NAMES);
  });
});

// ---------------------------------------------------------------------------
// § 4  CatalogEntryMetadata — shared intersection fields
// ---------------------------------------------------------------------------

describe('StaticCatalogSource — CatalogEntryMetadata fields', () => {
  const src = new StaticCatalogSource();
  const entries = src.snapshot() as SkillEntry[];

  it('each entry.metadata carries name and description', () => {
    for (const entry of entries) {
      expect(typeof entry.metadata.name).toBe('string');
      expect(entry.metadata.name.length).toBeGreaterThan(0);
      expect(typeof entry.metadata.description).toBe('string');
      expect(entry.metadata.description.length).toBeGreaterThan(0);
    }
  });

  it('entry.metadata carries version from skill.metadata.version', () => {
    for (const entry of entries) {
      expect(entry.metadata.version).toBe(entry.skill.metadata.version);
    }
  });

  it('entry.metadata carries category from skill.metadata.category', () => {
    for (const entry of entries) {
      expect(entry.metadata.category).toBe(entry.skill.metadata.category);
    }
  });

  it('entry.metadata carries contextFilter from skill.metadata.contextFilter', () => {
    for (const entry of entries) {
      expect(entry.metadata.contextFilter).toBe(entry.skill.metadata.contextFilter);
    }
  });

  it('skill-specific fields (sandbox, toolNames) are on entry.skill.metadata, NOT on entry.metadata', () => {
    // This assertion enforces SPEC_EVOL_CATALOG §3.1:
    // shared metadata = intersection; skill-specific fields live in the payload.
    for (const entry of entries) {
      // entry.metadata (CatalogEntryMetadata) must NOT have sandbox or toolNames
      expect((entry.metadata as Record<string, unknown>).sandbox).toBeUndefined();
      expect((entry.metadata as Record<string, unknown>).toolNames).toBeUndefined();
      // Those fields ARE present on entry.skill.metadata (SkillMetadata)
      expect(entry.skill.metadata.toolNames).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// § 5  Skill payload round-trip
// ---------------------------------------------------------------------------

describe('StaticCatalogSource — skill payload', () => {
  const src = new StaticCatalogSource();
  const entries = src.snapshot() as SkillEntry[];

  it('each entry.skill is the same Skill object as in FOUNDATION_SKILLS', () => {
    for (let i = 0; i < FOUNDATION_SKILLS.length; i++) {
      expect(entries[i]!.skill).toBe(FOUNDATION_SKILLS[i]);
    }
  });

  it('each entry.skill.tools is non-empty', () => {
    for (const entry of entries) {
      expect(entry.skill.tools.length).toBeGreaterThan(0);
    }
  });
});
