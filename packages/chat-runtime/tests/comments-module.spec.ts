import { getCommentAuthorLabel, getMentionLabel } from '@sentropic/chat-ui/comments';
const presentation = { getCommentAuthorLabel, getMentionLabel };
/**
 * comments-module.spec.ts
 *
 * Export surface registration + CommentHost interface contract tests.
 * Verifies the ./comments subpath is registered, resolves to real files,
 * and that the CommentHost interface is implementable with zero app-side imports.
 *
 * Also tests createCommentState factory behavior via a FakeCommentHost harness.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// 1. Export surface registration
// ---------------------------------------------------------------------------

describe('comments runtime export registration', () => {
  it('exports its state module while keeping views in chat-ui', () => {
    const root = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.exports['./comments']).toBeTruthy();
