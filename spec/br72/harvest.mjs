#!/usr/bin/env node
/**
 * Deterministic BR-72 catalog harvester for the pinned OOMOL open-connector
 * source tree. It loads only static ProviderDefinition modules; no connector
 * executor is imported and no network call is made.
 *
 * Usage:
 *   node spec/br72/harvest.mjs /absolute/path/to/open-connector --write
 *   node spec/br72/harvest.mjs /absolute/path/to/open-connector --first-wave
 *
 * `--write` emits providers.tsv and digest.txt beside this file. `--first-wave`
 * writes the exhaustive GitHub, Google Drive, and Gmail Markdown rows to stdout.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_CORPUS = "/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-sentropic/ab75510a-9955-4a12-8206-797d1aa4e46e/scratchpad/open-connector";

// Printed verb-bucket map. Overrides deliberately handle add/remove/clear/generate
// by action semantics; they are never blanket aliases for a mutability value.
const VERB_BUCKETS = {
  read: ["analyze", "calculate", "check", "compare", "count", "decode", "describe", "detect", "download", "estimate", "evaluate", "export", "extract", "fetch", "find", "format", "geocode", "get", "identify", "inspect", "list", "lookup", "parse", "preview", "query", "read", "render", "resolve", "retrieve", "scan", "search", "status", "summarize", "transform", "translate", "validate", "verify", "view"],
  create: ["clone", "copy", "create", "duplicate", "fork", "import", "insert", "invite", "provision", "register", "upload"],
  update: ["add", "archive", "assign", "attach", "clear", "configure", "disable", "enable", "lock", "mark", "move", "patch", "rename", "remove", "replace", "restore", "revoke", "set", "transfer", "unarchive", "unlock", "update"],
  delete: ["delete", "destroy", "purge"],
  send: ["alert", "email", "message", "notify", "post", "publish", "reply", "send"],
  workflow: ["approve", "batch", "cancel", "connect", "deploy", "dispatch", "execute", "launch", "rerun", "run", "start", "stop", "submit", "sync", "trigger"],
  other: [],
};

const SEMANTIC_OVERRIDES = {
  add: {
    create: ["comment", "reaction", "note", "attachment", "file", "member"],
    update: ["assignee", "collaborator", "label", "reviewer", "tag", "topic", "watcher"],
  },
  remove: {
    update: ["assignee", "collaborator", "label", "reviewer", "tag", "topic", "watcher"],
  },
  clear: { update: ["label", "assignee", "reviewer", "topic", "watcher"] },
  generate: {
    read: ["release_notes", "report", "summary", "preview"],
    create: ["image", "video", "audio", "file", "asset", "document"],
  },
};

const NON_SEMANTIC_PREFIXES = new Set([
  "api", "app", "application", "auth", "connection", "database", "email", "file", "files",
  "folder", "folders", "google", "mail", "message", "messages", "notification", "notifications",
  "server", "settings", "user", "users", "v1", "v2", "v3", "workflow", "workflows",
]);

// Printed primary-class heuristic. Rules are evaluated in this order against the
// lower-cased service and display name; category fallbacks use the same order.
const CLASS_RULES = [
  {
    primaryClass: "Document/storage",
    keywords: ["box", "cloudinary", "document", "drive", "dropbox", "file", "git", "media", "notion", "sharepoint", "storage"],
    categories: ["Media", "Storage"],
  },
  {
    primaryClass: "Communications",
    keywords: ["call", "chat", "discord", "email", "gmail", "mail", "message", "slack", "sms", "telegram", "twilio", "whatsapp"],
    categories: ["Communication"],
  },
  {
    primaryClass: "Business systems",
    keywords: ["airtable", "clickup", "crm", "customer", "erp", "hubspot", "marketing", "odoo", "sales", "support"],
    categories: ["Marketing", "Productivity"],
  },
  {
    primaryClass: "Domain connectors",
    keywords: ["bank", "billing", "coin", "crypto", "finance", "geo", "hotel", "map", "payment", "realestate", "shipping", "stripe", "travel"],
    categories: ["Finance", "Location", "Social"],
  },
  {
    primaryClass: "Cloud/FinOps",
    keywords: ["analytics", "aws", "azure", "cloud", "datadog", "database", "gcp", "grafana", "kubernetes", "log", "monitor", "newrelic", "s3", "security"],
    categories: ["Data", "Infrastructure", "Security"],
  },
  {
    primaryClass: "LLM/dev accounts",
    keywords: ["ai", "anthropic", "developer", "github", "huggingface", "model", "openai", "registry", "sdk"],
    categories: ["AI", "Developer Tools"],
  },
];

const FIRST_WAVE = new Set(["github", "googledrive", "gmail"]);

function usage() {
  console.error("Usage: node spec/br72/harvest.mjs <open-connector-corpus> [--write] [--first-wave]");
  process.exit(2);
}

function loadTypeScript(corpus) {
  const candidates = [
    process.env.BR72_TYPESCRIPT,
    join(corpus, "node_modules/typescript/lib/typescript.js"),
  ].filter(Boolean);
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) throw new Error("TypeScript compiler not found; install the corpus dev dependencies or set BR72_TYPESCRIPT to typescript/lib/typescript.js.");
  return source;
}

async function runWorker(corpus) {
  const temp = mkdtempSync(join(tmpdir(), "br72-harvest-"));
  const loader = join(temp, "ts-loader.mjs");
  const typescript = loadTypeScript(corpus);
  process.env.BR72_TYPESCRIPT = typescript;
  writeFileSync(loader, `
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const imported = await import(pathToFileURL(${JSON.stringify(typescript)}).href);
const ts = imported.default ?? imported;
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const source = await readFile(new URL(url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
    }}).outputText;
    return { format: "module", source: output, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`);
  try {
    register(pathToFileURL(loader).href, import.meta.url);
    const providers = await loadProviders(corpus);
    return { providers, stats: aggregate(providers) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function loadProviders(corpus) {
  const providersRoot = join(corpus, "src/providers");
  const services = (await import("node:fs/promises")).readdir(providersRoot, { withFileTypes: true });
  const providers = [];
  for (const entry of (await services).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const definition = join(providersRoot, entry.name, "definition.ts");
    if (!existsSync(definition)) continue;
    const module = await import(pathToFileURL(definition).href);
    if (!module.provider) throw new Error(`Missing provider export: ${definition}`);
    providers.push(module.provider);
  }
  return providers;
}

function normalizeVerb(action, service) {
  const withoutService = action.name.startsWith(`${service}.`) ? action.name.slice(service.length + 1) : action.name;
  const finalSegment = withoutService.split(".").at(-1);
  const tokens = finalSegment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
  const semanticTokens = tokens.filter((token) => !NON_SEMANTIC_PREFIXES.has(token));
  return { verb: semanticTokens[0] ?? tokens[0] ?? "other", tokens: semanticTokens, finalSegment };
}

function bucketFor(action, service) {
  if (action.asyncLifecycle) return "Workflow/async";
  const { verb, tokens } = normalizeVerb(action, service);
  const rest = tokens.slice(1).join("_");
  const semantic = SEMANTIC_OVERRIDES[verb];
  if (semantic) {
    for (const [bucket, keywords] of Object.entries(semantic)) {
      if (keywords.some((keyword) => rest.includes(keyword))) return bucket[0].toUpperCase() + bucket.slice(1);
    }
  }
  for (const [bucket, verbs] of Object.entries(VERB_BUCKETS)) {
    if (verbs.includes(verb)) return bucket === "workflow" ? "Workflow/async" : bucket[0].toUpperCase() + bucket.slice(1);
  }
  return "Other";
}

function primaryClass(provider) {
  const searchable = `${provider.service} ${provider.displayName}`.toLowerCase();
  for (const rule of CLASS_RULES) if (rule.keywords.some((keyword) => searchable.includes(keyword))) return rule.primaryClass;
  const categories = new Set((provider.categories ?? []).map((category) => category.toLowerCase()));
  for (const rule of CLASS_RULES) if (rule.categories.some((category) => categories.has(category.toLowerCase()))) return rule.primaryClass;
  return "Business systems";
}

function scopeLabel(scope) {
  const trimmed = String(scope).replace(/\/$/, "");
  return trimmed.split("/").at(-1).replace(/^auth\//, "");
}

function field(value) {
  return String(value ?? "").replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

function aggregate(providers) {
  const classCounts = new Map(CLASS_RULES.map((rule) => [rule.primaryClass, 0]));
  classCounts.set("Unclassified", 0);
  const authCounts = new Map(["no_auth", "api_key", "custom_credential", "oauth2"].map((type) => [type, 0]));
  const verbCounts = new Map(["Read", "Create", "Update", "Delete", "Send", "Workflow/async", "Other"].map((bucket) => [bucket, 0]));
  const rawVerbCounts = new Map();
  let actionCount = 0;
  let asyncActions = 0;
  let followUpActions = 0;
  let followUpReferences = 0;
  let permissionActions = 0;
  let permissionScopeOverlap = 0;
  let multiAuthProviders = 0;
  const otherRawVerbCounts = new Map();
  const providerRecords = [];

  for (const provider of providers) {
    const bucket = primaryClass(provider);
    classCounts.set(bucket, classCounts.get(bucket) + 1);
    if (provider.authTypes.length > 1) multiAuthProviders += 1;
    for (const authType of provider.authTypes) authCounts.set(authType, authCounts.get(authType) + 1);
    const requiredScopes = new Set();
    let providerAsync = 0;
    let providerFollowUps = 0;
    for (const action of provider.actions) {
      actionCount += 1;
      for (const scope of action.requiredScopes) requiredScopes.add(scope);
      const bucketName = bucketFor(action, provider.service);
      verbCounts.set(bucketName, verbCounts.get(bucketName) + 1);
      const { verb } = normalizeVerb(action, provider.service);
      rawVerbCounts.set(verb, (rawVerbCounts.get(verb) ?? 0) + 1);
      if (bucketName === "Other") otherRawVerbCounts.set(verb, (otherRawVerbCounts.get(verb) ?? 0) + 1);
      if (action.asyncLifecycle) {
        asyncActions += 1;
        providerAsync += 1;
      }
      if (action.followUpActions?.length) {
        followUpActions += 1;
        providerFollowUps += 1;
        followUpReferences += action.followUpActions.length;
      }
      if (action.providerPermissions?.length) {
        permissionActions += 1;
        if (action.requiredScopes?.length) permissionScopeOverlap += 1;
      }
    }
    providerRecords.push({
      service: provider.service,
      primaryClass: bucket,
      authTypes: provider.authTypes.join("+"),
      actionCount: provider.actions.length,
      asyncActionCount: providerAsync,
      followUpActionCount: providerFollowUps,
      distinctRequiredScopes: requiredScopes.size,
      top3Verbs: [...provider.actions]
        .map((action) => normalizeVerb(action, provider.service).verb)
        .reduce((counts, verb) => counts.set(verb, (counts.get(verb) ?? 0) + 1), new Map())
        .entries()
        .toArray()
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([verb, count]) => `${verb}:${count}`)
        .join(","),
    });
  }
  return {
    classCounts,
    authCounts,
    verbCounts,
    rawVerbCounts,
    actionCount,
    asyncActions,
    followUpActions,
    followUpReferences,
    permissionActions,
    permissionScopeOverlap,
    multiAuthProviders,
    otherRawVerbCounts,
    providerRecords,
  };
}

function isReadOnly(action, provider) {
  return bucketFor(action, provider.service) === "Read";
}

function isResource(action, provider) {
  if (!isReadOnly(action, provider)) return false;
  const { verb, tokens } = normalizeVerb(action, provider.service);
  if (!["get", "fetch", "read", "retrieve"].includes(verb)) return false;
  if (tokens.some((token) => ["list", "search", "query", "export", "download"].includes(token))) return false;
  const finalToken = tokens.at(-1) ?? "";
  if (finalToken.endsWith("s") && !["contents", "status"].includes(finalToken)) return false;
  return true;
}

function targetMapping(action, provider) {
  const readOnly = isReadOnly(action, provider);
  const resource = isResource(action, provider);
  const name = action.name.toLowerCase();
  let mutability = "read-only";
  let category = resource ? "—" : "read";
  if (!readOnly) {
    const bucket = bucketFor(action, provider.service);
    if (bucket === "Create") mutability = "append";
    else if (bucket === "Update") mutability = "patch";
    else if (bucket === "Delete") mutability = "delete";
    else if (bucket === "Send") mutability = "append";
    else if (bucket === "Workflow/async") mutability = "state-transition";
    else mutability = "state-transition";
    category = mutability === "delete" || bucket === "Send" ? "transaction" : bucket === "Workflow/async" ? "workflow" : "write";
  }
  if (action.id === "gmail.move_to_trash") {
    mutability = "state-transition";
    category = "write";
  }
  if (action.id === "googledrive.permissions.create") {
    mutability = "state-transition";
    category = "transaction";
  }
  if (action.id === "gmail.send_email") {
    mutability = "append";
    category = "transaction";
  }
  if (action.id === "github.create_or_update_file") {
    mutability = "state-transition";
    category = "write";
  }
  const mutates = !readOnly;
  const irreversible = new Set([
    "gmail.send_email",
    "github.delete_repository",
    "googledrive.files.delete",
    "googledrive.permissions.create",
  ]).has(action.id) || mutability === "delete";
  const gates = readOnly
    ? "HC=false; PG=false; Policy=false"
    : `HC=${irreversible}; PG=true; Policy=true`;
  const projection = resource ? "resource read" : "tool invoke";
  const authorization = resource ? "read" : readOnly ? "discover+invoke" : "invoke";
  const deny = resource
    ? "Absent unless read-authorized."
    : readOnly
      ? "Tool absent unless invoke-authorized; returned refs absent unless discover-authorized."
      : "Tool absent unless invoke-authorized.";
  const redaction = provider.service === "github" && (name.includes("file") || name.includes("repository")) ? "secret" : "high";
  return {
    kind: resource ? "resource" : "tool",
    category,
    mutability,
    mutatesExternalSystem: String(mutates),
    idempotency: readOnly ? "false" : "true; principal",
    gates,
    redaction,
    secretScope: "principal",
    projection,
    authorization,
    deny,
    audit: "Yes — auditId + input/output refs; redact at class.",
    tos: "unverified",
    disposition: action.id === "github.create_or_update_file" ? "gap identified" : "taxonomy reference",
  };
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function firstWaveMarkdown(providers) {
  const chunks = [];
  for (const provider of providers.filter((item) => FIRST_WAVE.has(item.service)).sort((a, b) => ["github", "googledrive", "gmail"].indexOf(a.service) - ["github", "googledrive", "gmail"].indexOf(b.service))) {
    const heading = provider.service === "github" ? "GitHub" : provider.service === "googledrive" ? "Google Drive" : "Gmail";
    chunks.push(`### ${heading} (\`${provider.service}\`)`);
    chunks.push("");
    chunks.push("| OOMOL action id | OOMOL authTypes/scopes | Target capability kind | `CapabilityTool.category` | Mutability | `mutatesExternalSystem` | `idempotency.required` (+ scope) | Gates (HC / PG / Policy) | `RedactionClass` (max) | Secret scope | Execution-projection | Required authorization | Deny-as-missing note | Audit/trace feasibility | Provider API ToS | Disposition |");
    chunks.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const action of [...provider.actions].sort((a, b) => a.id.localeCompare(b.id))) {
      const mapping = targetMapping(action, provider);
      const auth = `${provider.authTypes.join("|")}; ${action.requiredScopes.length ? action.requiredScopes.map(scopeLabel).join(",") : "none"}`;
      chunks.push([
        `\`${action.id}\``,
        auth,
        mapping.kind,
        mapping.category,
        mapping.mutability,
        mapping.mutatesExternalSystem,
        mapping.idempotency,
        mapping.gates,
        mapping.redaction,
        mapping.secretScope,
        mapping.projection,
        mapping.authorization,
        mapping.deny,
        mapping.audit,
        mapping.tos,
        mapping.disposition,
      ].map(markdownCell).join(" | ").replace(/^/, "| ").concat(" |"));
    }
    chunks.push("");
  }
  return chunks.join("\n");
}

function providersTsv(records) {
  const header = "service\tprimaryClass\tauthTypes\tactionCount\tasyncActionCount\tfollowUpActionCount\tdistinctRequiredScopes\ttop3Verbs";
  return [header, ...records.sort((a, b) => a.service.localeCompare(b.service)).map((record) => [
    record.service,
    record.primaryClass,
    record.authTypes,
    record.actionCount,
    record.asyncActionCount,
    record.followUpActionCount,
    record.distinctRequiredScopes,
    record.top3Verbs,
  ].map(field).join("\t"))].join("\n") + "\n";
}

function digestText(corpus, stats, tsv) {
  const sha = createHash("sha256").update(tsv).digest("hex");
  const rawVerbs = stats.rawVerbCounts.entries().toArray().sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  const otherRawVerbs = stats.otherRawVerbCounts.entries().toArray().sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24);
  return [
    "BR-72 deterministic OOMOL harvest",
    `corpusCommit=${gitHead(corpus)}`,
    `providers.tsv.sha256=${sha}`,
    `providers=${stats.providerRecords.length}`,
    `actions=${stats.actionCount}`,
    `asyncActions=${stats.asyncActions}`,
    `followUpActions=${stats.followUpActions}`,
    `followUpReferences=${stats.followUpReferences}`,
    `providerPermissionActions=${stats.permissionActions}`,
    `providerPermissionRequiredScopeOverlap=${stats.permissionScopeOverlap}`,
    `multiAuthProviders=${stats.multiAuthProviders}`,
    `classCounts=${stats.classCounts.entries().toArray().map(([key, value]) => `${key}:${value}`).join(", ")}`,
    `authTypeCounts=${stats.authCounts.entries().toArray().map(([key, value]) => `${key}:${value}`).join(", ")}`,
    `verbBuckets=${stats.verbCounts.entries().toArray().map(([key, value]) => `${key}:${value}`).join(", ")}`,
    `topRawVerbs=${rawVerbs.map(([key, value]) => `${key}:${value}`).join(", ")}`,
    `topOtherRawVerbs=${otherRawVerbs.map(([key, value]) => `${key}:${value}`).join(", ")}`,
    "",
    "VERB_BUCKETS=",
    JSON.stringify(VERB_BUCKETS, null, 2),
    "SEMANTIC_OVERRIDES=",
    JSON.stringify(SEMANTIC_OVERRIDES, null, 2),
    "NON_SEMANTIC_PREFIXES=",
    JSON.stringify([...NON_SEMANTIC_PREFIXES].sort(), null, 2),
    "CLASS_RULES=",
    JSON.stringify(CLASS_RULES, null, 2),
    "",
  ].join("\n");
}

function gitHead(corpus) {
  let gitDir = join(corpus, ".git");
  if (!existsSync(gitDir)) throw new Error(`No .git directory: ${corpus}`);
  if (!existsSync(join(gitDir, "HEAD"))) {
    const marker = readFileSync(gitDir, "utf8");
    if (marker.startsWith("gitdir: ")) gitDir = resolve(corpus, marker.slice("gitdir: ".length).trim());
  }
  const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
  return head.startsWith("ref: ") ? readFileSync(join(gitDir, head.slice("ref: ".length)), "utf8").trim() : head;
}

function render(corpus, providers, stats, args) {
  const tsv = providersTsv(stats.providerRecords);
  if (args.includes("--write")) {
    writeFileSync(join(here, "providers.tsv"), tsv);
    writeFileSync(join(here, "digest.txt"), digestText(corpus, stats, tsv));
  }
  if (args.includes("--first-wave")) process.stdout.write(firstWaveMarkdown(providers));
  if (!args.includes("--write") && !args.includes("--first-wave")) process.stdout.write(digestText(corpus, stats, tsv));
}

const argumentsAfterNode = process.argv.slice(2);
const corpus = resolve(argumentsAfterNode.find((arg) => !arg.startsWith("--")) ?? DEFAULT_CORPUS);
if (!existsSync(join(corpus, "src/providers"))) usage();
const parsed = await runWorker(corpus);
render(corpus, parsed.providers, parsed.stats, argumentsAfterNode);
