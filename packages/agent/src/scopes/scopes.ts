import type { ScopeInfo } from '@deffector/protocol';
import { asEffectorScope, type EffectorScope, type Scope } from '../effector';
import { createCollectionWatcher, weakBox, type WeakBox } from '../platform';

/** How an adapter renders the app with another scope. */
export type ScopeSwitcher = (scope: EffectorScope) => void;

interface ScopeRecord {
  id: string;
  name: string;
  /** weak: a server forks a scope per request, and the agent must not outlive them. null = global */
  scope: WeakBox<Scope> | null;
  switcher?: ScopeSwitcher;
  branch?: ScopeInfo['branch'];
}

export interface RegisterScopeOptions {
  name?: string;
  switcher?: ScopeSwitcher;
  live?: boolean;
}

export const GLOBAL_ID = 'global';

const DEFAULT_NAME = /^scope \d+$/;

/**
 * Keeps ids and names for scopes. Scopes are discovered from `stack.scope`
 * at runtime or registered explicitly by adapters (`DeffectorProvider`).
 * Adapters also provide a switcher: a way to render the app with another scope,
 * which is what time travel and replay use.
 *
 * A record holds its scope weakly. On a server every request forks its own
 * scope, and a strong reference here would keep that request's whole state
 * alive for as long as the process runs. Once a scope is collected its record
 * is dropped too, unless it is the live or viewed one or carries an adapter's
 * switcher — those belong to the app root and outlive any single scope.
 */
export class Scopes {
  private readonly idsByScope = new WeakMap<Scope, string>();

  private readonly records = new Map<string, ScopeRecord>();

  private readonly watchCollection = createCollectionWatcher<string>((id) => this.forget(id));

  private createdCount = 0;

  /** at least one fork() scope was seen: calls outside of scope become suspicious */
  isForkUsed = false;

  liveId: string | null = null;

  viewId: string | null = null;

  /** the list changed since it was last sent to the panel */
  hasUnsentChanges = true;

  constructor() {
    this.records.set(GLOBAL_ID, { id: GLOBAL_ID, name: 'global', scope: null });
  }

  /** The scope of a record, or null once it is global or collected. */
  private static scopeOf(record: ScopeRecord | undefined): Scope | null {
    return record?.scope?.deref() ?? null;
  }

  /** A collected scope: keep the record only while something still points at it. */
  private forget(id: string) {
    const record = this.records.get(id);
    if (!record || record.switcher || this.liveId === id || this.viewId === id) return;
    this.records.delete(id);
    this.hasUnsentChanges = true;
  }

  idOf(scope: Scope | null | undefined): string {
    if (!scope) return GLOBAL_ID;
    const known = this.idsByScope.get(scope);
    if (known) return known;
    this.createdCount += 1;
    const id = `s${this.createdCount}`;
    this.idsByScope.set(scope, id);
    this.records.set(id, { id, name: `scope ${this.createdCount}`, scope: weakBox(scope) });
    this.watchCollection(scope, id);
    this.isForkUsed = true;
    if (!this.liveId) {
      this.liveId = id;
      this.viewId = id;
    }
    this.hasUnsentChanges = true;
    return id;
  }

  register(scope: Scope, options: RegisterScopeOptions = {}): string {
    const id = this.idOf(scope);
    const record = this.records.get(id)!;
    if (options.name) record.name = options.name;
    else if (scope.name && DEFAULT_NAME.test(record.name)) record.name = scope.name;
    if (options.switcher) record.switcher = options.switcher;
    const liveHasNoSwitcher =
      !this.liveId || this.liveId === GLOBAL_ID || !this.records.get(this.liveId)?.switcher;
    if (options.live !== false && liveHasNoSwitcher) {
      this.liveId = id;
      this.viewId = id;
    }
    this.hasUnsentChanges = true;
    return id;
  }

  /**
   * An adapter's provider went away: its switcher closes over a tree that no
   * longer exists, so it must not stay behind to be reported by `hasSwitcher`
   * or called by `show`. Looked up without `idOf`, which would mint a record
   * for a scope that was never registered.
   */
  unregister(scope: Scope) {
    const id = this.idsByScope.get(scope);
    const record = id === undefined ? undefined : this.records.get(id);
    if (!record?.switcher) return;
    delete record.switcher;
    this.hasUnsentChanges = true;
  }

  /** a name from fork({ name }) unless the app or an adapter gave one */
  nameIfDefault(scope: Scope, name: string) {
    const record = this.records.get(this.idOf(scope))!;
    if (!DEFAULT_NAME.test(record.name)) return;
    record.name = name;
    this.hasUnsentChanges = true;
  }

  addBranch(
    scope: Scope,
    fromScopeId: string,
    transactionId: number | null,
    reason: 'jump' | 'replay' | 'silent-edit',
    name: string,
  ): string {
    const id = this.idOf(scope);
    const record = this.records.get(id)!;
    record.name = name;
    record.branch = { fromScopeId, txId: transactionId, reason };
    record.switcher = this.records.get(fromScopeId)?.switcher;
    this.hasUnsentChanges = true;
    return id;
  }

  get(id: string | null): Scope | null {
    if (id === null) return null;
    return Scopes.scopeOf(this.records.get(id));
  }

  nameOf(id: string): string {
    return this.records.get(id)?.name ?? id;
  }

  isBranch(id: string): boolean {
    return !!this.records.get(id)?.branch;
  }

  /** Render the app with the given scope (time travel / replay / return to present). */
  show(id: string): boolean {
    const target = this.records.get(id);
    const scope = Scopes.scopeOf(target);
    const switcher = this.records.get(this.viewId || '')?.switcher || target?.switcher;
    if (!target || !scope || !switcher) return false;
    switcher(asEffectorScope(scope));
    // the switcher belongs to the app root, every scope rendered through it shares it
    target.switcher = switcher;
    this.viewId = id;
    this.hasUnsentChanges = true;
    return true;
  }

  makeLive(id: string) {
    this.liveId = id;
    const record = this.records.get(id);
    if (record) delete record.branch;
    this.hasUnsentChanges = true;
  }

  /** all known scope objects (not global) */
  knownScopes(): { id: string; scope: Scope }[] {
    const known: { id: string; scope: Scope }[] = [];
    for (const record of this.records.values()) {
      const scope = Scopes.scopeOf(record);
      if (scope) known.push({ id: record.id, scope });
    }
    return known;
  }

  hasSwitcher(): boolean {
    for (const record of this.records.values()) if (record.switcher) return true;
    return false;
  }

  list(): ScopeInfo[] {
    const infos: ScopeInfo[] = [];
    for (const record of this.records.values()) {
      if (record.id === GLOBAL_ID && this.isForkUsed && this.liveId !== GLOBAL_ID) {
        infos.push({
          id: record.id,
          name: record.name,
          kind: 'global',
          view: false,
          live: false,
          switchable: false,
        });
        continue;
      }
      infos.push({
        id: record.id,
        name: record.name,
        kind: record.id === GLOBAL_ID ? 'global' : 'scope',
        view: (this.viewId ?? GLOBAL_ID) === record.id,
        live: (this.liveId ?? GLOBAL_ID) === record.id,
        branch: record.branch,
        // a collected scope cannot be rendered again, whatever switcher the record kept
        switchable: !!record.switcher && !!Scopes.scopeOf(record),
      });
    }
    return infos;
  }
}
