/**
 * U1 — shared SQLite SQL helpers for the local adapter set (no driver import:
 * only the structural database interface, so test doubles can wrap it).
 */
export interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/**
 * Normalize portable caller SQL for SQLite: `$N` placeholders become `?`
 * (params re-ordered by first appearance), pg casts `::type` and row-lock
 * clauses (`FOR UPDATE/SHARE … SKIP LOCKED/NOWAIT`) are stripped — the
 * serialized writer already provides the locking. Booleans bind as 0/1,
 * undefined as NULL.
 */
export function normalizeSql(text: string, params: readonly unknown[] = []): { sql: string; args: unknown[] } {
  const args: unknown[] = [];
  let sql = text.replace(/\$(\d+)/g, (_match, index) => {
    args.push(params[Number(index) - 1]);
    return '?';
  });
  sql = sql
    .replace(/::[A-Za-z_][A-Za-z0-9_]*(\[\])?/g, '')
    .replace(/\s+FOR\s+(?:UPDATE|SHARE|KEY\s+SHARE|NO KEY UPDATE)(?:\s+OF\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)?(?:\s+(?:SKIP\s+LOCKED|NOWAIT))?/gi, '');
  const bound = args.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
  return { sql, args: bound };
}

/** Execute one statement: rows for SELECT/RETURNING, rowCount = changes otherwise. */
export function runQuery<T>(db: SqliteDatabase, text: string, params: readonly unknown[] = []): { rows: T[]; rowCount: number } {
  const { sql, args } = normalizeSql(text, params);
  const statement = db.prepare(sql);
  if (/\bRETURNING\b/i.test(sql) || /^\s*SELECT\b/i.test(sql)) {
    const rows = statement.all(...args) as T[];
    return { rows, rowCount: rows.length };
  }
  const info = statement.run(...args);
  return { rows: [], rowCount: Number(info.changes) };
}
