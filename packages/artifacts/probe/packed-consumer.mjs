/**
 * L-5e — second-host packed-consumer proof (spec-v8 §9 5e).
 *
 * Runs inside an isolated consumer directory where ONLY the packed
 * `@sentropic/artifacts` tarball is installed (no workspace source, no
 * network: fetch is stubbed to throw). Proves the packed candidate drives
 * the full pages dispatch round-trip: ensure → publish → read → serve.
 * Prints `PACKED_CONSUMER_OK` on success; any failure throws.
 */
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network must not be used");
};

const pages = await import("@sentropic/artifacts/server/pages");
const provider = await import("@sentropic/artifacts/provider");
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

const def = pages.definePagesProvider();
if (def.providerId !== "pages") throw new Error("provider id mismatch");
const map = provider.publicNameMap(def);
for (const name of ["pages_ensure_site", "pages_publish_site", "pages_read_page", "pages_serve_content"]) {
  if (!map.has(name)) throw new Error("missing public name " + name);
}
provider.assertNoPublicNameCollisions([def, pages.definePagesProvider()]);

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
const dispatch = pages.createPagesDispatch({ app, defaultStorageScopeId: "scope-1" });

const ensured = await dispatch.invoke({
  capability: "ensure-site",
  actorId: "owner-1",
  args: { bindingName: "site", idempotencyKey: "k-1", paramsHash: "h-1", parameters: { title: "Hi" } },
});
if (ensured.status !== 201) throw new Error("ensure status " + ensured.status);
const artifactId = ensured.body.artifactId;
const published = await dispatch.invoke({
  capability: "publish-site",
  actorId: "owner-1",
  args: {
    artifactId,
    profile: {},
    files: [{ path: "index.html", mimeType: "text/html", bytes: [1, 2, 3] }],
    idempotencyKey: "p-1",
    paramsHash: "h-1",
  },
});
if (published.status !== 201) throw new Error("publish status " + published.status);
const read = await dispatch.invoke({ capability: "read-page", actorId: "owner-1", args: { artifactId } });
if (read.status !== 200) throw new Error("read status " + read.status);
const manifest = JSON.parse(read.body.manifest);
const digest = manifest.files[0].digest;
const served = await dispatch.invoke({
  capability: "serve-content",
  actorId: "owner-1",
  args: { artifactId, digest },
});
if (served.status !== 200) throw new Error("serve status " + served.status);
if (JSON.stringify(served.body.bytes) !== "[1,2,3]") throw new Error("bytes mismatch");
if (fetchCalls !== 0) throw new Error("network was used");
console.log("PACKED_CONSUMER_OK digest=" + digest + " fetchCalls=" + fetchCalls);
