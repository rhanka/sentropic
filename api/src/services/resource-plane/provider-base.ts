/**
 * ResourceProviderBase — defaults every verb to a typed `unsupported` error so a
 * provider implements only what it supports and adding a verb later never breaks an
 * existing provider (the §3.3 "typed unsupported" contract slot).
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
  ResourcePrincipal,
  ResourceProvider,
  ResourceVerb,
  StatResult,
} from './contract.js';
import type { ResourceRef } from './ref.js';

export abstract class ResourceProviderBase implements ResourceProvider {
  abstract readonly provider: string;
  abstract readonly mounts: ReadonlyArray<string>;

  list(_ref: ResourceRef, _args: ListArgs, _principal: ResourcePrincipal): Promise<ListResult> {
    return this.unsupported('list');
  }

  stat(_ref: ResourceRef, _principal: ResourcePrincipal): Promise<StatResult> {
    return this.unsupported('stat');
  }

  read(_ref: ResourceRef, _args: ReadArgs, _principal: ResourcePrincipal): Promise<ReadResult> {
    return this.unsupported('read');
  }

  grep(_ref: ResourceRef, _args: GrepArgs, _principal: ResourcePrincipal): Promise<GrepResult> {
    return this.unsupported('grep');
  }

  edit(_ref: ResourceRef, _args: EditArgs, _principal: ResourcePrincipal): Promise<EditResult> {
    return this.unsupported('edit');
  }

  invoke(_ref: ResourceRef, _args: InvokeArgs, _principal: ResourcePrincipal): Promise<InvokeResult> {
    return this.unsupported('invoke');
  }

  resolvePath(_segments: ReadonlyArray<string>, _principal: ResourcePrincipal): Promise<ResourceRef | null> {
    return Promise.resolve(null);
  }

  protected unsupported<T>(verb: ResourceVerb): Promise<T> {
    return Promise.reject(
      new ResourceError('unsupported', `verb '${verb}' not supported by provider '${this.provider}'`)
    );
  }
}
