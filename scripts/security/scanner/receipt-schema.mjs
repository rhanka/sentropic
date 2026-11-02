import { text, integer, hash, sha, timestamp, literal, list, empty, record, descriptor, equal } from './contract-schema.mjs';
import { upstreamSchema } from './material-contract.mjs';

export const PACKAGE = 'ghcr.io/rhanka/sentropic-trivy';
const workflow = record({ path: literal('.github/workflows/security-scanner-image.yml'), commit: sha });
const normalized = record({ filesystemDigest: hash, binaryDigest: hash, dependenciesDigest: hash });
const permissions = record({ packages: literal('write'), actions: literal('read'), 'id-token': literal('write') });
export const common = {
  schemaVersion: literal(1), repository: literal('rhanka/sentropic'), repositoryId: integer, lot: literal('ACT-L02'),
  acceptanceIds: list(text), head: sha, base: sha, tree: sha, sourceCommit: sha, workflow,
  controlDigest: hash, policyDigest: hash, schemaDigest: hash, materialDigest: hash, recipeDigest: hash,
  runId: integer, attempt: integer, actor: text, startedAt: timestamp, finishedAt: timestamp,
  outcome: literal('success'), failures: empty, skips: empty, commands: list(text),
  review: record({ identity: text, model: text, disposition: literal('approved'), digest: hash }),
  artifact: record({ id: integer, digest: hash, size: integer, retentionDays: integer, files: list(descriptor) }),
  chain: record({ index: descriptor, manifest: descriptor, config: descriptor, layers: list(descriptor),
    binary: descriptor, sbom: descriptor, platform: literal('linux/amd64') }),
};
export const receiptSchemas = {
  build: record({ ...common, type: literal('ScannerImageBuildReceiptV1'), job: literal('build-scanner-image'),
    upstream: upstreamSchema, patchDigests: list(hash), toolsDigest: hash,
    isolation: record({ platform: literal('linux/amd64'), network: literal('disabled'), credentials: literal(false),
      sharedDaemon: literal(false), canaryDigest: hash }),
    reproducibility: record({ first: normalized, second: normalized, allowedDifferences: empty }),
  }),
  validation: record({ ...common, type: literal('ScannerImageValidationReceiptV1'), job: literal('verify-scanner-image-publication'),
    buildReceiptDigest: hash, validatorToolsDigest: hash,
    checks: record({ content: literal(true), reproducibility: literal(true), selfSca: literal(true),
      positiveControls: literal(true), noExecution: literal(true), noSecrets: literal(true) }),
    independentReviews: list(hash), expiresAt: timestamp, publicationEligible: literal(true),
  }),
  publication: record({ ...common, type: literal('ScannerImagePublicationReceiptV1'), job: literal('publish-scanner-image'),
    buildReceiptDigest: hash, validationReceiptDigest: hash, package: literal(PACKAGE),
    environment: record({ name: literal('security-scanner-image-publish'), protectionDigest: hash }),
    permissions: record({ requested: permissions, granted: permissions }),
    reachablePackages: value => equal(value, [PACKAGE]), visibility: literal('public'), repositoryLink: literal('rhanka/sentropic'),
    registryReadbackDigest: hash, anonymousPullDigest: hash,
    signing: record({ issuer: literal('https://token.actions.githubusercontent.com'),
      identity: literal('https://github.com/rhanka/sentropic/.github/workflows/security-scanner-image.yml@refs/heads/main'),
      workflowCommit: sha, sourceCommit: sha, signedAt: timestamp,
      indexBundleDigest: hash, provenanceBundleDigest: hash, inclusionDigest: hash, checkpointDigest: hash, offlinePackDigest: hash }),
    tokenInvalidated: literal(true), resources: record({ bytes: integer, storageBytes: integer, headroomBytes: integer }),
  }),
};
