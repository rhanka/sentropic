const BUILD_FIELDS = [
  'schemaVersion',
  'repositoryId',
  'workflow',
  'workflowSha',
  'runId',
  'runAttempt',
  'job',
  'sourceSha',
  'recipeDigest',
  'ociDigest',
  'binaryDigest',
  'sbomDigest',
  'artifactId',
  'artifactDigest',
  'outcome',
];

function missingFields(object, fields) {
  return fields.filter((field) => object[field] === undefined).map((field) => `missing ${field}`);
}

export function validateBuildReceipt(build) {
  const errors = missingFields(build, BUILD_FIELDS);
  if (build.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (build.outcome !== 'success') errors.push('build outcome must be success');
  return errors;
}

export function validateValidationReceipt(validation, build) {
  const errors = missingFields(validation, [
    'schemaVersion',
    'buildDigest',
    'repositoryId',
    'runId',
    'runAttempt',
    'artifactId',
    'artifactDigest',
    'ociDigest',
    'outcome',
  ]);
  if (validation.repositoryId !== build.repositoryId) errors.push('repository mismatch refuses');
  if (validation.runId !== build.runId || validation.runAttempt !== build.runAttempt) {
    errors.push('cross-run artifact refuses');
  }
  if (validation.artifactId !== build.artifactId || validation.artifactDigest !== build.artifactDigest) {
    errors.push('artifact tuple must bind the identical measured bytes');
  }
  if (validation.ociDigest !== build.ociDigest) errors.push('OCI identity must bind the identical digest');
  if (validation.outcome !== 'eligible') errors.push('outcome must be eligible');
  return errors;
}

export function validatePublicationReceipt(publication, build, validation) {
  const errors = missingFields(publication, [
    'schemaVersion',
    'buildDigest',
    'validationDigest',
    'repositoryId',
    'runId',
    'runAttempt',
    'artifactId',
    'artifactDigest',
    'ociDigest',
    'package',
    'outcome',
  ]);
  if (publication.repositoryId !== build.repositoryId) errors.push('repository mismatch refuses');
  if (publication.runId !== build.runId || publication.runAttempt !== build.runAttempt) {
    errors.push('cross-run publication refuses');
  }
  if (publication.artifactDigest !== build.artifactDigest || publication.artifactDigest !== validation.artifactDigest) {
    errors.push('publication must carry the identical artifact tuple');
  }
  if (publication.ociDigest !== build.ociDigest) errors.push('publication must carry the identical OCI digest');
  if (publication.outcome !== 'published') errors.push('outcome must be published');
  return errors;
}

export function canExecute({ pinnedDigest, candidateDigest, offDrainReceipt }) {
  if (!pinnedDigest) return false;
  if (pinnedDigest !== candidateDigest) return false;
  if (!offDrainReceipt) return false;
  return true;
}
