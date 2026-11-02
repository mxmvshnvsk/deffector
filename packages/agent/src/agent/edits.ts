import type { TimelineState, TxCause } from '@deffector/protocol';
import type { Collector } from '../collector';
import type { Node, Scope } from '../effector';
import type { History } from '../history';
import type { Texts } from '../i18n';
import type { Registry } from '../registry';
import { GLOBAL_ID, type Scopes } from '../scopes';
import { launchFromDevtools } from './devtoolsLaunch';
import type { PanelConnection } from './panelConnection';
import type { StoreValues } from './storeValues';
import type { TimeTravel } from './timeTravel';

export type EditMode = 'live' | 'silent';

export type EditAction = 'edit' | 'preset' | 'revert';

const DEFAULT_EDIT_LABEL = '✎ devtools';

export interface EditsParts {
  registry: Registry;
  scopes: Scopes;
  history: History;
  collector: Collector;
  storeValues: StoreValues;
  connection: PanelConnection;
  timeTravel: TimeTravel;
  timeline: TimelineState;
  texts(): Texts;
}

/** Store values and event calls the developer makes from the panel. */
export class DevtoolsEdits {
  constructor(private readonly parts: EditsParts) {}

  /** While the app shows the past, edits and calls go to the scope it shows. */
  private targetScopeId(scopeId: string): string {
    const { timeline, scopes } = this.parts;
    return timeline.mode === 'past' && scopes.viewId ? scopes.viewId : scopeId;
  }

  private nodeOf(id: string): Node | undefined {
    return this.parts.registry.get(id)?.node;
  }

  /**
   * Set store values. `live` launches the stores (watchers and effects react,
   * logged like allSettled); `silent` renders a new forked scope with the values.
   */
  edit(
    scopeId: string,
    values: Record<string, unknown>,
    mode: EditMode,
    label?: string,
    action: EditAction = 'edit',
  ) {
    const { registry, scopes, collector } = this.parts;
    const targetScopeId = this.targetScopeId(scopeId);
    // a collected scope must not fall back to the global graph
    if (!scopes.isAvailable(targetScopeId)) return;
    const scope = scopes.get(targetScopeId);
    const ids = Object.keys(values).filter((id) => registry.get(id)?.info.writable);
    if (!ids.length) return;
    if (mode === 'silent' && scope && scopes.hasSwitcher()) {
      this.editInNewScope(targetScopeId, scope, ids, values, { label, action });
      return;
    }
    launchFromDevtools(collector, {
      cause: { kind: 'devtools', action, label },
      targets: ids.map((id) => this.nodeOf(id)!).filter(Boolean),
      params: ids.map((id) => values[id]),
      scope,
    });
  }

  /** fork({ values }) and a scope swap: nothing runs, a synthetic transaction tells what happened. */
  private editInNewScope(
    scopeId: string,
    scope: Scope,
    ids: string[],
    values: Record<string, unknown>,
    { label, action }: { label?: string; action: EditAction },
  ) {
    const { registry, scopes, history, collector, storeValues, connection, texts } = this.parts;
    const current = storeValues.valuesAt(scopeId, null);
    const next = new Map(current);
    for (const id of ids) next.set(registry.get(id)!.stateRef!.id, values[id]);
    const editedScope = storeValues.forkWith(next, scope);
    const editedScopeId = scopes.addBranch(
      editedScope,
      scopeId,
      null,
      'silent-edit',
      scopes.nameOf(scopeId),
    );
    scopes.makeLive(editedScopeId);
    scopes.show(editedScopeId);
    history.setBase(editedScopeId, current);
    const labelText = label || DEFAULT_EDIT_LABEL;
    const cause: TxCause = { kind: 'devtools', action, label: labelText };
    const first = registry.get(ids[0])!;
    const transaction = collector.createSynthetic(
      editedScopeId,
      { id: first.info.id, op: 'store', name: labelText },
      texts().silentEdit,
      { cause, flags: {} },
    );
    for (const id of ids) {
      const stateRefId = registry.get(id)!.stateRef!.id;
      transaction.deltas.set(stateRefId, values[id]);
      transaction.previousValues.set(stateRefId, current.get(stateRefId));
    }
    history.push(transaction);
    connection.queueTransaction(transaction);
    connection.scheduleFlush();
  }

  dispatch(scopeId: string, nodeId: string, payload: unknown) {
    const node = this.nodeOf(nodeId);
    if (!node) return;
    const targetScopeId = this.targetScopeId(scopeId);
    if (!this.parts.scopes.isAvailable(targetScopeId)) return;
    launchFromDevtools(this.parts.collector, {
      cause: { kind: 'devtools', action: 'dispatch' },
      targets: [node],
      params: [payload],
      scope: this.parts.scopes.get(targetScopeId),
    });
  }

  /** Back to the state before the oldest retained transaction, as one devtools transaction. */
  revert() {
    const { registry, scopes, storeValues, timeTravel } = this.parts;
    const scopeId = scopes.liveId ?? GLOBAL_ID;
    const base = storeValues.valuesAt(scopeId, -1);
    const values: Record<string, unknown> = {};
    for (const store of registry.writableStores()) {
      if (store.info.internal) continue;
      const value = base.get(store.stateRef!.id);
      if (value !== storeValues.readCurrent(scopeId, store.stateRef!.id)) {
        values[store.info.id] = value;
      }
    }
    timeTravel.goLive();
    this.edit(scopeId, values, 'live', 'Revert', 'revert');
  }
}
