/**
 * L-5e — second-host packed-consumer proof (spec-v8 §9 5e).
 *
 * Runs inside an isolated consumer directory where ONLY the packed
 * `@sentropic/artifacts` and `@sentropic/mcp-platform` tarballs are
 * installed (no workspace source; fetch is trapped before any import).
 * Proves the packed candidate exposes the 15-name contract and selected
 * `sentropic.artifacts` tools, compiles through the platform kernel, and drives
 * the full ensure → publish → get → list round-trip. Prints
 * `PACKED_CONSUMER_OK` on success; any failure throws.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const coreOnly = process.argv.includes("--core-only");

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network must not be used");
};

await import(coreOnly ? "@sentropic/artifacts/mcp-core" : "@sentropic/artifacts");
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

if (!coreOnly) {
  const consumer = mkdtempSync(join(tmpdir(), "artifacts-core-"));
  try {
    execFileSync(process.execPath, ['/workspace/scripts/ci/locked-consumer.mjs', `/pack/sentropic-artifacts-${manifest.version}.tgz`,
      "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: consumer, stdio: "pipe" });
    writeFileSync(join(consumer, "probe.mjs"), readFileSync(new URL(import.meta.url)));
    writeFileSync(join(consumer, "host.mjs"), readFileSync(new URL("./host.mjs", import.meta.url)));
    execFileSync(process.execPath, ["probe.mjs", "--core-only"], { cwd: consumer, stdio: "inherit" });
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
} else {
  for (const entry of ["@sentropic/mcp-platform", "@sentropic/mcp-platform/tool-configuration",
    "@sentropic/artifacts/mcp"]) {
    await assert.rejects(import(entry), { code: "ERR_MODULE_NOT_FOUND" });
  }
  assert.equal(manifest.peerDependenciesMeta["@sentropic/mcp-platform"]?.optional, true);
}
const mcp = await import(coreOnly ? "@sentropic/artifacts/mcp-core" : "@sentropic/artifacts/mcp");
assert.equal(mcp.ARTIFACTS_PROVIDER_VERSION, manifest.version);
assert.equal(Object.keys(mcp).some((name) => /WEB_PAGES|WebPages/u.test(name)), false);
const { createProbeHost } = await import("./host.mjs");
const runtime = await import("@sentropic/artifacts/server/runtime");
const kernel = coreOnly ? undefined : await import("@sentropic/mcp-platform/registry");
const toolConfig = coreOnly ? undefined : await import("@sentropic/mcp-platform/tool-configuration");

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

const host = createProbeHost();
const { app, profile, invocation } = host;
const options = { app, profile, createInvocation: invocation };
const definition = coreOnly ? mcp.createArtifactsAdapter(options) : mcp.createArtifactsRegistryDefinition(options);
if (!coreOnly) {
  const registry = kernel.createProviderRegistry();
  registry.register(definition);
  assert.throws(() => registry.select(["sentropic.web-pages"]), /unknown provider/u);
  assert.throws(() => registry.configure("sentropic.web-pages", {}), /unknown provider/u);
  registry.select(["sentropic.artifacts"]);
  registry.configure("sentropic.artifacts", {});
  const compiled = registry.compile({
    bindings: {},
    compatibility: {
      "sentropic.artifacts": { manifestDigest: toolConfig.computeManifestDigest(definition.manifest) },
    },
  });
  if (!compiled.ok) throw new Error("kernel compile refused: " + JSON.stringify(compiled.diagnostics));
  for (const name of profile.selectedCapabilities) {
    if (compiled.registry.resolveTool(name)?.providerId !== "sentropic.artifacts") {
      throw new Error("unresolved tool " + name);
    }
  }
  for (const name of EXPECTED_TOOLS.filter((name) => !profile.selectedCapabilities.includes(name))) {
    assert.equal(compiled.registry.resolveTool(name), undefined);
  }
}

const executor = mcp.createArtifactsToolExecutor({ app, profile });
assert.equal((await executor.invoke({ tool: "artifacts_ensure", invocation: invocation(),
  args: { bindingName: "site", storageScopeId: "forged", idempotencyKey: "k-1" },
})).status, 400);
const ensured = await executor.invoke({
  tool: "artifacts_ensure",
  invocation: invocation(),
  args: { bindingName: "site", idempotencyKey: "k-1" },
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
  invocation: invocation(),
  args: {
    artifactId,
    files: [file, { path: "asset.css", mimeType: "text/css", bytes: [0, 128, 255] }],
    idempotencyKey: "p-1",
  },
});
if (published.status !== 201) throw new Error("publish status " + published.status);
const request = (method, path, body) => app.handle({ method, path, body, actorId: "owner-1" }, invocation());
const current = await host.getCurrent(artifactId);
const files = JSON.parse(current.manifest).files;
assert.equal(JSON.parse(current.manifest).storageScopeId, "scope-1");
const html = files.find((entry) => entry.path === "index.html");
assert.equal(html.digest, "sha256:" + createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"));
assert.equal(html.size, expectedBytes.length);
const content = runtime.createContentRuntime({ acls: host.acls, lifecycle: host.lifecycle,
  blobs: host.blobs, publication: { getCurrent: host.getCurrent } });
const served = await content.serveFile({ artifactId, digest: html.digest, actorId: "owner-1" });
assert.deepEqual([...served.bytes], expectedBytes);
assert.equal(Buffer.from(served.bytes).toString("utf8"), text);
let invalidAttempt = 0;
for (const invalid of [
  { ...file, bytes: expectedBytes }, { ...file, mimeType: "image/png" },
  { ...file, text: null }, { path: file.path, mimeType: file.mimeType },
]) {
  const result = await executor.invoke({
    tool: "artifacts_publish", invocation: invocation(),
    args: { artifactId, files: [invalid], idempotencyKey: `invalid-${invalidAttempt++}` },
  });
  assert.deepEqual(result, { status: 400, body: { error: "invalid_request" } });
}
const viaHttp = await request("POST", "/publish", { artifactId, files: [file], idempotencyKey: "http-publish" });
assert.equal(viaHttp.status, 201);
const headers = await import("@sentropic/artifacts/content/headers");
assert.equal(headers.contentHeaders({ mimeType: "text/html", size: html.size })
  ["cross-origin-resource-policy"], "same-origin");
const got = await executor.invoke({ tool: "artifacts_get", invocation: invocation(), args: { artifactId } });
if (got.status !== 200) throw new Error("get status " + got.status);
assert.equal(got.body.storageScopeId, "scope-1");
const listed = await executor.invoke({ tool: "artifacts_list", invocation: invocation(), args: {} });
if (listed.body.total !== 1) throw new Error("list total mismatch");
assert.ok(host.guardCalls() >= 3, "ensure and both publication transports must authorize commits");
if (fetchCalls !== 0) throw new Error("network was used");
console.log(
  (coreOnly ? "PACKED_MCP_CORE_OK platform=absent" : "PACKED_CONSUMER_OK") +
    " tools=" + profile.selectedCapabilities.length + " manifestDigest=" + (coreOnly ? "platform-free" : toolConfig.computeManifestDigest(definition.manifest)) +
    " version=" + manifest.version + " utf8Bytes=" + expectedBytes.length +
    " textValidation=ok corp=same-origin fetchCalls=" + fetchCalls,
);
