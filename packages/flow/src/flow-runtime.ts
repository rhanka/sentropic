/**
 * @sentropic/flow — FlowRuntime port.
 *
 * High-level orchestrator composing the WorkflowStore, RunStore,
 * JobQueue, ApprovalGate, AgentTemplate, and Transitions ports.
 * Mirrors the workflow-start + lifecycle public surface of
 * `TodoOrchestrationService`.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2 + §3 (façade design).
 */

import type { ApprovalGate } from './approval-gate.js';
import type { AgentTemplate } from './agent-template.js';
import type { JobQueue } from './job-queue.js';
import type { RunStore } from './run-store.js';
import type { Transitions } from './transitions.js';
import type { WorkflowStore } from './workflow-store.js';

export interface StartWorkflowParams<TActor = unknown, TInput = unknown> {
  actor: TActor;
  workflowDefinitionId: string;
  input: TInput;
}

export interface StartInitiativeGenerationParams<TActor = unknown, TInput = unknown> {
  actor: TActor;
  input: TInput;
}

export interface FlowRuntimePorts<
  TActor = unknown,
  TState = unknown,
  TJobType = string,
  TJobData = unknown,
> {
  workflowStore: WorkflowStore<TActor>;
  runStore: RunStore<TState>;
  jobQueue: JobQueue<TJobType, TJobData>;
  approvalGate: ApprovalGate;
  agentTemplate: AgentTemplate<TActor>;
  transitions: Transitions<TState>;
}

export interface FlowRuntime<
  TActor = unknown,
  TInput = unknown,
  TRuntime = unknown,
  TSessionRuntime = unknown,
> {
  /** Generic workflow start (any registered workflow definition). */
  startWorkflow(params: StartWorkflowParams<TActor, TInput>): Promise<TRuntime>;

  /**
   * Specialized start for the use-case generation workflow.
   * Resolves the workspace's default workflow + agent map and creates
   * the run state without dispatching any job.
   */
  startInitiativeGenerationWorkflow(
    params: StartInitiativeGenerationParams<TActor, TInput>,
  ): Promise<TRuntime>;

  /**
   * Same as startInitiativeGenerationWorkflow + immediate dispatch of
   * the entry tasks through the JobQueue port.
   */
  startAndDispatch(
    params: StartInitiativeGenerationParams<TActor, TInput>,
  ): Promise<TRuntime>;

  /** Pause an in-flight run; idempotent for already-paused runs. */
  pauseRun(actor: TActor, runId: string): Promise<void>;

  /** Resume a paused or blocked run. */
  resumeRun(actor: TActor, runId: string): Promise<void>;

  /**
   * Read the runtime view of every workflow run linked to the chat
   * session (for the chat side panel + audit trail).
   */
  getSessionRuntime(actor: TActor, sessionId: string): Promise<TSessionRuntime>;
}
