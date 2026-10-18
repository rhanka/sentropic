import { isValidInstant, isValidOpaqueRef } from './contracts.js';
import { CANDIDATE_PAYLOAD_SCHEMA, EVIDENCE_SCHEMA, TOOL_SCHEMAS } from './tool-schemas.js';
import { validateSchema } from './schema-validation.js';

/** M5 capture seals host-resolved scope, finite retention and exact cited evidence. */
export function validateCapture(payload: unknown, evidence: unknown): string[] {
  const callerSchema = TOOL_SCHEMAS.engram_memory_capture.inputSchema.properties.payload;
  const schema = {
    ...callerSchema,
    required: [...callerSchema.required, 'scope_ref', 'retention', 'reconciliation'],
    properties: { ...callerSchema.properties, scope_ref: CANDIDATE_PAYLOAD_SCHEMA.properties.scope_ref },
  };
  const failures = [...validateSchema(payload, schema, 'effective_input.payload'),
    ...validateSchema(evidence, EVIDENCE_SCHEMA, 'effective_input.evidence')];
  if (failures.length) return failures;
  const p = payload as any, e = evidence as any;
  if (!isValidOpaqueRef(p.scope_ref) || !isValidInstant(p.retention.expires_at)) failures.push('capture: host scope and resolved finite retention required');
  if (p.valid_time.t_end !== undefined && p.valid_time.t_end < p.valid_time.t) failures.push('capture: reversed valid interval');
  const citations = new Set(p.citations.map((c: any) => c.citation_id));
  const components = new Set(p.components.map((c: any) => c.component_id));
  if (citations.size !== p.citations.length || components.size !== p.components.length) failures.push('capture: duplicate citation or component');
  if (!components.has(p.primary_component_id) || !citations.has(p.primary_event.citation_id)) failures.push('capture: missing primary anchor');
  for (const component of p.components) {
    if (component.citation_ids.some((id: string) => !citations.has(id))) failures.push('capture: uncited component');
  }
  if (e.citation_ids.some((id: string) => !citations.has(id))) failures.push('capture: evidence citation absent');
  return failures;
}
