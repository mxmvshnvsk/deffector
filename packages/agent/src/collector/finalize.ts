import type { Node } from '../effector';
import type { History, RawTransaction } from '../history';
import type { Registry } from '../registry';
import { GLOBAL_ID, type Scopes } from '../scopes';
import { findDoubleUpdates } from './doubleUpdates';
import { findDerivedWrites, findStaleReads } from './glitches';
import { settleStepStatuses } from './stepStatus';

const MAX_SKIPPED_CHILDREN = 20;

/** The user-facing unit a node belongs to: itself, or the unit an operator writes to / belongs to. */
function userUnitBehind(node: Node, registry: Registry): string | undefined {
  const record = registry.units.get(node.id);
  if (record)
    return record.info.internal && record.info.ownerId ? record.info.ownerId : record.info.id;
  for (const next of node.next || []) {
    const target = registry.units.get(next.id);
    if (target && !target.info.internal) return target.info.id;
  }
  for (const owner of node.family?.owners || []) {
    const ownerRecord = registry.units.get(owner.id);
    if (ownerRecord && !ownerRecord.info.internal && ownerRecord.info.kind !== 'domain') {
      return ownerRecord.info.id;
    }
  }
  return undefined;
}

/**
 * Everything known about a transaction only once it is over: step statuses,
 * deltas for snapshots, and the flags behind the Health tab.
 */
export class TransactionFinalizer {
  constructor(
    private readonly registry: Registry,
    private readonly scopes: Scopes,
    private readonly history: History,
  ) {}

  finalize(transaction: RawTransaction, ignorePatterns: RegExp[]) {
    transaction.isOpen = false;
    transaction.nestingCandidate = undefined;
    const changeCounts = settleStepStatuses(transaction, this.history);
    // found past the step limit, so they are newer than anything settled above
    if (transaction.lateDeltas) {
      for (const [stateRefId, value] of transaction.lateDeltas) {
        transaction.deltas.set(stateRefId, value);
      }
    }
    // a runaway cut by the emergency stop repeats everything: no double/stale analysis
    const isStopped = !!transaction.flags.stopped;
    if (!isStopped) {
      const doubleUpdates = findDoubleUpdates(
        transaction,
        changeCounts,
        this.registry,
        this.scopes,
      );
      if (doubleUpdates.length) transaction.flags.double = doubleUpdates;
    }
    const blocked = transaction.steps.filter(
      (step) => step.status === 'filtered' && !step.isInternal,
    );
    if (blocked.length) {
      transaction.flags.blocked = blocked.map((step) => ({
        node: step.node.id,
        reason: 'filter = false',
      }));
    }
    if (transaction.steps.some((step) => step.hasFailed)) {
      transaction.flags.error = true;
      const skippedChildren = this.skippedByErrors(transaction);
      if (skippedChildren.length) transaction.flags.skippedChildren = skippedChildren;
    }
    if (!isStopped) {
      const staleReads = findStaleReads(transaction, this.registry);
      if (staleReads.length) transaction.flags.staleReads = staleReads;
      const derivedWrites = findDerivedWrites(transaction, this.registry);
      if (derivedWrites.length) transaction.flags.derivedWrite = derivedWrites;
    }
    if (this.isIgnored(transaction, ignorePatterns)) transaction.flags.hidden = true;
    if (this.isOutOfScope(transaction)) transaction.flags.outOfScope = true;
  }

  /** What an exception prevented: the units the failed steps would have pushed. */
  private skippedByErrors(transaction: RawTransaction): string[] {
    const skipped = new Set<string>();
    for (const step of transaction.steps) {
      if (!step.hasFailed) continue;
      for (const next of step.node.next || []) {
        const unitId = userUnitBehind(next, this.registry);
        if (unitId) skipped.add(unitId);
      }
    }
    return [...skipped].slice(0, MAX_SKIPPED_CHILDREN);
  }

  /** Ignore rules match the label of transactions the app started itself. */
  private isIgnored(transaction: RawTransaction, ignorePatterns: RegExp[]): boolean {
    if (!ignorePatterns.length || transaction.cause) return false;
    const labelNode = transaction.settle ? transaction.settle.node : transaction.root;
    const label = this.registry.get(labelNode.id)?.info.name ?? '';
    return ignorePatterns.some((pattern) => pattern.test(label));
  }

  /** A call in the global graph while the app renders fork() scopes: nobody sees its result. */
  private isOutOfScope(transaction: RawTransaction): boolean {
    if (transaction.scopeId !== GLOBAL_ID || !this.scopes.isForkUsed) return false;
    if (this.registry.get(transaction.root.id)?.info.internal) return false;
    return transaction.cause?.kind !== 'devtools';
  }
}
