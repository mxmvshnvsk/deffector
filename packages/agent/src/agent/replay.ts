import { decode, type TimelineState, type TraceFile, type TraceStep } from '@deffector/protocol';
import type { Collector } from '../collector';
import { allSettled, type Node, type Scope } from '../effector';
import type { History, StateSnapshot } from '../history';
import type { Texts } from '../i18n';
import { sleep } from '../platform';
import type { Registry } from '../registry';
import { GLOBAL_ID, type Scopes } from '../scopes';
import { isExternalRoot } from '../trace';
import { launchFromDevtools } from './devtoolsLaunch';
import { mockEffects, recordedResults } from './effectMocks';
import type { PanelConnection } from './panelConnection';
import type { StoreValues } from './storeValues';
import type { TimeTravel } from './timeTravel';
import type { TraceExchange } from './traceExchange';

export type ReplayMode = 'animated' | 'instant';

/** pause between steps of an animated replay */
const ANIMATION_STEP_MS = 450;

export interface ReplayParts {
  registry: Registry;
  scopes: Scopes;
  history: History;
  collector: Collector;
  storeValues: StoreValues;
  connection: PanelConnection;
  timeTravel: TimeTravel;
  traces: TraceExchange;
  timeline: TimelineState;
  texts(): Texts;
}

/** Where a replay runs: a fresh forked scope, or the global graph reset in place. */
interface ReplayTarget {
  scope: Scope | null;
  scopeId: string;
}

/** Wait for the effects a step started (they answer from the recording). */
function settle(scope: Scope | null): Promise<unknown> {
  if (scope) return allSettled(scope).catch(() => undefined);
  return sleep(0);
}

/**
 * Replays a trace: the initial state, then every external call in order, with
 * effects answering from the recording instead of the network.
 */
export class Replayer {
  isRunning = false;

  constructor(private readonly parts: ReplayParts) {}

  private nodeOf(id: string): Node | undefined {
    return this.parts.registry.get(id)?.node;
  }

  async replay(trace: TraceFile, mode: ReplayMode) {
    if (this.isRunning) return;
    this.isRunning = true;
    const { scopes, timeline, connection, traces, timeTravel } = this.parts;
    const { mapping } = traces.checkCompatibility(trace);
    try {
      timeTravel.goLive();
      const initialValues = this.initialValues(trace, mapping);
      const results = recordedResults(trace, mapping);
      const isForked = scopes.isForkUsed && scopes.hasSwitcher();
      const author = trace.meta.author || trace.meta.app;
      const target = isForked
        ? this.startForkedScope(initialValues, author)
        : this.resetGlobalState(initialValues);
      const restoreHandlers = mockEffects(this.parts.registry, target.scope, results);
      timeline.mode = 'replay';
      try {
        await this.runSteps(trace, mapping, target, mode, author);
      } finally {
        restoreHandlers();
      }
      if (isForked) scopes.makeLive(target.scopeId);
      timeline.mode = 'live';
      timeline.cursor = null;
      timeline.replay = undefined;
      timeline.readOnlyLabel = mode === 'instant' ? author : undefined;
    } finally {
      this.isRunning = false;
      connection.sendTimeline();
      connection.scheduleFlush();
    }
  }

  /** The trace's initial values, by state ref on this page. */
  private initialValues(trace: TraceFile, mapping: Record<string, string>): StateSnapshot {
    const values: StateSnapshot = new Map();
    for (const [ref, value] of Object.entries(trace.initial)) {
      const store = mapping[ref] ? this.parts.registry.get(mapping[ref]) : undefined;
      if (store?.stateRef) values.set(store.stateRef.id, decode(value));
    }
    return values;
  }

  /** Every writable store: the trace's value, or the store's own initial value. */
  private startingValues(initialValues: StateSnapshot): StateSnapshot {
    const values: StateSnapshot = new Map();
    for (const store of this.parts.registry.writableStores()) {
      const stateRefId = store.stateRef!.id;
      values.set(
        stateRefId,
        initialValues.has(stateRefId) ? initialValues.get(stateRefId) : store.stateRef!.initial,
      );
    }
    return values;
  }

  private startForkedScope(initialValues: StateSnapshot, author: string): ReplayTarget {
    const { scopes, history, storeValues, texts } = this.parts;
    const live = scopes.get(scopes.liveId);
    const values = this.startingValues(initialValues);
    const scope = storeValues.forkWith(values, null);
    if (live) {
      for (const [unit, handler] of live.handlers.unitMap)
        scope.handlers.unitMap.set(unit, handler);
    }
    const scopeId = scopes.addBranch(
      scope,
      scopes.liveId || GLOBAL_ID,
      null,
      'replay',
      texts().replayLabel(author),
    );
    history.setBase(scopeId, values);
    scopes.show(scopeId);
    return { scope, scopeId };
  }

  private resetGlobalState(initialValues: StateSnapshot): ReplayTarget {
    this.parts.storeValues.writeInPlace(GLOBAL_ID, this.startingValues(initialValues));
    return { scope: null, scopeId: GLOBAL_ID };
  }

  private async runSteps(
    trace: TraceFile,
    mapping: Record<string, string>,
    target: ReplayTarget,
    mode: ReplayMode,
    author: string,
  ) {
    const { timeline, connection, collector } = this.parts;
    for (const [index, step] of trace.steps.entries()) {
      timeline.replay = { i: index + 1, total: trace.steps.length, label: author };
      connection.sendTimeline();
      this.replayStep(trace, step, mapping, target);
      collector.closeAll();
      // eslint-disable-next-line no-await-in-loop -- each step runs once the previous one settled
      await settle(target.scope);
      // eslint-disable-next-line no-await-in-loop -- the animated replay shows the steps one by one
      if (mode === 'animated') await sleep(ANIMATION_STEP_MS);
    }
    await settle(target.scope);
  }

  private replayStep(
    trace: TraceFile,
    step: TraceStep,
    mapping: Record<string, string>,
    { scope, scopeId }: ReplayTarget,
  ) {
    const { collector } = this.parts;
    const note = trace.notes.find((candidate) => candidate.step === step.n)?.text;
    const unitId = mapping[step.unit];
    if (!unitId) {
      this.skipUnknownStep(trace, step, scopeId, note);
      return;
    }
    const replayed = { note, flags: { replay: true }, replayOf: step.n };
    if (step.values) {
      const values: Record<string, unknown> = {};
      for (const [ref, value] of Object.entries(step.values)) {
        if (mapping[ref]) values[mapping[ref]] = decode(value);
      }
      const ids = Object.keys(values);
      launchFromDevtools(collector, {
        cause: { kind: 'devtools', action: step.devtools || 'edit', label: '✎ trace' },
        targets: ids.map((id) => this.nodeOf(id)!).filter(Boolean),
        params: ids.map((id) => values[id]),
        scope,
        ...replayed,
      });
      return;
    }
    launchFromDevtools(collector, {
      cause: { kind: 'devtools', action: 'replay', label: `#${step.n}` },
      targets: [this.nodeOf(unitId)!],
      params: [decode(step.params)],
      scope,
      ...replayed,
    });
  }

  /** A step of a unit this page does not have: shown as a synthetic transaction. */
  private skipUnknownStep(trace: TraceFile, step: TraceStep, scopeId: string, note?: string) {
    const { collector, history, connection, texts } = this.parts;
    const traceUnit = trace.units.find((unit) => unit.ref === step.unit);
    const name = traceUnit?.name || step.unit;
    const transaction = collector.createSynthetic(
      scopeId,
      { id: `trace:${step.unit}`, op: traceUnit?.kind || 'event', name },
      texts().unknownStep(name),
      { note, flags: { skipped: true, replay: true } },
    );
    const evicted = history.push(transaction);
    if (evicted) history.forgetBaseOf(evicted.scopeId);
    connection.queueTransaction(transaction);
    connection.scheduleFlush();
  }

  /** Redux-style skip: re-run every external root of the live scope except the toggled one. */
  async skip(transactionId: number) {
    if (this.isRunning) return;
    const { scopes, history, traces, timeline, connection } = this.parts;
    const transaction = history.get(transactionId);
    if (!transaction || (!isExternalRoot(transaction) && !transaction.flags.skipped)) return;
    const { scopeId } = transaction;
    if (scopeId === GLOBAL_ID || !scopes.hasSwitcher()) return;
    const trace = traces.export(scopeId);
    const skipped = new Set<number>(
      history
        .inScope(scopeId)
        .filter((candidate) => candidate.flags.skipped && !candidate.synthetic)
        .map((candidate) => candidate.id),
    );
    if (skipped.has(transactionId)) skipped.delete(transactionId);
    else skipped.add(transactionId);
    trace.steps = trace.steps.filter((step) => !skipped.has(step.n));
    await this.replay(trace, 'instant');
    timeline.readOnlyLabel = undefined;
    connection.sendTimeline();
  }
}
