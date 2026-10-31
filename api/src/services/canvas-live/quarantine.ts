import { IngressRefusal, type RefusalClass } from './ingress';

export interface QuarantinedInput {
  id: string;
  actorId: string;
  sessionEpoch: string;
  fieldKey: string;
  documentId: string;
  encodedUpdate: string;
  deleteSet?: string;
}

export interface QuarantinePorts {
  revalidate(item: QuarantinedInput): Promise<'integrate' | 'refuse' | 'retain'>;
  onRefuse?(item: QuarantinedInput, refusal: RefusalClass): void;
}

export class UnresolvedQuarantine {
  private readonly items = new Map<string, QuarantinedInput>();
  private readonly refusals: { id: string; refusal: RefusalClass }[] = [];

  constructor(private readonly ports: QuarantinePorts) {}

  add(item: QuarantinedInput): void {
    if (!item.id || !item.actorId || !item.sessionEpoch || !item.encodedUpdate) {
      throw new IngressRefusal('unresolved-struct');
    }
    if (this.items.has(item.id)) throw new IngressRefusal('duplicate-paragraph');
    this.items.set(item.id, structuredClone(item));
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get size(): number {
    return this.items.size;
  }

  pendingFor(actorId: string): QuarantinedInput[] {
    return [...this.items.values()]
      .filter((item) => item.actorId === actorId)
      .map((item) => structuredClone(item));
  }

  async dependenciesArrived(): Promise<{ integrated: string[]; refused: string[]; retained: string[] }> {
    const integrated: string[] = [];
    const refused: string[] = [];
    const retained: string[] = [];
    for (const item of [...this.items.values()]) {
      const decision = await this.ports.revalidate(structuredClone(item));
      if (decision === 'integrate') {
        this.items.delete(item.id);
        integrated.push(item.id);
      } else if (decision === 'refuse') {
        this.items.delete(item.id);
        refused.push(item.id);
        this.refusals.push({ id: item.id, refusal: 'unresolved-struct' });
        this.ports.onRefuse?.(structuredClone(item), 'unresolved-struct');
      } else {
        retained.push(item.id);
      }
    }
    return { integrated, refused, retained };
  }

  refusalsByClass(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const refusal of this.refusals) {
      counts[refusal.refusal] = (counts[refusal.refusal] ?? 0) + 1;
    }
    return counts;
  }
}
