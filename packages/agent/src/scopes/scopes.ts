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
  /**
   * The registration that installed this switcher. `show` and `addBranch` copy a
   * switcher into other records; the copies carry the same owner, so ending one
   * registration invalidates all of them, and a newer registration of the same
   * scope is not torn down by an older cleanup.
   */
  switcherOwner?: number;
  branch?: ScopeInfo['branch'];
}

/** What `register` hands back: the scope's id, and the token its cleanup needs. */
export interface Registration {
  scopeId: string;
  /** undefined when no switcher was installed: there is nothing to tear down */
  switcherOwner: number | undefined;
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

  private registrationCount = 0;

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

  register(scope: Scope, options: RegisterScopeOptions = {}): Registration {
    const scopeId = this.idOf(scope);
    const record = this.records.get(scopeId)!;
    if (options.name) record.name = options.name;
    else if (scope.name && DEFAULT_NAME.test(record.name)) record.name = scope.name;
    let switcherOwner: number | undefined;
    if (options.switcher) {
      this.registrationCount += 1;
      switcherOwner = this.registrationCount;
      record.switcher = options.switcher;
      record.switcherOwner = switcherOwner;
    }
    const liveHasNoSwitcher =
      !this.liveId || this.liveId === GLOBAL_ID || !this.records.get(this.liveId)?.switcher;
    if (options.live !== false && liveHasNoSwitcher) {
      this.liveId = scopeId;
      this.viewId = scopeId;
    }
    this.hasUnsentChanges = true;
    return { scopeId, switcherOwner };
  }

  /**
   * An adapter's provider went away: its switcher closes over a tree that no
   * longer exists, so it must not stay behind to be reported by `hasSwitcher`
   * or called by `show`. Every record holding a copy of that registration's
   * switcher is cleared; a newer registration owns a different token and stays.
   */
  unregister(switcherOwner: number | undefined) {
    if (switcherOwner === undefined) return;
    let changed = false;
    for (const record of this.records.values()) {
      if (record.switcherOwner !== switcherOwner) continue;
      delete record.switcher;
      delete record.switcherOwner;
      changed = true;
    }
    if (changed) this.hasUnsentChanges = true;
  }

  /**
   * Whether the id still names something the agent can act on. The global graph
   * always can; a scope whose record is gone, or whose weak box is empty after
   * collection, cannot — and must not be mistaken for the global graph, which is
   * what a bare `get() === null` would do.
   */
  isAvailable(id: string): boolean {
    if (id === GLOBAL_ID) return true;
    return !!Scopes.scopeOf(this.records.get(id));
  }

  /**
   * A switcher belongs to the app root, so every scope rendered through it shares
   * it — owner included, or ending the original registration could not reach the
   * copies. Takes ids rather than records so the mutation stays on a local, the
   * way the rest of this class does it.
   */
  private copySwitcherFrom(targetId: string, sourceId: string | undefined) {
    const target = this.records.get(targetId);
    if (!target) return;
    const source = sourceId === undefined ? undefined : this.records.get(sourceId);
    if (source?.switcher) {
      target.switcher = source.switcher;
      target.switcherOwner = source.switcherOwner;
      return;
    }
    delete target.switcher;
    delete target.switcherOwner;
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
    this.copySwitcherFrom(id, fromScopeId);
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
    const viewId = this.viewId || '';
    const viewSwitcher = this.records.get(viewId)?.switcher;
    const switcher = viewSwitcher || target?.switcher;
    if (!target || !scope || !switcher) return false;
    switcher(asEffectorScope(scope));
    this.copySwitcherFrom(id, viewSwitcher ? viewId : id);
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
