import type { Collector } from '../collector';
import { fork, launch, readScopeValue, type Node, type Scope } from '../effector';
import type { History, StateSnapshot } from '../history';
import type { EffectOverrides } from '../overrides';
import type { Registry } from '../registry';
import type { Scopes } from '../scopes';

/**
 * Store values of a scope: now, at a past transaction (history snapshots),
 * recomputed in a throwaway fork, or written back in place.
 */
export class StoreValues {
  constructor(
    private readonly registry: Registry,
    private readonly scopes: Scopes,
    private readonly history: History,
    private readonly collector: Collector,
    private readonly overrides: EffectOverrides,
  ) {}

  readCurrent(scopeId: string, stateRefId: string): unknown {
    const stateRef = this.registry.unitsByStateRef.get(stateRefId)?.stateRef;
    // a collected scope would otherwise read the global graph and pass it off as its own
    if (!stateRef || !this.scopes.isAvailable(scopeId)) return undefined;
    try {
      return readScopeValue(this.scopes.get(scopeId), stateRef);
    } catch {
      return undefined;
    }
  }

  /** Values of the writable stores of a scope right after a transaction (null = now). */
  valuesAt(scopeId: string, transactionId: number | null): StateSnapshot {
    const stateRefIds = this.registry.writableStores().map((store) => store.stateRef!.id);
    return this.history.valuesAt(scopeId, transactionId, stateRefIds, (stateRefId) =>
      this.readCurrent(scopeId, stateRefId),
    );
  }

  /** What the writable stores of a scope hold now: the base of a fresh history. */
  currentValues(scopeId: string): StateSnapshot {
    const values: StateSnapshot = new Map();
    for (const store of this.registry.writableStores()) {
      values.set(store.stateRef!.id, this.readCurrent(scopeId, store.stateRef!.id));
    }
    return values;
  }

  /** Values of all stores (derived included) of a scope, keyed by unit id. */
  allStoresNow(scopeId: string): Record<string, unknown> {
    if (!this.scopes.isAvailable(scopeId)) return {};
    return this.readAllStores(this.scopes.get(scopeId));
  }

  /** The same at a past transaction: derived stores are recomputed in a throwaway fork. */
  allStoresAt(scopeId: string, transactionId: number): Record<string, unknown> {
    const values = this.valuesAt(scopeId, transactionId);
    const past = fork();
    for (const store of this.registry.writableStores()) {
      const stateRefId = store.stateRef!.id;
      if (values.has(stateRefId)) past.values.idMap[stateRefId] = values.get(stateRefId);
    }
    return this.readAllStores(past);
  }

  private readAllStores(scope: Scope | null): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const record of this.registry.units.values()) {
      if (record.info.kind !== 'store' || !record.stateRef) continue;
      try {
        values[record.info.id] = readScopeValue(scope, record.stateRef);
      } catch {
        /* cleared */
      }
    }
    return values;
  }

  /**
   * A new scope holding the given values. Effect handlers come from another
   * scope, or are the defaults with the active overrides.
   */
  forkWith(values: StateSnapshot, handlersFrom: Scope | null): Scope {
    const scope = fork();
    for (const [stateRefId, value] of values) scope.values.idMap[stateRefId] = value;
    if (handlersFrom) scope.handlers = handlersFrom.handlers;
    else this.overrides.applyTo(scope);
    return scope;
  }

  /**
   * Write values into an existing scope with launch, without recording it:
   * time travel without an adapter, and the way back from it.
   */
  writeInPlace(scopeId: string, values: StateSnapshot) {
    // defence in depth: `scope: null` means the global graph to effector's launch
    if (!this.scopes.isAvailable(scopeId)) return;
    const scope = this.scopes.get(scopeId);
    const targets: Node[] = [];
    const params: unknown[] = [];
    for (const store of this.registry.writableStores()) {
      const stateRef = store.stateRef!;
      if (!values.has(stateRef.id)) continue;
      const value = values.get(stateRef.id);
      let current: unknown;
      try {
        current = readScopeValue(scope, stateRef);
      } catch {
        continue;
      }
      if (current === value) continue;
      targets.push(store.node);
      params.push(value);
    }
    if (!targets.length) return;
    this.collector.runUnrecorded(() => launch({ target: targets, params, scope }));
  }
}
