export type DiagnosticLevel = 'error' | 'warning' | 'info' | 'ok';

export interface Diagnostic {
  id: string;
  level: DiagnosticLevel;
  code:
    | 'out-of-scope'
    | 'no-sid'
    | 'duplicate-sid'
    | 'double-update'
    | 'filter-blocked'
    | 'pure-error'
    | 'effect-fail'
    | 'inspector-conflict'
    | 'global-mode'
    | 'cycle'
    | 'recording-limit'
    | 'no-adapter'
    | 'nondeterministic'
    | 'ok'
    | 'sid-mismatch'
    | 'derived-write'
    | 'stale-read'
    | 'inconsistent-derived'
    | 'late-units'
    | 'unit-leak'
    | 'emergency-stop'
    | 'event-cycle'
    | 'store-cycle'
    | 'paused';
  title: string;
  detail: string;
  node?: string;
  /** several units involved (a cycle, the hot units of a runaway) */
  nodes?: string[];
  txId?: number;
  file?: string;
  fix?: string;
  count: number;
}
