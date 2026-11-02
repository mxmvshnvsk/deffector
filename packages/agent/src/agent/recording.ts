import type { TimelineState } from '@deffector/protocol';
import type { Collector } from '../collector';
import type { Diagnostics } from '../diagnostics';
import type { History, RawTransaction } from '../history';
import type { Texts } from '../i18n';
import { canSetTimers, unrefTimer } from '../platform';
import type { Registry } from '../registry';
import type { Scopes } from '../scopes';
import { DEFAULT_GRACE_MS, type WhileClosed } from './options';
import type { PanelConnection } from './panelConnection';
import type { StoreValues } from './storeValues';

const HOTTEST_LOGGED = 5;

export interface RecordingParts {
  registry: Registry;
  history: History;
  scopes: Scopes;
  collector: Collector;
  diagnostics: Diagnostics;
  connection: PanelConnection;
  storeValues: StoreValues;
  timeline: TimelineState;
  texts(): Texts;
  /** a transaction with an error or a derived write: compare derived stores with their sources */
  onSuspiciousTransaction(scopeId: string): void;
  refreshStaticDiagnostics(): void;
}

/**
 * What happens to closed transactions: kept in history and queued for the
 * panel, or only folded into snapshots while recording is off. Without a
 * panel, recording pauses after a grace period (only the emergency stop keeps
 * watching) and resumes when a panel connects.
 */
export class Recording {
  whileClosed: WhileClosed = 'pause';

  graceMs = DEFAULT_GRACE_MS;

  private pauseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly parts: RecordingParts) {}

  get isPaused(): boolean {
    return this.parts.collector.isPaused;
  }

  schedulePause(delayMs: number) {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    if (this.whileClosed !== 'pause' || !canSetTimers()) return;
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      if (!this.parts.connection.isListening) this.pause();
    }, delayMs);
    unrefTimer(this.pauseTimer);
  }

  /** No panel: stop recording (only the emergency stop keeps watching). */
  pause() {
    const { collector, history, connection, diagnostics } = this.parts;
    if (collector.isPaused) return;
    collector.closeAll();
    collector.isPaused = true;
    history.rebase(() => new Map());
    connection.dropUnsentTransactions();
    diagnostics.clear();
  }

  /** A panel connected: the present becomes the base, recording goes on. */
  resume() {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    const { collector, history, storeValues, diagnostics } = this.parts;
    if (!collector.isPaused) return;
    collector.isPaused = false;
    history.rebase((scopeId) => storeValues.currentValues(scopeId));
    diagnostics.resumedAt = collector.elapsed();
  }

  /** Forget the history: the present becomes the base (clear, commit, recording turned on). */
  rebase() {
    const { history, storeValues, diagnostics, connection, timeline } = this.parts;
    history.rebase((scopeId) => storeValues.currentValues(scopeId));
    diagnostics.clear();
    connection.dropUnsentTransactions();
    timeline.cursor = null;
    connection.send({ type: 'cleared', keepFrom: null });
    connection.sendTimeline();
    connection.scheduleFlush();
  }

  setRecording(isOn: boolean) {
    const { collector, connection } = this.parts;
    if (isOn && !collector.isRecording) this.rebase();
    collector.isRecording = isOn;
    connection.sendTimeline();
  }

  /**
   * A transaction fell out of the buffer. If it was the last one of its scope,
   * that scope's base snapshot has nothing left to reconstruct — unless it is
   * the live or viewed scope, which are still asked for the state before the
   * oldest retained transaction by revert and by a trace export.
   */
  private forgetUnusedBase(scopeId: string) {
    const { history, scopes } = this.parts;
    if (scopeId === scopes.liveId || scopeId === scopes.viewId) return;
    history.forgetBaseOf(scopeId);
  }

  readonly onTransactionsClosed = (transactions: RawTransaction[]) => {
    const { collector, history, diagnostics, connection, timeline } = this.parts;
    if (!collector.isRecording) {
      // keep snapshots consistent while recording is off: fold changes into the base
      for (const transaction of transactions) {
        const base = history.baseOf(transaction.scopeId);
        for (const [stateRefId, value] of transaction.deltas) base.set(stateRefId, value);
      }
      return;
    }
    for (const transaction of transactions) {
      if (transaction.flags.hidden) {
        // an ignore rule: keep the deltas so snapshots stay right, drop the rest
        transaction.steps = [];
        transaction.effectCalls = [];
        transaction.payload = undefined;
      }
      const evicted = history.push(transaction);
      if (evicted) {
        if (timeline.cursor !== null && evicted.id === timeline.cursor) timeline.cursor = null;
        this.forgetUnusedBase(evicted.scopeId);
      }
      if (!transaction.flags.hidden) connection.queueTransaction(transaction);
      if (transaction.flags.error || transaction.flags.derivedWrite) {
        this.parts.onSuspiciousTransaction(transaction.scopeId);
      }
    }
    diagnostics.onTransactions(transactions);
    // the first transactions of the page: global mode and friends can be told now
    if (history.transactions.length === transactions.length) this.parts.refreshStaticDiagnostics();
    connection.scheduleFlush();
  };

  readonly onEmergencyStop = () => {
    const { collector, history, diagnostics, registry, connection } = this.parts;
    const stop = collector.runawayGuard.lastStop;
    if (!stop) return;
    diagnostics.reportEmergencyStop(stop.steps, stop.hottestUnits, history.last()?.id);
    if (typeof console !== 'undefined') {
      const names = stop.hottestUnits
        .slice(0, HOTTEST_LOGGED)
        .map((unit) => registry.get(unit.id)?.info.name ?? unit.id)
        .join(', ');
      // eslint-disable-next-line no-console -- the developer must learn that deffector cut their app's propagation
      console.error(`[deffector] ${this.parts.texts().stopTitle}: ${names}`);
    }
    connection.scheduleFlush();
  };
}
