// K4 shared scope visibility root (L3a v4.1 frozen §7.5). A persistent,
// indexed root/version per scope: every publication bumps the version at a
// single linearization point, seals capture the base, and a changed base
// conflicts without publication. Data-only: the runtime supplies heads and
// performs the swap. No pg, no drizzle, no engram imports.

export interface VisibilityChainBase {
  readonly head: string | null;
  readonly disposed: boolean;
}

export interface VisibilityBase {
  readonly version: string;
  readonly chains: ReadonlyMap<string, VisibilityChainBase>;
}

export const ROOT_VERSION_ZERO = '0';

const bumpVersion = (version: string): string => {
  const parsed = Number(version);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid root version: ${version}`);
  return String(parsed + 1);
};

/** Persistent scope visibility root: version plus base capture/compare. */
export class ScopeVisibilityRoot {
  private currentVersion = ROOT_VERSION_ZERO;

  get version(): string {
    return this.currentVersion;
  }

  /** Capture the publication base: current version plus touched chains. */
  capture(chains: ReadonlyMap<string, VisibilityChainBase>): VisibilityBase {
    return { version: this.currentVersion, chains: new Map(chains) };
  }

  /**
   * Compare a captured base with current state. True only when the version
   * is unchanged and every captured chain still binds the same head and
   * disposal flag. A changed base must conflict without publication.
   */
  matches(base: VisibilityBase, current: ReadonlyMap<string, VisibilityChainBase>): boolean {
    if (base.version !== this.currentVersion) return false;
    for (const [chainId, captured] of base.chains) {
      const live = current.get(chainId);
      if (!live) return false;
      if (live.head !== captured.head || live.disposed !== captured.disposed) return false;
    }
    return true;
  }

  /** Linearization point: bump the scope version, returning the new one. */
  publish(): string {
    this.currentVersion = bumpVersion(this.currentVersion);
    return this.currentVersion;
  }
}
