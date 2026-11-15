import type { RawTransaction } from './types';

/** writable store ref id → value */
export type StateSnapshot = Map<string, unknown>;

/**
 * Ring buffer of transactions plus what's needed to rebuild the state of any
 * scope at any retained transaction: a base snapshot (state before the oldest
 * retained transaction of that scope) and per-transaction deltas.
 */
export class History {
  readonly transactions: RawTransaction[] = [];

  private readonly transactionsById = new Map<number, RawTransaction>();

  private readonly baseSnapshots = new Map<string, StateSnapshot>();

  /** retained transactions per scope, so an emptied scope is found without a scan */
  private readonly countByScope = new Map<string, number>();

  capacity: number;

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  get(id: number): RawTransaction | undefined {
    return this.transactionsById.get(id);
  }

  last(): RawTransaction | undefined {
    return this.transactions[this.transactions.length - 1];
  }

  baseOf(scopeId: string): StateSnapshot {
    let base = this.baseSnapshots.get(scopeId);
    if (!base) {
      base = new Map();
      this.baseSnapshots.set(scopeId, base);
    }
    return base;
  }

  /** Remember the value a ref had before its first recorded change. */
  rememberInitialValue(scopeId: string, stateRefId: string, value: unknown) {
    const base = this.baseOf(scopeId);
    if (!base.has(stateRefId)) base.set(stateRefId, value);
  }

  /** Add a transaction; returns the oldest one when it falls out of the buffer. */
  push(transaction: RawTransaction): RawTransaction | undefined {
    this.transactions.push(transaction);
    this.transactionsById.set(transaction.id, transaction);
    this.countByScope.set(
      transaction.scopeId,
      (this.countByScope.get(transaction.scopeId) ?? 0) + 1,
    );
    if (this.transactions.length <= this.capacity) return undefined;
    const evicted = this.transactions.shift()!;
    this.transactionsById.delete(evicted.id);
    const left = (this.countByScope.get(evicted.scopeId) ?? 1) - 1;
    if (left > 0) this.countByScope.set(evicted.scopeId, left);
    else this.countByScope.delete(evicted.scopeId);
    if (!evicted.flags.skipped) {
      const base = this.baseOf(evicted.scopeId);
      for (const [stateRefId, value] of evicted.deltas) base.set(stateRefId, value);
    }
    return evicted;
  }

  /** Whether any retained transaction belongs to the scope. */
  hasTransactionsOf(scopeId: string): boolean {
    return this.countByScope.has(scopeId);
  }

  /**
   * Forget a scope's base snapshot. With no retained transaction of that scope
   * the base answers nothing: `valuesAt` of a transaction that is gone cannot be
   * asked, and the present is read from the scope itself. Refuses while
   * transactions remain, since the base is what makes those reconstruct.
   *
   * A server forks a scope per request, so without this the agent keeps one
   * snapshot of writable store values per request it has ever seen.
   */
  forgetBaseOf(scopeId: string): boolean {
    if (this.countByScope.has(scopeId)) return false;
    return this.baseSnapshots.delete(scopeId);
  }

  /**
   * Values of writable refs of a scope right after transaction `transactionId`
   * (or now, when it is null). `readCurrent` reads a ref that never changed.
   */
  valuesAt(
    scopeId: string,
    transactionId: number | null,
    stateRefIds: string[],
    readCurrent: (stateRefId: string) => unknown,
  ): StateSnapshot {
    const values = new Map(this.baseOf(scopeId));
    for (const transaction of this.transactions) {
      if (transactionId !== null && transaction.id > transactionId) break;
      if (transaction.scopeId !== scopeId || transaction.flags.skipped) continue;
      for (const [stateRefId, value] of transaction.deltas) values.set(stateRefId, value);
    }
    for (const stateRefId of stateRefIds) {
      if (!values.has(stateRefId)) values.set(stateRefId, readCurrent(stateRefId));
    }
    return values;
  }

  /** Drop all transactions; the current state becomes the new base. */
  rebase(readCurrentValues: (scopeId: string) => StateSnapshot) {
    const scopeIds = new Set<string>([
      ...this.baseSnapshots.keys(),
      ...this.transactions.map((transaction) => transaction.scopeId),
    ]);
    this.transactions.length = 0;
    this.transactionsById.clear();
    this.countByScope.clear();
    this.baseSnapshots.clear();
    for (const scopeId of scopeIds) this.baseSnapshots.set(scopeId, readCurrentValues(scopeId));
  }

  setBase(scopeId: string, values: StateSnapshot) {
    this.baseSnapshots.set(scopeId, values);
  }

  inScope(scopeId: string): RawTransaction[] {
    return this.transactions.filter((transaction) => transaction.scopeId === scopeId);
  }
}
