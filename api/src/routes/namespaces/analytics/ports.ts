export interface AnalyticsItem {
  readonly id: string;
  readonly name: string;
  readonly process?: string;
  readonly valueScore: number;
  readonly complexityScore: number;
  readonly valueScores: readonly unknown[];
  readonly complexityScores: readonly unknown[];
}

export interface AnalyticsQueryPort {
  folderExists(input: { readonly workspaceId: string; readonly folderId: string }): Promise<boolean>;
  listItems(input: {
    readonly workspaceId: string;
    readonly folderId: string;
  }): Promise<readonly AnalyticsItem[]>;
  markFolderGenerating(input: {
    readonly workspaceId: string;
    readonly folderId: string;
  }): Promise<void>;
}

export interface AnalyticsQueuePort {
  enqueueExecutiveSummary(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly folderId: string;
    readonly valueThreshold?: number | null;
    readonly complexityThreshold?: number | null;
    readonly model: string;
    readonly locale: string;
  }): Promise<string>;
}

export interface AnalyticsSettingsPort {
  getDefaultModel(): Promise<string>;
}

export interface AnalyticsLocalePort {
  resolve(input: {
    readonly appLocaleHeader?: string;
    readonly acceptLanguageHeader?: string;
  }): string;
}

export interface AnalyticsNamespacePorts {
  readonly query: AnalyticsQueryPort;
  readonly queue: AnalyticsQueuePort;
  readonly settings: AnalyticsSettingsPort;
  readonly locale: AnalyticsLocalePort;
}
