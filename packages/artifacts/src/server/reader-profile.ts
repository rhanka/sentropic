/**
 * L-5d — reader-profile contract (spec-v8 §9 5d).
 *
 * Pure evaluation of who may read what, where: exact method/route matches
 * (never prefixes), optional artifact/release bindings, owner bypass, then
 * listed subjects, then approved accounts only when the profile allows
 * them. Deny by default; approval comes from the host via an injected
 * predicate (memory double in tests).
 */
export interface ReaderRequest {
  subject: string;
  method: string;
  route: string;
  artifactId?: string;
  releaseId?: string;
}

export interface ReaderProfile {
  ownerId?: string;
  subjects: string[];
  allowApprovedAccounts: boolean;
  methods: string[];
  routes: string[];
  artifactId?: string;
  releaseId?: string;
}

/** Evaluate a reader request against a profile (deny by default). */
export function evaluateReaderProfile(
  profile: ReaderProfile,
  request: ReaderRequest,
  isApprovedAccount: (principalId: string) => boolean = () => false,
): boolean {
  if (request.subject.length === 0) return false;
  if (!profile.methods.includes(request.method)) return false;
  if (!profile.routes.includes(request.route)) return false;
  if (profile.artifactId !== undefined && request.artifactId !== profile.artifactId) return false;
  if (profile.releaseId !== undefined && request.releaseId !== profile.releaseId) return false;
  if (profile.ownerId !== undefined && request.subject === profile.ownerId) return true;
  if (profile.subjects.includes(request.subject)) return true;
  return profile.allowApprovedAccounts && isApprovedAccount(request.subject);
}
