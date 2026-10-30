import assert from 'node:assert/strict';

export const required = process.env.ACTIVATION_CONFORMANCE_REQUIRED === '1';
if (required || process.env.CLUSTER_MESH_PACKAGING_DIR) {
  assert.ok(process.env.CLUSTER_MESH_PACKAGING_DIR, 'CLUSTER_MESH_PACKAGING_DIR is required');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assert.equal(process.env.ACTIVATION_DISPOSABLE, '1', 'ACTIVATION_DISPOSABLE=1 is required');
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/test[_-][a-z0-9_-]+$/i, 'A test database name is required');
}
