import { and, eq, or } from 'drizzle-orm';
import type { GateEvaluationResult } from '@sentropic/flow';
import { db } from '../db/client';
import { guardrails, initiatives } from '../db/schema';
import { resolveGateConfig } from './flow/postgres-approval-gate';

// Re-exports from the @sentropic/flow façade (Lot 4 Slice 1 Step 1).
// Canonical implementations now live in `./flow/postgres-approval-gate.ts`.
export type {
  GateConfig,
  GateCriteria,
  GateEvaluationResult,
  GateMode,
} from '@sentropic/flow';
export {
  getDefaultGateConfig,
  resolveGateConfig,
} from './flow/postgres-approval-gate';

/**
 * Check if a value at a dot-notation path in the initiative data JSONB is non-empty.
 * Supports paths like "data.description", "data.domain", "data.solution".
 * The "data." prefix is stripped since we receive the data object directly.
 */
function checkRequiredField(data: Record<string, unknown>, fieldPath: string): boolean {
  // Strip "data." prefix if present (spec uses "data.description" notation)
  const path = fieldPath.startsWith('data.') ? fieldPath.slice(5) : fieldPath;
  const parts = path.split('.');

  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return false;
    current = (current as Record<string, unknown>)[part];
  }

  // Non-empty check: not null/undefined, not empty string, not empty array
  if (current == null) return false;
  if (typeof current === 'string' && current.trim() === '') return false;
  if (Array.isArray(current) && current.length === 0) return false;
  return true;
}

/**
 * Evaluate guardrail categories for an initiative.
 * Checks if there are active guardrails in the specified categories that are violated.
 */
async function evaluateGuardrailCategories(
  workspaceId: string,
  initiativeId: string,
  categories: string[],
): Promise<{ violated: string[]; passed: string[] }> {
  if (categories.length === 0) {
    return { violated: [], passed: [] };
  }

  // Query active guardrails for this initiative scoped to the workspace
  const guardrailRows = await db
    .select()
    .from(guardrails)
    .where(
      and(
        eq(guardrails.workspaceId, workspaceId),
        eq(guardrails.isActive, true),
        or(
          and(eq(guardrails.entityType, 'initiative'), eq(guardrails.entityId, initiativeId)),
        ),
      ),
    );

  const violated: string[] = [];
  const passed: string[] = [];

  for (const category of categories) {
    const categoryGuardrails = guardrailRows.filter((g) => g.category === category);
    if (categoryGuardrails.length === 0) {
      // No guardrails in this category means it passes
      passed.push(category);
      continue;
    }

    // Check if any guardrail in this category is violated
    const hasViolation = categoryGuardrails.some((g) => {
      const config = g.config && typeof g.config === 'object' ? (g.config as Record<string, unknown>) : {};
      return config.violated === true;
    });

    if (hasViolation) {
      violated.push(category);
    } else {
      passed.push(category);
    }
  }

  return { violated, passed };
}

/**
 * Evaluate gate criteria for a maturity stage transition.
 *
 * Per §6.2:
 * - free: allow transition, no checks
 * - soft: evaluate criteria, warn if not met, allow anyway
 * - hard: evaluate criteria, block if not met
 *
 * Returns { gate_passed, warnings, blockers }.
 */
export async function evaluateGate(
  workspaceId: string,
  initiativeId: string,
  targetStage: string,
): Promise<GateEvaluationResult> {
  const config = await resolveGateConfig(workspaceId);

  // No gate config = free mode (backward-compatible)
  if (!config) {
    return { gate_passed: true, warnings: [], blockers: [] };
  }

  // Free mode: always pass
  if (config.mode === 'free') {
    return { gate_passed: true, warnings: [], blockers: [] };
  }

  // Validate that the target stage is in the configured stages
  if (!config.stages.includes(targetStage)) {
    return {
      gate_passed: false,
      warnings: [],
      blockers: [`Stage '${targetStage}' is not a valid stage for this workspace. Valid stages: ${config.stages.join(', ')}`],
    };
  }

  // Get criteria for the target stage
  const criteria = config.criteria?.[targetStage];
  if (!criteria) {
    // No criteria defined for this stage = auto-pass
    return { gate_passed: true, warnings: [], blockers: [] };
  }

  const issues: string[] = [];

  // Evaluate required fields
  if (criteria.required_fields.length > 0) {
    const [initiative] = await db
      .select({ data: initiatives.data })
      .from(initiatives)
      .where(and(eq(initiatives.id, initiativeId), eq(initiatives.workspaceId, workspaceId)))
      .limit(1);

    if (!initiative) {
      return { gate_passed: false, warnings: [], blockers: ['Initiative not found'] };
    }

    const data = (initiative.data && typeof initiative.data === 'object')
      ? initiative.data as Record<string, unknown>
      : {};

    for (const field of criteria.required_fields) {
      if (!checkRequiredField(data, field)) {
        issues.push(`Required field '${field}' is missing or empty`);
      }
    }
  }

  // Evaluate guardrail categories
  if (criteria.guardrail_categories.length > 0) {
    const { violated } = await evaluateGuardrailCategories(
      workspaceId,
      initiativeId,
      criteria.guardrail_categories,
    );
    for (const cat of violated) {
      issues.push(`Guardrail category '${cat}' has violations`);
    }
  }

  // Determine result based on mode
  if (config.mode === 'soft') {
    return {
      gate_passed: true,
      warnings: issues,
      blockers: [],
    };
  }

  // Hard mode
  return {
    gate_passed: issues.length === 0,
    warnings: [],
    blockers: issues,
  };
}
