import type { RawStep, RawTransaction } from '../history';
import type { Registry } from '../registry';

/** Operators that write into a store from outside: a derived store must not be their target. */
const EXTERNAL_WRITERS = new Set(['sample', 'event', 'effect', 'merge']);

function descendsFrom(steps: RawStep[], index: number, ancestorIndex: number): boolean {
  for (let parent = steps[index].parentIndex; parent !== null; parent = steps[parent].parentIndex) {
    if (parent === ancestorIndex) return true;
  }
  return false;
}

/**
 * A sample that read a store which changed LATER in the same transaction, not
 * as a consequence of the sample itself: it used the old value (a glitch).
 */
export function findStaleReads(
  transaction: RawTransaction,
  registry: Registry,
): { reader: string; store: string }[] {
  const firstChangeAt = new Map<string, number>();
  for (const step of transaction.steps) {
    if (step.status === 'changed' && step.stateRefId && !firstChangeAt.has(step.stateRefId)) {
      firstChangeAt.set(step.stateRefId, step.index);
    }
  }
  if (!firstChangeAt.size) return [];
  const staleReads: { reader: string; store: string }[] = [];
  const seen = new Set<string>();
  for (const step of transaction.steps) {
    if (step.op !== 'sample' || step.isInternal) continue;
    for (const operation of step.node.seq || []) {
      const { data } = operation;
      if (operation.type !== 'mov' || !data || data.from !== 'store' || !data.store) continue;
      const changedAt = firstChangeAt.get(data.store.id);
      if (changedAt === undefined || changedAt < step.index) continue;
      if (descendsFrom(transaction.steps, changedAt, step.index)) continue;
      const store = registry.unitsByStateRef.get(data.store.id);
      if (!store || store.info.internal) continue;
      const key = `${step.node.id}>${store.info.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      staleReads.push({ reader: step.node.id, store: store.info.id });
    }
  }
  return staleReads;
}

/**
 * A derived store (map/combine) written by sample or another unit instead of its
 * own computation. Only reachable on effector 22, which deprecated it; 23
 * asserts in `sample` and in `.on`, so the finalizer skips this check there.
 */
export function findDerivedWrites(transaction: RawTransaction, registry: Registry): string[] {
  const written = new Set<string>();
  for (const step of transaction.steps) {
    if (!step.isStore || step.parentIndex === null) continue;
    const record = registry.units.get(step.node.id);
    if (!record?.info.derived || record.info.internal) continue;
    if (EXTERNAL_WRITERS.has(transaction.steps[step.parentIndex].op)) written.add(record.info.id);
  }
  return [...written];
}
