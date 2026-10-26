// Runs in the same packed consumer after the host installs its driver peers.
import assert from "node:assert/strict";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";
import { createPostgresActivationStore, ACTIVATION_SQL_ASSET, ACTIVATION_SQL_ASSET_SHA256 } from "@sentropic/artifacts/adapters/postgres-activation";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

const client = new S3Client({ region: "us-east-1" });
const pool = new pg.Pool();
assert.equal(typeof createS3BlobStore({ client, bucket: "probe" }).putBlob, "function");
assert.equal(typeof createPostgresArtifactStore(pool).ensureArtifact, "function");
const activation = createPostgresActivationStore({ pool, namespace: "packed-consumer" });
assert.equal(typeof activation.tickets.take, "function");
assert.equal(typeof activation.tickets.issue, "function");
assert.equal(typeof activation.flows.put, "function");
assert.equal(typeof activation.consume, "function");
assert.equal(ACTIVATION_SQL_ASSET, "@sentropic/artifacts/sql/0001_activation.sql");
const activationSql = readFileSync(new URL(import.meta.resolve(ACTIVATION_SQL_ASSET)), "utf8");
assert.equal(createHash('sha256').update(activationSql).digest('hex'), ACTIVATION_SQL_ASSET_SHA256);
assert.match(activationSql, /CREATE TABLE artifact_host.activation_tickets/);
assert.match(activationSql, /CREATE TABLE artifact_host.browser_flows/);
client.destroy();
await pool.end();
console.log("PACKED_ADAPTERS_OK adapters=3 migrations=2 activationSql=1");
