/**
 * Access to effector internals used by the agent.
 *
 * `setInspector` and `setGraphInspector` are exported by effector at runtime
 * but not typed (they are what `effector/inspect` is built on). They are single
 * slots: whoever sets last wins. deffector uses them directly because only they
 * give the raw graph `Node` (needed to launch units for replay and dispatch),
 * the real `Stack` (exact parent links) and `stack.scope` (all scopes at once).
 * The public API we propose instead: docs site, Reference → Upstream effector PRs.
 */
import * as effector from 'effector';
import type { Scope as EffectorScope } from 'effector';

export type { EffectorScope };

export interface StateRef {
  id: string;
  current: unknown;
  initial?: unknown;
  before?: unknown[];
  sid?: string | null;
  meta?: Record<string, unknown>;
}

export type EffectHandler = (params: unknown) => unknown;

/** `node.scope`: per-node data; a store keeps its state ref here, an effect its runner. */
export interface NodeScope {
  state?: StateRef;
  /** the runner node of an effect: its scope holds the default handler */
  runner?: { scope?: { handler?: EffectHandler } };
  [key: string]: unknown;
}

/** Payload of a seq step: `mov` steps that read a store have `from: 'store'`. */
export interface StepData {
  from?: string;
  store?: StateRef;
  [key: string]: unknown;
}

export interface Node {
  id: string;
  next: Node[];
  seq: { type: string; order?: { priority: string; barrierID?: number }; data?: StepData }[];
  scope: NodeScope | null;
  meta: Record<string, any>;
  family: { type: string; links: Node[]; owners: Node[] };
}

export interface Stack {
  value: unknown;
  a: unknown;
  b: unknown;
  parent: Stack | null;
  node: Node;
  page: unknown;
  scope: Scope | null;
  meta?: Record<string, any>;
  /** the step that called launch, from effector with the upstream PR 4 */
  caller?: Stack;
}

/** The fields of effector's scope object the agent reads and writes. */
export interface Scope {
  kind: 'scope';
  reg: Record<string, StateRef>;
  values: { sidMap: Record<string, unknown>; idMap: Record<string, unknown> };
  handlers: { sidMap: Record<string, EffectHandler>; unitMap: Map<unknown, EffectHandler> };
  getState(ref: StateRef | object): unknown;
  graphite?: Node;
  /** fork({ name }) with the upstream PR 3 */
  name?: string;
  /** links a scope adds to nodes (createWatch with a scope), by node id */
  additionalLinks?: Record<string, Node[] | undefined>;
}

export interface Local {
  fail: boolean;
  failReason?: unknown;
}

/**
 * skip and launchId come from effector with the upstream inspect changes
 * (upstream effector PR 2); older versions pass only (stack, local).
 */
export type InspectorFn = (stack: Stack, local: Local, skip?: boolean, launchId?: number) => void;

/**
 * 'scope', 'link' and 'dispose' come with PR 3 and PR 5; older versions send units and regions only.
 * `target` is the scope for 'scope' and the removed node for 'dispose'.
 */
export type GraphInspectorFn = (
  node: Node | 'region' | 'scope' | 'link' | 'dispose',
  regionStack: RegionStack | null,
  target?: unknown,
) => void;

export interface RegionStack {
  id: string;
  parent: RegionStack | null;
  value: unknown;
  meta: Record<string, any>;
}

/** What effector exports at runtime, typed or not. */
interface EffectorRuntime {
  version?: string;
  setInspector: (inspector: InspectorFn) => void;
  setGraphInspector: (inspector: GraphInspectorFn, options: { links: boolean }) => void;
  launch: (config: {
    target: Node | Node[];
    params?: unknown;
    scope?: Scope | null;
    defer?: boolean;
  }) => void;
  fork: (config?: unknown) => Scope;
  allSettled: (
    unitOrScope: unknown,
    config?: { scope?: Scope; params?: unknown },
  ) => Promise<unknown>;
  createNode: (config?: unknown) => Node;
}

const runtime = effector as unknown as EffectorRuntime;

export const effectorVersion: string = runtime.version || 'unknown';

export const hasDeepHooks: boolean =
  typeof runtime.setInspector === 'function' && typeof runtime.setGraphInspector === 'function';

/** The leading integer of a version string, or 0 when it cannot be read. */
function majorOf(version: string): number {
  const major = Number.parseInt(version, 10);
  return Number.isFinite(major) ? major : 0;
}

/**
 * Whether effector lets a derived store be written from outside its own
 * computation. effector 22 only deprecated it; 23 asserts in `sample` and in
 * `.on`, so the graph shape the derived-write check looks for cannot be built
 * at all and running it is wasted work on every transaction.
 *
 * Read from the version rather than probed, unlike the hooks above: this is a
 * documented change in effector's public API, not a private graph shape, and
 * probing it would mean creating units that the panel would then show. A
 * version that cannot be read keeps the check — losing a finding is worse than
 * running one that stays quiet.
 */
export const allowsDerivedStoreWrites: boolean = majorOf(effectorVersion) < 23;

export function installInspector(inspector: InspectorFn): void {
  runtime.setInspector(inspector);
}

export function installGraphInspector(inspector: GraphInspectorFn): void {
  // the options argument is ignored by effector versions without link reporting
  runtime.setGraphInspector(inspector, { links: true });
}

export const { launch, fork, allSettled, createNode } = runtime;

/** The agent's view of a scope the app passed in (typed as effector's public `Scope`). */
export function asInternalScope(scope: object): Scope {
  return scope as Scope;
}

/** A scope handed back to the app (adapter switchers render it). */
export function asEffectorScope(scope: Scope): EffectorScope {
  return scope as unknown as EffectorScope;
}

/** Names of helper units effector creates for every store/effect. */
export const INTERNAL_NAMED = new Set([
  'updates',
  'reinit',
  'finally',
  'done',
  'fail',
  'doneData',
  'failData',
  'inFlight',
  'pending',
]);

/**
 * Value of a store ref in a scope. A raw StateRef would go through the
 * `isGetState = false` path of initRefInScope, which skips computing derived
 * stores (`noInit`) and returns their initial value; a node-shaped wrapper takes
 * the same path as scope.getState($store).
 */
export function readScopeValue(scope: Scope | null, ref: StateRef): unknown {
  if (!scope) return ref.current;
  return scope.getState({ scope: { state: ref } });
}
