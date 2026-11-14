// Split pg_dump SQL without mistaking function bodies or comments for ACL statements.
export function aclStatements(sql) {
  let statement = '', quote = null, dollar = null, comment = false;
  const result = [];
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (comment) { if (ch === '\n') { comment = false; statement += '\n'; } continue; }
    if (!quote && !dollar && ch === '-' && next === '-') { comment = true; i++; continue; }
    if (dollar) {
      if (sql.startsWith(dollar, i)) { statement += dollar; i += dollar.length - 1; dollar = null; }
      else statement += ch;
      continue;
    }
    if (quote) {
      statement += ch;
      if (ch === quote) {
        if (next === quote) { statement += next; i++; } else quote = null;
      }
      continue;
    }
    const tag = ch === '$' ? sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/)?.[0] : null;
    if (tag) { dollar = tag; statement += tag; i += tag.length - 1; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    statement += ch;
    if (ch === ';') {
      const text = statement.trim();
      if (/^(?:ALTER\s+[\s\S]+?\s+OWNER TO\s|GRANT\s|REVOKE\s|ALTER DEFAULT PRIVILEGES\s)/i.test(text)) result.push(text);
      statement = '';
    }
    // pg_dump psql restriction directives are not SQL statements.
    if (ch === '\n' && /^\\(?:un)?restrict\s/.test(statement.trim())) statement = '';
  }
  if (quote || dollar) throw new Error('acl_dump_unterminated');
  return result.join('\n') + '\n';
}
