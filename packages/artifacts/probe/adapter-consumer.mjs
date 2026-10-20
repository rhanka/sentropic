// Runs in the same packed consumer after the host installs its driver peers.
import assert from "node:assert/strict";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";
import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

const client = new S3Client({ region: "us-east-1" });
const pool = new pg.Pool();
assert.equal(typeof createS3BlobStore({ client, bucket: "probe" }).putBlob, "function");
assert.equal(typeof createPostgresArtifactStore(pool).ensureArtifact, "function");
client.destroy();
await pool.end();
console.log("PACKED_ADAPTERS_OK adapters=2 migrations=2");
