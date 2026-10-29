# Count selected COPY rows without emitting content, identities or storage keys.
BEGIN {
  FS = "\t"
  metric["documents_with_storage_key"] = 0
  metric["job_rows_with_contentBase64_key"] = 0
  metric["job_rows_with_both_object_reference_keys"] = 0
  metric["chat_rows_with_nonempty_attachments"] = 0
}
/^COPY / {
  split($0, words, /[[:space:]]+/)
  table = words[2]
  sub(/^.*\./, "", table)
  header = $0
  sub(/^[^(]*\(/, "", header)
  sub(/\) FROM stdin;$/, "", header)
  n = split(header, columns, /, /)
  delete position
  for (i = 1; i <= n; i++) position[columns[i]] = i
  rows[table] = 0
  copying = 1
  next
}
/^\\\.$/ { copying = 0; next }
copying {
  rows[table]++
  if (table == "__drizzle_migrations" || table == "__drizzle_control_migrations") {
    id = $(position["id"])
    hash = $(position["hash"])
    created = $(position["created_at"])
    if (id ~ /^[0-9]+$/ && hash ~ /^[0-9a-f]+$/ && created ~ /^[0-9]+$/)
      print "journal", table, id, hash, created
    next
  }
  if (table == "context_documents" && position["storage_key"]) {
    value = $(position["storage_key"])
    if (value != "\\N" && value != "") metric["documents_with_storage_key"]++
  }
  if (table == "job_queue" && position["result"]) {
    value = $(position["result"])
    if (value ~ /contentBase64/) metric["job_rows_with_contentBase64_key"]++
    if (value ~ /storageBucket/ && value ~ /storageKey/)
      metric["job_rows_with_both_object_reference_keys"]++
  }
  if (table == "chat_messages" && position["attachments"]) {
    value = $(position["attachments"])
    if (value != "\\N" && value != "" && value != "[]" && value != "null")
      metric["chat_rows_with_nonempty_attachments"]++
  }
}
END {
  for (table in rows) print "rows", table, rows[table]
  for (name in metric) print "key_presence_only", name, metric[name]
}
