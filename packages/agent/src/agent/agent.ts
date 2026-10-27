import type {
  AgentTransport,
  PanelCommand,
  TimelineState,
  TraceFile,
  Tx,
} from '@deffector/protocol';
import { Collector } from '../collector';
import { Diagnostics } from '../diagnostics';
import { asInternalScope, hasDeepHooks, type EffectorScope } from '../effector';
import { History, type RawTransaction } from '../history';
import { texts, type Locale, type Texts } from '../i18n';
import { EffectOverrides } from '../overrides';
import { pageUrl } from '../platform';
import { Registry } from '../registry';
import { GLOBAL_ID, Scopes, type ScopeSwitcher } from '../scopes';
import { CommandHandler } from './commands';
import { DevtoolsEdits, type EditAction, type EditMode } from './edits';
import { encodeTransaction } from './encodeTransaction';
import { buildGraph, type UnitGraph } from './graph';
import { HealthMonitor } from './health';
import { buildHelloInfo } from './hello';
import { InspectorSlot } from './inspectorSlot';
import { describeModel } from './models';
import {
  DEFAULT_GRACE_MS,
  DEFAULT_MAX_TRANSACTIONS,
  type AgentOptions,
  type AppInfo,
} from './options';
import { PanelConnection } from './panelConnection';
import { Recording } from './recording';
import { Replayer, type ReplayMode } from './replay';
import { StoreValues } from './storeValues';
import { TimeTravel } from './timeTravel';
import { TraceExchange } from './traceExchange';

/** internal errors logged to the console; the rest are only counted */
const LOGGED_INTERNAL_ERRORS = 5;

function defaultAppName(): string {
  return (typeof document !== 'undefined' && document.title) || 'app';
}

/**
 * The page-side half of deffector. One instance per effector copy.
 * Created on import of '@deffector/agent'; the transport is attached later.
 *
 * A facade: the work is done by collaborators wired here — the collector
 * (kernel steps → transactions), the panel connection, recording, time travel,
 * edits, replay, traces and health checks.
 */
export class Agent {
  readonly registry: Registry;

  readonly scopes = new Scopes();

  readonly history: History;

  readonly collector: Collector;

  readonly diagnostics: Diagnostics;

  readonly overrides: EffectOverrides;

  readonly traces: TraceExchange;

  app: AppInfo;

  timeline: TimelineState = {
    mode: 'live',
    cursor: null,
    liveScopeId: null,
    viewScopeId: null,
    recording: true,
    strategy: 'none',
  };

  readonly installed: boolean;

  internalErrors = 0;

  readonly instance = Math.random().toString(36).slice(2, 10);

  private locale: Locale = 'en';

  private readonly connection: PanelConnection;

  private readonly storeValues: StoreValues;

  private readonly recording: Recording;

  private readonly health: HealthMonitor;

  private readonly inspectorSlot: InspectorSlot;

  private readonly timeTravel: TimeTravel;

  private readonly edits: DevtoolsEdits;

  private readonly replayer: Replayer;

  private readonly commands: CommandHandler;

  constructor(options: AgentOptions = {}) {
    const { scopes, timeline } = this;
    const onInternalError = (error: unknown) => this.onInternalError(error);
    const readTexts = () => this.texts;
    const refreshStaticDiagnostics = () => this.health.refreshStaticDiagnostics();
    const encode = (transaction: RawTransaction) => this.encodeTx(transaction);
    const app = {
      name: options.name || defaultAppName(),
      url: pageUrl() ?? '',
      build: options.build,
    };
    const registry = new Registry(() => this.collector.elapsed());
    const history = new History(options.maxTransactions ?? DEFAULT_MAX_TRANSACTIONS);
    const collector = new Collector(registry, scopes, history, {
      onClose: (transactions) => this.recording.onTransactionsClosed(transactions),
      onInternalError,
      onEmergencyStop: () => this.recording.onEmergencyStop(),
    });
    if (options.maxSteps) collector.maxSteps = options.maxSteps;
    if (options.hardStop !== undefined) collector.runawayGuard.stepLimit = options.hardStop;
    const diagnostics = new Diagnostics(registry, scopes, readTexts);
    diagnostics.maxSteps = collector.maxSteps;
    const overrides = new EffectOverrides(registry, scopes);
    const connection = new PanelConnection({
      registry,
      scopes,
      history,
      diagnostics,
      overrides,
      encode,
      helloInfo: () => buildHelloInfo(registry, app, this.instance),
      timelineState: () => this.timelineState(),
      refreshStaticDiagnostics,
      onInternalError,
    });
    const storeValues = new StoreValues(registry, scopes, history, collector, overrides);
    const health = new HealthMonitor({
      registry,
      scopes,
      history,
      diagnostics,
      connection,
      onInternalError,
    });
    const recording = new Recording({
      registry,
      history,
      collector,
      diagnostics,
      connection,
      storeValues,
      timeline,
      texts: readTexts,
      onSuspiciousTransaction: (scopeId) => health.scheduleConsistencyCheck(scopeId),
      refreshStaticDiagnostics,
    });
    const inspectorSlot = new InspectorSlot({
      collector,
      registry,
      scopes,
      diagnostics,
      health,
      connection,
      onInternalError,
    });
    const shared = { registry, scopes, history, collector, storeValues, connection, timeline };
    const timeTravel = new TimeTravel({ ...shared, texts: readTexts });
    const edits = new DevtoolsEdits({ ...shared, timeTravel, texts: readTexts });
    const traces = new TraceExchange({ registry, scopes, history, storeValues, app });
    const replayer = new Replayer({ ...shared, timeTravel, traces, texts: readTexts });
    this.commands = new CommandHandler({
      ...shared,
      overrides,
      recording,
      health,
      inspectorSlot,
      timeTravel,
      edits,
      replayer,
      traces,
      encode,
      setLocale: (locale) => {
        this.locale = locale;
      },
      stateValues: (scopeId, transactionId) => this.stateValues(scopeId, transactionId),
      jump: (transactionId) => this.jump(transactionId),
    });
    this.app = app;
    this.registry = registry;
    this.history = history;
    this.collector = collector;
    this.diagnostics = diagnostics;
    this.overrides = overrides;
    this.traces = traces;
    this.connection = connection;
    this.storeValues = storeValues;
    this.recording = recording;
    this.health = health;
    this.inspectorSlot = inspectorSlot;
    this.timeTravel = timeTravel;
    this.edits = edits;
    this.replayer = replayer;
    timeline.locked = options.lockPast ?? true;
    recording.whileClosed = options.whileClosed ?? 'pause';
    recording.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    diagnostics.graceSeconds = Math.round(recording.graceMs / 1000);
    this.installed = hasDeepHooks;
    if (hasDeepHooks) this.install();
    recording.schedulePause(recording.graceMs);
  }

  get paused(): boolean {
    return this.collector.isPaused;
  }

  get texts(): Texts {
    return texts[this.locale];
  }

  /** No panel: stop recording (only the emergency stop keeps watching). */
  pause() {
    this.recording.pause();
  }

  configure(options: AgentOptions) {
    const { app, history, collector, diagnostics, recording, connection } = this;
    if (options.name) app.name = options.name;
    if (options.build) app.build = options.build;
    if (options.maxTransactions) history.capacity = options.maxTransactions;
    if (options.maxSteps) {
      collector.maxSteps = options.maxSteps;
      diagnostics.maxSteps = options.maxSteps;
    }
    if (options.hardStop !== undefined) collector.runawayGuard.stepLimit = options.hardStop;
    if (options.lockPast !== undefined) this.timeline.locked = options.lockPast;
    if (options.whileClosed) {
      recording.whileClosed = options.whileClosed;
      if (options.whileClosed === 'record') recording.resume();
    }
    if (options.graceMs !== undefined) {
      recording.graceMs = options.graceMs;
      if (!connection.isListening && !collector.isPaused) recording.schedulePause(options.graceMs);
    }
    connection.sendHello();
  }

  /** Install (or reclaim) both kernel hooks. */
  install() {
    this.inspectorSlot.install();
  }

  /** Check that nobody replaced our inspector (effector/inspect has a single slot). */
  checkInspector(): boolean {
    return this.inspectorSlot.check();
  }

  /**
   * Give a scope a readable name, and (for adapters) a way to render the app
   * with another scope. The returned function is called when the provider
   * unmounts: the scope stays known, for history.
   */
  /** @returns a teardown for the adapter to call when its provider goes away */
  registerScope(
    scope: EffectorScope | object,
    options: { name?: string; switcher?: ScopeSwitcher } = {},
  ): () => void {
    const internal = asInternalScope(scope);
    this.scopes.register(internal, options);
    this.onScopesChanged();
    return () => {
      this.scopes.unregister(internal);
      this.onScopesChanged();
    };
  }

  /** Time travel can only render a past scope while an adapter offers a switcher. */
  private onScopesChanged() {
    this.timeline.liveScopeId = this.scopes.liveId;
    this.timeline.viewScopeId = this.scopes.viewId;
    this.timeline.strategy =
      this.scopes.isForkUsed && this.scopes.hasSwitcher() ? 'fork' : 'in-place';
    this.health.refreshStaticDiagnostics();
    this.connection.scheduleFlush();
  }

  connect(transport: AgentTransport): () => void {
    return this.connection.attach(transport, (command) => this.handle(command));
  }

  async handle(command: PanelCommand) {
    await this.commands.handle(command);
  }

  private timelineState(): TimelineState {
    const { timeline, scopes, collector } = this;
    timeline.liveScopeId = scopes.liveId ?? GLOBAL_ID;
    timeline.viewScopeId = scopes.viewId ?? GLOBAL_ID;
    timeline.recording = collector.isRecording;
    return { ...timeline };
  }

  private onInternalError(error: unknown) {
    this.internalErrors += 1;
    if (this.internalErrors <= LOGGED_INTERNAL_ERRORS && typeof console !== 'undefined') {
      // eslint-disable-next-line no-console -- a bug in deffector must be visible without breaking the app
      console.warn('[deffector] internal error', error);
    }
  }

  encodeTx(transaction: RawTransaction): Tx {
    return encodeTransaction(transaction, this.texts);
  }

  /** Values of all stores (derived included) of a scope at a transaction, keyed by unit id. */
  stateValues(scopeId: string, transactionId: number | null): Record<string, unknown> {
    const isPresent =
      transactionId === null ||
      (this.timeline.cursor === null && transactionId === this.history.last()?.id);
    if (isPresent) return this.storeValues.allStoresNow(scopeId);
    return this.storeValues.allStoresAt(scopeId, transactionId);
  }

  jump(transactionId: number | null) {
    if (this.replayer.isRunning) return;
    this.timeTravel.jump(transactionId);
  }

  setLock(isLocked: boolean) {
    this.timeTravel.setLock(isLocked);
  }

  goLive() {
    this.timeTravel.goLive();
  }

  edit(
    scopeId: string,
    values: Record<string, unknown>,
    mode: EditMode,
    label?: string,
    action: EditAction = 'edit',
  ) {
    this.edits.edit(scopeId, values, mode, label, action);
  }

  dispatch(scopeId: string, nodeId: string, payload: unknown) {
    this.edits.dispatch(scopeId, nodeId, payload);
  }

  async replay(trace: TraceFile, mode: ReplayMode) {
    await this.replayer.replay(trace, mode);
  }

  /** Redux-style skip: re-run every external root of the live scope except the toggled one. */
  async skip(transactionId: number) {
    await this.replayer.skip(transactionId);
  }

  /** Derived stores of a scope that disagree with a recomputation from their sources. */
  checkConsistency(scopeId: string): string[] {
    return this.health.checkConsistency(scopeId);
  }

  /** Strongly connected components of the unit graph: cycles, and whether they pass a store. */
  scanCycles() {
    this.health.scanCycles();
  }

  /**
   * Group the units of a model instance: an object of units (nested objects too),
   * or anything with the `@@debug` method proposed in patronum#297.
   */
  registerModel(instance: unknown, name?: string): string[] {
    const model = describeModel(instance, name, (id) => this.registry.units.has(id));
    if (!model) return [];
    if (model.ids.length) this.registry.assignModel(model.ids, model.label);
    this.connection.scheduleFlush();
    return model.ids;
  }

  graph(): UnitGraph {
    return buildGraph(this.registry);
  }
}
