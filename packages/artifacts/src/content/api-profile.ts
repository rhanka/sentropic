/**
 * L-5d — reader-delegation API profile (spec-v8 §9 5d).
 *
 * Generic contract for page-initiated business calls: the host profile
 * fixes exact methods/routes and artifact/release bindings (evaluated by
 * the pure reader-profile contract); writes additionally require Origin
 * equality with the content origin and a custom header (simple-request
 * CSRF defense). A content grant alone never becomes business-write
 * authority — the receiving API re-verifies reader rights per operation.
 * Successful calls carry reader attribution for audit.
 */
import {
  evaluateReaderProfile,
  type ReaderProfile,
} from '../server/reader-profile.js';

export interface ReaderApiCall {
  subjectId: string;
  method: string;
  route: string;
  artifactId?: string;
  releaseId?: string;
  /** Browser Origin header of the calling page (writes only). */
  origin?: string;
  /** The content origin the call must come from (writes only). */
  expectedOrigin?: string;
  /** True when the call carries a non-simple custom request header. */
  hasCustomHeader?: boolean;
}

export type ReaderApiDecision =
  | {
      allowed: true;
      attribution: { subjectId: string; artifactId?: string; releaseId?: string };
    }
  | { allowed: false; reason: 'profile' | 'origin' | 'csrf' };

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** Authorize one reader API call against the host profile (deny default). */
export function authorizeReaderApiCall(
  profile: ReaderProfile,
  call: ReaderApiCall,
  isApprovedAccount: (principalId: string) => boolean = () => false,
): ReaderApiDecision {
  const inProfile = evaluateReaderProfile(
    profile,
    {
      subject: call.subjectId,
      method: call.method,
      route: call.route,
      artifactId: call.artifactId,
      releaseId: call.releaseId,
    },
    isApprovedAccount,
  );
  if (!inProfile) return { allowed: false, reason: 'profile' };
  if (!SAFE_METHODS.has(call.method)) {
    if (call.expectedOrigin === undefined || call.origin !== call.expectedOrigin) {
      return { allowed: false, reason: 'origin' };
    }
    if (call.hasCustomHeader !== true) return { allowed: false, reason: 'csrf' };
  }
  return {
    allowed: true,
    attribution: {
      subjectId: call.subjectId,
      ...(call.artifactId === undefined ? {} : { artifactId: call.artifactId }),
      ...(call.releaseId === undefined ? {} : { releaseId: call.releaseId }),
    },
  };
}
