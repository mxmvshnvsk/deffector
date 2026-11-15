import type { TimelineState } from '@deffector/protocol';
import type { History, StateSnapshot } from '../history';
import type { Texts } from '../i18n';
import { PastOverlay } from '../overlay';
import { GLOBAL_ID, type Scopes } from '../scopes';
import type { PanelConnection } from './panelConnection';
import type { StoreValues } from './storeValues';

export interface TimeTravelParts {
  scopes: Scopes;
  history: History;
  storeValues: StoreValues;
  connection: PanelConnection;
  timeline: TimelineState;
  texts(): Texts;
}

/**
 * Jumps to a past transaction and back. With an adapter that can switch
 * scopes, the app renders a forked copy of that moment and the present is
 * untouched; otherwise values are written in place and restored on return.
 */
export class TimeTravel {
  /** the present of a scope changed in place, written back on return */
  private savedPresent: { scopeId: string; values: StateSnapshot } | null = null;

  private readonly overlay: PastOverlay;

  constructor(private readonly parts: TimeTravelParts) {
    this.overlay = new PastOverlay(
      () => this.goLive(),
      () => this.setLock(false),
    );
  }

  jump(transactionId: number | null) {
    if (transactionId === null) {
      this.goLive();
      return;
    }
    const { scopes, history, storeValues, timeline } = this.parts;
    const transaction = history.get(transactionId);
    if (!transaction || transaction.synthetic) return;
    const { scopeId } = transaction;
    // the scope of this transaction was collected: writing its past in place
    // would treat `null` as the global graph and change global state instead
    if (!scopes.isAvailable(scopeId)) return;
    const values = storeValues.valuesAt(scopeId, transactionId);
    const isLast = history.last()?.id === transactionId;
    if (scopeId !== GLOBAL_ID && scopes.hasSwitcher() && scopes.get(scopeId)) {
      // the last transaction is the present itself
      if (isLast) {
        this.goLive();
        return;
      }
      this.showForkedPast(scopeId, transactionId, values);
    } else {
      this.writePastInPlace(scopeId, values);
    }
    timeline.mode = 'past';
    timeline.cursor = isLast && timeline.strategy === 'in-place' ? null : transactionId;
    if (timeline.cursor === null) timeline.mode = 'live';
    this.updateOverlay();
    this.parts.connection.sendTimeline();
    this.parts.connection.scheduleFlush();
  }

  private showForkedPast(scopeId: string, transactionId: number, values: StateSnapshot) {
    const { scopes, history, storeValues, timeline, texts } = this.parts;
    const liveScopeId = scopes.liveId || scopeId;
    const scope = storeValues.forkWith(values, scopes.get(liveScopeId));
    const name = texts().jumpScope(scopes.nameOf(scopeId), transactionId);
    const branchId = scopes.addBranch(scope, liveScopeId, transactionId, 'jump', name);
    scopes.show(branchId);
    history.setBase(branchId, new Map(values));
    timeline.strategy = 'fork';
  }

  private writePastInPlace(scopeId: string, values: StateSnapshot) {
    const { storeValues, timeline } = this.parts;
    if (!this.savedPresent || this.savedPresent.scopeId !== scopeId) {
      this.savedPresent = { scopeId, values: storeValues.valuesAt(scopeId, null) };
    }
    storeValues.writeInPlace(scopeId, values);
    timeline.strategy = 'in-place';
  }

  goLive() {
    const { scopes, storeValues, timeline, connection } = this.parts;
    if (timeline.mode === 'past') {
      if (this.savedPresent) {
        storeValues.writeInPlace(this.savedPresent.scopeId, this.savedPresent.values);
        this.savedPresent = null;
      } else if (scopes.liveId && scopes.viewId !== scopes.liveId) {
        scopes.show(scopes.liveId);
      }
    }
    timeline.mode = 'live';
    timeline.cursor = null;
    timeline.readOnlyLabel = undefined;
    this.updateOverlay();
    connection.sendTimeline();
    connection.scheduleFlush();
  }

  setLock(isLocked: boolean) {
    this.parts.timeline.locked = isLocked;
    this.updateOverlay();
    this.parts.connection.sendTimeline();
  }

  private updateOverlay() {
    const { timeline } = this.parts;
    if (timeline.mode !== 'past' || timeline.cursor === null || !timeline.locked) {
      this.overlay.hide();
      return;
    }
    const texts = this.parts.texts();
    this.overlay.show(timeline.cursor, {
      title: texts.pastTitle,
      back: texts.pastBack,
      unlock: texts.pastUnlock,
      hint: texts.pastHint,
    });
  }
}
