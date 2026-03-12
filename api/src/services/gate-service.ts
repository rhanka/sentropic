import { db } from '../db/client';
import { workspaces, initiatives, guardrails } from '../db/schema';
import { and, eq, or } from 'drizzle-orm';
import type { WorkspaceType } from './workspace-access';

// --- Types ---

export type GateMode = 'free' | 'soft' | 'hard';

export type GateCriteria = {
  required_fields: string[];
  guardrail_categories: string[];
};

export type GateConfig = {
  mode: GateMode;
  stages: string[];
  criteria?: Record<string, GateCriteria>;
};

export type GateEvaluationResult = {
  gate_passed: boolean;
  warnings: string[];
  blockers: string[];
};

// --- Default gate configs per workspace type (§6.3) ---

const DEFAULT_GATE_CONFIGS: Record<Exclude<WorkspaceType, 'neutral'>, GateConfig> = {
  'ai-ideas': {
    mode: 'free',
    stages: ['G0', 'G2'],
  },
  opportunity: {
    mode: 'soft',
    stages: ['G0', 'G2', 'G5', 'G7'],
    criteria: {
      G2: { required_fields: ['data.description', 'data.domain'], guardrail_categories: ['scope'] },
      G5: { required_fields: ['data.solution'], guardrail_categories: ['scope', 'quality'] },
      G7: { required_fields: [], guardrail_categories: ['approval'] },
    },
  },
  code: {
    mode: 'free',
    stages: ['G0', 'G2', 'G5'],
  },
};

/**
 * Returns the default gate config for a workspace type.
 * Returns null for neutral workspaces (no initiatives).
 */
export function getDefaultGateConfig(type: WorkspaceType): GateConfig | null {
  if (type === 'neutral') return null;
  return DEFAULT_GATE_CONFIGS[type] ?? null;
}

/**
 * Resolve the gate config for a workspace.
 * Uses the workspace's custom gate_config if set, otherwise falls back to the default for its type.
 */
export async function resolveGateConfig(workspaceId: string): Promise<GateConfig | null> {
  const [ws] = await db
    .select({ type: workspaces.type, gateConfig: workspaces.gateConfig })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!ws) return null;

  // Use workspace-level override if present
  if (ws.gateConfig && typeof ws.gateConfig === 'object') {
    return ws.gateConfig as unknown as GateConfig;
  }

  // Fall back to default per workspace type
  return getDefaultGateConfig(ws.type as WorkspaceType);
}

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
