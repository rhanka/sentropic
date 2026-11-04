/**
 * Files parity LOT 2 §D.3 — upload/storage metering (signatures; body in Lot 4).
 *
 * Optional `metrics(event)` callback on upload/page/content deps; absent ⇒
 * no-op. No metrics library in the package, no `artifactId` or `ownerId` in
 * labels. Sweep summaries are emitted once per run.
 */
export interface ArtifactsMetricEvent {
  /** e.g. `upload_sessions_created`; see §D.3 for the closed event set. */
  readonly name: string;
  /** Low-cardinality labels only (channel, result, reason, origin). */
  readonly labels?: Readonly<Record<string, string>>;
  /** Numeric magnitude (e.g. committed bytes); never an identifier. */
  readonly value?: number;
}

export interface ArtifactsMetrics {
  emit(event: ArtifactsMetricEvent): void;
}

/** No-op sink used when the host wires no metrics port. */
export const NO_METRICS: ArtifactsMetrics = { emit: () => undefined };

export function emitMetric(metrics: ArtifactsMetrics | undefined, event: ArtifactsMetricEvent): void {
  if (metrics !== undefined) metrics.emit(event);
}
