/**
 * L-5e — second-host packed-consumer proof (spec-v8 §9 5e).
 *
 * Runs inside an isolated consumer directory where ONLY the packed
 * `@sentropic/artifacts` and `@sentropic/mcp-platform` tarballs are
 * installed (no workspace source; fetch is trapped before any import).
 * Proves the packed candidate exposes `sentropic.artifacts` with the 15
 * `artifacts_*` tools, compiles through the platform kernel, and drives
 * the full ensure → publish → get → list round-trip. Prints
 * `PACKED_CONSUMER_OK` on success; any failure throws.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network must not be used");
};

await import("@sentropic/artifacts");
const packageRoot = new URL("../", import.meta.resolve("@sentropic/artifacts"));
const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
for (const adapter of ["s3", "postgres"]) {
  const subpath = `./adapters/${adapter}`;
  assert.equal(import.meta.resolve(`@sentropic/artifacts/adapters/${adapter}`),
    new URL(`dist/adapters/${adapter}.js`, packageRoot).href);
  assert.deepEqual(manifest.exports[subpath], {
    types: `./dist/adapters/${adapter}.d.ts`, import: `./dist/adapters/${adapter}.js`,
  });
  for (const target of Object.values(manifest.exports[subpath])) {
    assert.ok(statSync(new URL(target, packageRoot)).isFile(), `missing ${target}`);
  }
}
for (const migration of ["0001_artifacts.sql", "0002_lifecycle.sql"]) {
  const sql = readFileSync(new URL(import.meta.resolve(`@sentropic/artifacts/migrations/${migration}`)), "utf8");
  assert.match(sql, /(?:CREATE|ALTER) TABLE (?:IF NOT EXISTS )?artifacts\./u, `missing SQL in ${migration}`);
}
for (const driver of ["@aws-sdk/client-s3", "pg"]) {
  await assert.rejects(import(driver), { code: "ERR_MODULE_NOT_FOUND" });
  assert.equal(manifest.peerDependenciesMeta[driver]?.optional, true);
}

const mcp = await import("@sentropic/artifacts/mcp");
assert.equal(Object.keys(mcp).some((name) => /WEB_PAGES|WebPages/u.test(name)), false);
const http = await import("@sentropic/artifacts/http");
const service = await import("@sentropic/artifacts/server/service");
const publication = await import("@sentropic/artifacts/server/publication");
const intents = await import("@sentropic/artifacts/server/object-intents");
const idem = await import("@sentropic/artifacts/server/idempotency");
const life = await import("@sentropic/artifacts/server/lifecycle");
const fork = await import("@sentropic/artifacts/server/fork");
const access = await import("@sentropic/artifacts/server/access");
const sources = await import("@sentropic/artifacts/server/sources");
const ports = await import("@sentropic/artifacts/server/ports");
const params = await import("@sentropic/artifacts/parameters");
const kernel = await import("@sentropic/mcp-platform/registry");
const toolConfig = await import("@sentropic/mcp-platform/tool-configuration");

if (mcp.ARTIFACTS_PROVIDER_ID !== "sentropic.artifacts") throw new Error("provider id mismatch");
const EXPECTED_TOOLS = [
  "artifacts_get_template", "artifacts_get_api_guide", "artifacts_ensure",
  "artifacts_publish", "artifacts_create_upload", "artifacts_commit_upload",
  "artifacts_list", "artifacts_get", "artifacts_get_source", "artifacts_fork",
  "artifacts_set_access", "artifacts_promote", "artifacts_renew",
  "artifacts_delete", "artifacts_restore",
];
if (JSON.stringify([...mcp.ARTIFACTS_TOOL_NAMES]) !== JSON.stringify(EXPECTED_TOOLS)) {
  throw new Error("tool name mismatch");
}

const kv = ports.createMemoryKv();
const state = publication.createMemoryStateStore();
const blobs = publication.createMemoryBlobStore();
const app = http.createHttpArtifactApp({
  parameterSchema: params.defineParameters([{ key: "title", type: "string", required: true }]),
  artifacts: service.createArtifactService({ kv, uuid: ports.createCryptoUuid() }),
  publication: publication.createPublicationService({
    state,
    blobs,
    intents: intents.createMemoryIntentStore(),
    idempotency: idem.createIdempotencyStore(idem.createMemoryIdempotencyKv()),
  }),
  lifecycle: life.createLifecycleService(
    life.createMemoryLifecycleStore(),
    () => "2026-01-01T00:00:00.000Z",
    state,
  ),
  forks: fork.createForkService(fork.createMemoryForkStore()),
  acls: access.createMemoryAclStore(),
  sources: sources.createMemorySourceStore(),
  blobs,
});

const definition = mcp.createArtifactsRegistryDefinition({ app, defaultStorageScopeId: "scope-1" });
const registry = kernel.createProviderRegistry();
registry.register(definition);
assert.throws(() => registry.select(["sentropic.web-pages"]), /unknown provider/u);
assert.throws(() => registry.configure("sentropic.web-pages", {}), /unknown provider/u);
registry.select(["sentropic.artifacts"]);
registry.configure("sentropic.artifacts", { defaultStorageScopeId: "scope-1" });
const compiled = registry.compile({
  bindings: {},
  compatibility: {
    "sentropic.artifacts": { manifestDigest: toolConfig.computeManifestDigest(definition.manifest) },
  },
});
if (!compiled.ok) throw new Error("kernel compile refused: " + JSON.stringify(compiled.diagnostics));
for (const name of EXPECTED_TOOLS) {
  if (compiled.registry.resolveTool(name)?.providerId !== "sentropic.artifacts") {
    throw new Error("unresolved tool " + name);
  }
}

const executor = mcp.createArtifactsToolExecutor({ app, defaultStorageScopeId: "scope-1" });
const ensured = await executor.invoke({
  tool: "artifacts_ensure",
  actorId: "owner-1",
  args: { bindingName: "site", idempotencyKey: "k-1", paramsHash: "h-1", parameters: { title: "Hi" } },
});
if (ensured.status !== 201) throw new Error("ensure status " + ensured.status);
const artifactId = ensured.body.artifactId;
const text = "<h1>Été à Montréal 🏠</h1>";
const expectedBytes = [...Buffer.from(text, "utf8")];
const file = { path: "index.html", mimeType: "text/html", text };
const fileSchema = definition.manifest.tools.find((tool) => tool.name === "artifacts_publish")
  .inputSchema.properties.files.items;
assert.equal(fileSchema.properties.text.type, "string");
assert.equal(fileSchema.oneOf.length, 2);
const published = await executor.invoke({
  tool: "artifacts_publish",
  actorId: "owner-1",
  args: {
    artifactId,
    files: [file, { path: "asset.png", mimeType: "image/png", bytes: [0, 128, 255] }],
    idempotencyKey: "p-1",
    paramsHash: "h-1",
  },
});
if (published.status !== 201) throw new Error("publish status " + published.status);
const request = (method, path, body) => app.handle({ method, path, body, actorId: "owner-1" });
const current = await request("GET", `/current/${artifactId}`);
assert.equal(current.status, 200);
const files = JSON.parse(current.body.manifest).files;
const html = files.find((entry) => entry.path === "index.html");
assert.equal(html.digest, "sha256:" + createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"));
assert.equal(html.size, expectedBytes.length);
const served = await request("GET", `/content/${artifactId}/${html.digest}`);
assert.equal(served.status, 200);
assert.deepEqual(served.body.bytes, expectedBytes);
assert.equal(Buffer.from(served.body.bytes).toString("utf8"), text);
for (const invalid of [
  { ...file, bytes: expectedBytes }, { ...file, mimeType: "image/png" },
  { ...file, text: null }, { path: file.path, mimeType: file.mimeType },
]) {
  const result = await executor.invoke({
    tool: "artifacts_publish", actorId: "owner-1", args: { artifactId, files: [invalid] },
  });
  assert.deepEqual(result, { status: 400, body: { error: "invalid_request" } });
}
const viaHttp = await request("POST", "/publish", { artifactId, files: [file] });
assert.equal(viaHttp.status, 201);
const headers = await import("@sentropic/artifacts/content/headers");
assert.equal(headers.contentHeaders({ mimeType: "text/html", size: html.size })
  ["cross-origin-resource-policy"], "same-origin");
const got = await executor.invoke({ tool: "artifacts_get", actorId: "owner-1", args: { artifactId } });
if (got.status !== 200) throw new Error("get status " + got.status);
const listed = await executor.invoke({ tool: "artifacts_list", actorId: "owner-1", args: {} });
if (listed.body.total !== 1) throw new Error("list total mismatch");
if (fetchCalls !== 0) throw new Error("network was used");
console.log(
  "PACKED_CONSUMER_OK tools=15 manifestDigest=" +
    toolConfig.computeManifestDigest(definition.manifest) +
    " version=" + manifest.version + " utf8Bytes=" + expectedBytes.length +
    " textValidation=ok corp=same-origin fetchCalls=" + fetchCalls,
);
