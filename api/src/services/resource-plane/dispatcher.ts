/**
 * ResourceDispatcher — the mount registry + verb router (SPEC_EVOL_RESOURCE_FS §3.2).
 *
 * It routes a ref to its provider, SERVER-VERIFIES the scope from the request principal
 * (the caller's `ref.scope` is never trusted), and answers root `ls` from the mount
 * cache without fanning out to providers (the FUSE lesson).
 */

import { ResourceError } from './contract.js';
import type {
  EditArgs,
  EditResult,
  GrepArgs,
  GrepResult,
  InvokeArgs,
  InvokeResult,
  ListArgs,
  ListResult,
  ReadArgs,
  ReadResult,
  ResourceNode,
  ResourcePrincipal,
  ResourceProvider,
  StatResult,
} from './contract.js';
import type { ResourceRef } from './ref.js';

export class ResourceDispatcher {
  private readonly byProvider = new Map<string, ResourceProvider>();
  private readonly byMount = new Map<string, ResourceProvider>();

  registerProvider(provider: ResourceProvider): this {
    this.byProvider.set(provider.provider, provider);
    for (const mount of provider.mounts) {
      this.byMount.set(mount, provider);
    }
    return this;
  }

  /** Mount segments in registration order — the root directory listing. */
  mountSegments(): string[] {
    return [...this.byMount.keys()];
  }

  /** Root `ls` — directory nodes from the mount cache; never fans out to providers. */
  listRoot(principal: ResourcePrincipal): ListResult {
    const entries: ResourceNode[] = this.mountSegments().map((seg) => ({
      ref: { provider: 'plane', scope: principal.scope, type: 'dir', id: `/${seg}` },
      path: `/${seg}`,
      name: seg,
      nodeType: 'dir',
      resourceType: 'dir',
    }));
    return { entries };
  }

  /** Resolve a path string to a canonical ref (paths are aliases), or null for root/unknown. */
  async resolvePath(path: string, principal: ResourcePrincipal): Promise<ResourceRef | null> {
    const segments = path.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) return null; // root — use listRoot
    const provider = this.byMount.get(segments[0]);
    if (!provider) return null;
    return provider.resolvePath(segments, principal);
  }

  private route(ref: ResourceRef): ResourceProvider {
    const provider = this.byProvider.get(ref.provider);
    if (!provider) {
      throw new ResourceError('provider_unavailable', `no provider for '${ref.provider}'`, ref);
    }
    return provider;
  }

  /** The principal's scope replaces any caller-supplied `ref.scope` (RF1 MINOR). */
  private scoped(ref: ResourceRef, principal: ResourcePrincipal): ResourceRef {
    return { ...ref, scope: principal.scope };
  }

  // The verb methods are `async` so a synchronous throw from route() (e.g. an
  // unknown provider) surfaces as a rejected promise, not a sync throw.
  async list(ref: ResourceRef, args: ListArgs, principal: ResourcePrincipal): Promise<ListResult> {
    return this.route(ref).list(this.scoped(ref, principal), args, principal);
  }

  async stat(ref: ResourceRef, principal: ResourcePrincipal): Promise<StatResult> {
    return this.route(ref).stat(this.scoped(ref, principal), principal);
  }

  async read(ref: ResourceRef, args: ReadArgs, principal: ResourcePrincipal): Promise<ReadResult> {
    return this.route(ref).read(this.scoped(ref, principal), args, principal);
  }

  async grep(ref: ResourceRef, args: GrepArgs, principal: ResourcePrincipal): Promise<GrepResult> {
    return this.route(ref).grep(this.scoped(ref, principal), args, principal);
  }

  async edit(ref: ResourceRef, args: EditArgs, principal: ResourcePrincipal): Promise<EditResult> {
    return this.route(ref).edit(this.scoped(ref, principal), args, principal);
  }

  async invoke(ref: ResourceRef, args: InvokeArgs, principal: ResourcePrincipal): Promise<InvokeResult> {
    return this.route(ref).invoke(this.scoped(ref, principal), args, principal);
  }
}
