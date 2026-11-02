import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('should keep the root barrel free of node:sqlite and better-sqlite3', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    await import('@sentropic/artifacts');
    // node:sqlite shows up as 'NativeModule sqlite' / 'Internal Binding sqlite'.
    const loaded = process.moduleLoadList.filter((entry) =>
      /(^|\\s)sqlite$/.test(entry) || entry.includes('node:sqlite') ||
      entry.includes('better-sqlite3'));
    if (loaded.length > 0) {
      console.error('SQLITE_MODULES_IN_ROOT=' + loaded.join(','));
      process.exit(1);
    }
    console.log('ROOT_FREE_OF_SQLITE_OK');
  `], { encoding: 'utf8' });
  expect(result.trim()).toBe('ROOT_FREE_OF_SQLITE_OK');
});

it('should resolve the ./sqlite subpath and load node:sqlite only there', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const sqlite = await import('@sentropic/artifacts/sqlite');
    if (typeof sqlite.openSqliteArtifacts !== 'function' ||
      typeof sqlite.createSqliteArtifactStore !== 'function' ||
      typeof sqlite.createSqliteCommitExecutor !== 'function' ||
      typeof sqlite.createSqliteManagementUnit !== 'function' ||
      typeof sqlite.createSqliteActivationStore !== 'function' ||
      typeof sqlite.createLocalBlobStore !== 'function') {
      console.error('MISSING_SQLITE_EXPORTS');
      process.exit(1);
    }
    if (!process.moduleLoadList.some((entry) => /(^|\\s)sqlite$/.test(entry) || entry.includes('node:sqlite'))) {
      console.error('NODE_SQLITE_NOT_LOADED');
      process.exit(1);
    }
    if (process.moduleLoadList.some((entry) => entry.includes('better-sqlite3'))) {
      console.error('BETTER_SQLITE3_LOADED');
      process.exit(1);
    }
    console.log('SQLITE_SUBPATH_OK');
  `], { encoding: 'utf8' });
  expect(result.trim()).toBe('SQLITE_SUBPATH_OK');
});
