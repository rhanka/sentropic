/** Server-owned authority; never construct this object from request or model JSON. */
export type CatalogRequestContext = Readonly<{
  subjectId: string; sessionId: string; tenantId: string; workspaceId: string;
  membershipRef: string; consentRef: string; policyVersion: string;
  readOnly: boolean; allowedTools: readonly string[];
  roles?: readonly string[]; workspaceType?: string;
}>;
export type CatalogInvocationContext = CatalogRequestContext;

export interface CatalogContextInput {
  readonly kind: 'http' | 'turn';
  readonly userId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly readOnly?: boolean;
  readonly allowedTools?: readonly string[];
}
export type CatalogAuthority = Omit<CatalogRequestContext, 'subjectId' | 'sessionId' | 'workspaceId'>;
export type CatalogAuthorityReader = (input: CatalogContextInput) => Promise<CatalogAuthority>;

const refreshers = new WeakMap<CatalogRequestContext, () => Promise<CatalogRequestContext>>();
const denied = () => new Error('catalog_access_denied');
export const isTrustedCatalogContext = (context: unknown): context is CatalogRequestContext =>
  typeof context === 'object' && context !== null && refreshers.has(context as CatalogRequestContext);

/** Captures immutable server inputs; current policy is read again at every dispatch. */
export function createCatalogContextResolver(readAuthority: CatalogAuthorityReader) {
  return async (supplied: CatalogContextInput): Promise<CatalogRequestContext> => {
    const input = Object.freeze({ ...supplied,
      ...(supplied.allowedTools === undefined ? {} : { allowedTools: Object.freeze([...supplied.allowedTools]) }),
    });
    const resolve = async (): Promise<CatalogRequestContext> => {
      try {
        if (!input.userId || !input.sessionId || !input.workspaceId ||
          (input.kind === 'turn' && !input.allowedTools)) throw denied();
        const authority = await readAuthority(input);
        if (![authority.tenantId, authority.membershipRef, authority.consentRef, authority.policyVersion]
          .every(value => typeof value === 'string' && value.length > 0)) throw denied();
        const allowedTools = Object.freeze([...new Set(authority.allowedTools)]
          .filter(name => input.allowedTools === undefined || input.allowedTools.includes(name)));
        const context = Object.freeze({ subjectId: input.userId, sessionId: input.sessionId,
          workspaceId: input.workspaceId, tenantId: authority.tenantId,
          membershipRef: authority.membershipRef, consentRef: authority.consentRef,
          policyVersion: authority.policyVersion, readOnly: input.readOnly === true || authority.readOnly,
          roles: Object.freeze([...(authority.roles ?? [])]), workspaceType: authority.workspaceType,
          allowedTools });
        refreshers.set(context, resolve);
        return context;
      } catch { throw denied(); }
    };
    return resolve();
  };
}

const RESERVED_CLAIMS = new Set(['subject', 'subjectId', 'userId', 'sessionId', 'tenantId',
  'workspaceId', 'clientId', 'credentialId', 'actorId', 'storageScopeId', 'identity', 'context',
  'invocation', 'authorization', 'allowedTools', 'readOnly', 'policyVersion', 'membershipRef', 'consentRef']);

export async function revalidateCatalogInvocation(
  context: CatalogRequestContext | undefined,
  tool: string,
  resourceSelectors: Record<string, unknown>,
  mutates = false,
): Promise<CatalogInvocationContext> {
  if (!isTrustedCatalogContext(context) || Object.keys(resourceSelectors).some(key => RESERVED_CLAIMS.has(key))) {
    throw denied();
  }
  const current = await refreshers.get(context)!();
  if (current.tenantId !== context.tenantId || current.membershipRef !== context.membershipRef ||
    current.consentRef !== context.consentRef || current.policyVersion !== context.policyVersion ||
    !context.allowedTools.includes(tool) || !current.allowedTools.includes(tool) ||
    (mutates && (context.readOnly || current.readOnly))) throw denied();
  return current;
}
