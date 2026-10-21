// L01a frozen expected vectors: canonical common-manifest bytes and their
// SHA-256 digests. Reviewed expected data; production encoding equivalence
// is checked from L02, never claimed here.

export interface CommonRuleVector {
  readonly id: string;
  readonly note: string;
  readonly canonicalBytes: string;
  readonly sha256: string;
}

const V1_BYTES =
  '{"commonContract":"1","manifestVersion":"1","module":"comments","scope":{"tenantId":"tenant-a","workspaceId":"workspace-a"},"surface":"transactional","incarnation":"store-1","publicationId":"pub-1","predecessorRoot":null,"sourceBoundary":{"kind":"journal-head","ref":"head-42"},"schemaVersion":"m1-v1","descriptorVersion":"d-v1","encodingVersion":"json-v1","units":[{"unitId":"unit-a","roots":["root-a1"]}],"objects":[{"id":"obj-a","locator":"common/obj-a","byteLength":23,"sha256":"cd3e031e10af0bcab5bb137164b9e05fab3d4c0f853a5e99fafe3418bebf26bf"}],"terminal":{"count":"1","complete":true}}';

const V2_BYTES =
  '{"commonContract":"1","manifestVersion":"1","module":"comments","scope":{"tenantId":"tenant-a","workspaceId":"workspace-a"},"surface":"analytical","incarnation":"store-1","publicationId":"pub-2","predecessorRoot":"root-prev-9","sourceBoundary":{"kind":"batch-snapshot","ref":"batch-2026-10-20"},"schemaVersion":"table-v7","descriptorVersion":"d-v1","encodingVersion":"json-v1","units":[{"unitId":"unit-a","roots":["root-a1"]},{"unitId":"unit-b","roots":["root-b1","root-b2"]}],"objects":[{"id":"obj-a","locator":"common/obj-a","byteLength":23,"sha256":"cd3e031e10af0bcab5bb137164b9e05fab3d4c0f853a5e99fafe3418bebf26bf"},{"id":"obj-b","locator":"common/obj-b","byteLength":23,"sha256":"874dbb46a072cc975842e410963775dd7dd8345daf7f60fa00aa3b6ac1b4fc2f"}],"terminal":{"count":"2","complete":true}}';

const V3_BYTES =
  '{"commonContract":"1","manifestVersion":"1","module":"comments","scope":{"tenantId":"tenant-a","workspaceId":"workspace-a"},"surface":"analytical","incarnation":"store-1","publicationId":"pub-2","predecessorRoot":"root-prev-9","sourceBoundary":{"kind":"batch-snapshot","ref":"batch-2026-10-20"},"schemaVersion":"table-v7","descriptorVersion":"d-v1","encodingVersion":"json-v1","units":[{"unitId":"unit-b","roots":["root-b1","root-b2"]},{"unitId":"unit-a","roots":["root-a1"]}],"objects":[{"id":"obj-a","locator":"common/obj-a","byteLength":23,"sha256":"cd3e031e10af0bcab5bb137164b9e05fab3d4c0f853a5e99fafe3418bebf26bf"},{"id":"obj-b","locator":"common/obj-b","byteLength":23,"sha256":"874dbb46a072cc975842e410963775dd7dd8345daf7f60fa00aa3b6ac1b4fc2f"}],"terminal":{"count":"2","complete":true}}';

export const COMMON_RULE_VECTORS: readonly CommonRuleVector[] = [
  {
    id: 'common-v1-transactional',
    note: 'minimal genesis manifest: journal-head boundary, one unit, one object',
    canonicalBytes: V1_BYTES,
    sha256: 'bd6779e484246d0bf7ff7529d31fd498220a3ad6b63ac3665d9921c1810eb4bf',
  },
  {
    id: 'common-v2-analytical',
    note: 'batch-snapshot manifest: two ordered units, two objects, predecessor root',
    canonicalBytes: V2_BYTES,
    sha256: '985807295b8e6c6cc394a2efd9b7b2a73b18b8833ba7050d641f25c41aa3f079',
  },
  {
    id: 'common-v3-units-swapped',
    note: 'same inventory as v2 with units swapped: digest must change (ordered units)',
    canonicalBytes: V3_BYTES,
    sha256: '8c49f83371ac82175e6a8e57fcccf2645df762d9483a8481ed48dc69edbed3ef',
  },
];

export const COMMON_RULE_VECTORS_BY_ID: Readonly<Record<string, CommonRuleVector>> = Object.fromEntries(
  COMMON_RULE_VECTORS.map((vector) => [vector.id, vector]),
);
