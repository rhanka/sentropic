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

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network must not be used");
};

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
const published = await executor.invoke({
  tool: "artifacts_publish",
  actorId: "owner-1",
  args: {
    artifactId,
    files: [{ path: "index.html", mimeType: "text/html", bytes: [60, 104, 62] }],
    idempotencyKey: "p-1",
    paramsHash: "h-1",
  },
});
if (published.status !== 201) throw new Error("publish status " + published.status);
const got = await executor.invoke({ tool: "artifacts_get", actorId: "owner-1", args: { artifactId } });
if (got.status !== 200) throw new Error("get status " + got.status);
const listed = await executor.invoke({ tool: "artifacts_list", actorId: "owner-1", args: {} });
if (listed.body.total !== 1) throw new Error("list total mismatch");
if (fetchCalls !== 0) throw new Error("network was used");
console.log(
  "PACKED_CONSUMER_OK tools=15 manifestDigest=" +
    toolConfig.computeManifestDigest(definition.manifest) +
    " fetchCalls=" + fetchCalls,
);
