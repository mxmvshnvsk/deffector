import type { Diagnostic } from '@deffector/protocol';
import type { RawTransaction } from '../history';
import type { Texts } from '../i18n';
import type { Registry } from '../registry';
import type { Scopes } from '../scopes';
import { collectStaticDiagnostics } from './staticChecks';
import { checkTransaction } from './transactionChecks';
import type { Finding, FindingCounter, GraphCycle } from './types';
import { joinFirst, UnitLabels } from './unitLabels';

const STATIC_PREFIX = 'static:';

const LEVEL_ORDER = { error: 0, warning: 1, info: 2, ok: 3 };

/**
 * Runtime "lint" for problems that recur in effector issues (research doc,
 * families R1–R14). Every item says what happened and how to fix it.
 */
export class Diagnostics implements FindingCounter {
  private readonly items = new Map<string, Diagnostic>();

  private readonly labels: UnitLabels;

  /** the list changed since it was last sent to the panel */
  hasUnsentChanges = false;

  hasInspectorConflict = false;

  maxSteps = 5000;

  /** set by the agent: cycles found in the static graph */
  cycles: GraphCycle[] = [];

  /** set by the agent when recording resumed after a pause (ms since start) */
  resumedAt: number | null = null;

  graceSeconds = 10;

  constructor(
    private readonly registry: Registry,
    private readonly scopes: Scopes,
    private readonly texts: () => Texts,
  ) {
    this.labels = new UnitLabels(registry);
  }

  count(key: string, describe: () => Finding, transactionId?: number) {
    const known = this.items.get(key);
    if (known) {
      known.count += 1;
      if (transactionId !== undefined) known.txId = transactionId;
    } else {
      this.items.set(key, { id: key, count: 1, ...describe(), txId: transactionId });
    }
    this.hasUnsentChanges = true;
  }

  onTransactions(transactions: RawTransaction[]) {
    const context = {
      labels: this.labels,
      texts: this.texts(),
      maxSteps: this.maxSteps,
      findings: this,
    };
    for (const transaction of transactions) checkTransaction(transaction, context);
  }

  reportEmergencyStop(
    steps: number,
    hottestUnits: { id: string; count: number }[],
    transactionId?: number,
  ) {
    const texts = this.texts();
    const names = joinFirst(
      hottestUnits.map((unit) => this.labels.name(unit.id)),
      5,
      ', ',
      '',
    );
    const detail = texts.stopDetail(steps, names || '—');
    const first = hottestUnits[0];
    this.count(
      'emergency',
      () => ({
        level: 'error',
        code: 'emergency-stop',
        node: first?.id,
        nodes: hottestUnits.map((unit) => unit.id),
        file: first ? this.labels.location(first.id) : undefined,
        title: texts.stopTitle,
        detail,
        fix: texts.stopFix,
      }),
      transactionId,
    );
    // a newer stop replaces the detail
    this.items.get('emergency')!.detail = detail;
  }

  /** Result of comparing derived stores with a recomputation from their sources. */
  reportConsistency(mismatchedIds: string[]) {
    const texts = this.texts();
    this.items.delete('consistency');
    if (mismatchedIds.length) {
      const names = joinFirst(
        mismatchedIds.map((id) => this.labels.name(id)),
        6,
      );
      this.items.set('consistency', {
        id: 'consistency',
        level: 'warning',
        code: 'inconsistent-derived',
        count: mismatchedIds.length,
        node: mismatchedIds[0],
        file: this.labels.location(mismatchedIds[0]),
        title: texts.inconsistentTitle(mismatchedIds.length),
        detail: texts.inconsistentDetail(names),
        fix: texts.inconsistentFix,
      });
    } else {
      this.items.set('consistency', {
        id: 'consistency',
        level: 'ok',
        code: 'ok',
        count: 1,
        title: texts.consistentTitle,
        detail: '',
      });
    }
    this.hasUnsentChanges = true;
  }

  /** Checks that depend on units and scopes, not on transactions. */
  refreshStatic(hasTransactions: boolean) {
    for (const key of [...this.items.keys()]) {
      if (key.startsWith(STATIC_PREFIX)) this.items.delete(key);
    }
    const diagnostics = collectStaticDiagnostics({
      registry: this.registry,
      scopes: this.scopes,
      labels: this.labels,
      texts: this.texts(),
      hasTransactions,
      cycles: this.cycles,
      hasResumedAfterPause: this.resumedAt !== null,
      graceSeconds: this.graceSeconds,
      hasInspectorConflict: this.hasInspectorConflict,
    });
    for (const diagnostic of diagnostics) this.items.set(diagnostic.id, diagnostic);
    this.hasUnsentChanges = true;
  }

  list(): Diagnostic[] {
    const sorted = [...this.items.values()].sort(
      (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
    );
    // the ok item claims no transaction passed the step limit, so either finding contradicts it
    const hasStepLimitFinding = sorted.some(
      (item) => item.code === 'recording-limit' || item.code === 'emergency-stop',
    );
    if (hasStepLimitFinding) return sorted;
    const texts = this.texts();
    sorted.push({
      id: 'ok:cycles',
      level: 'ok',
      code: 'ok',
      count: 1,
      title: texts.okCycles,
      detail: texts.okCyclesDetail(this.maxSteps),
    });
    return sorted;
  }

  /** Forget what transactions reported; static checks stay. */
  clear() {
    for (const key of [...this.items.keys()]) {
      if (!key.startsWith(STATIC_PREFIX)) this.items.delete(key);
    }
    this.hasUnsentChanges = true;
  }
}
