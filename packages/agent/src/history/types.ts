import type { Lane, StepStatus, Tx, TxCause, TxFlags } from '@deffector/protocol';
import type { Node } from '../effector';

/** One kernel step as the collector recorded it (the panel gets it encoded as `Step`). */
export interface RawStep {
  index: number;
  node: Node;
  op: string;
  lane: Lane;
  parentIndex: number | null;
  value: unknown;
  previousValue?: unknown;
  hasPreviousValue: boolean;
  hasFailed: boolean;
  error?: unknown;
  childCount: number;
  isInternal: boolean;
  /** the fxID of the effect call this step starts */
  effectCallId?: string;
  status?: StepStatus;
  note?: string;
  isStore: boolean;
  isWritable: boolean;
  stateRefId?: string;
  /** the kernel said the branch stopped here (effector with upstream PR 2) */
  kernelSkipped?: boolean;
}

export interface RecordedEffectCall {
  effectCallId: string;
  node: Node;
  params: unknown;
}

/** How an effect call ended: recorded by the transaction its `finally` started. */
export interface EffectSettle {
  effectCallId: string;
  node: Node;
  status: 'done' | 'fail';
  value: unknown;
  durationMs: number | null;
}

export interface RawTransaction {
  id: number;
  /** ms since the agent started */
  time: number;
  startedAt: number;
  endedAt: number;
  scopeId: string;
  root: Node;
  steps: RawStep[];
  isOpen: boolean;
  cause?: TxCause;
  /** the transaction that was running when this root started: it is nested if that one goes on */
  nestingCandidate?: RawTransaction;
  effectCalls: RecordedEffectCall[];
  settle?: EffectSettle;
  flags: TxFlags;
  note?: string;
  /** writable store ref id → value after this transaction */
  deltas: Map<string, unknown>;
  /**
   * Deltas found past `maxSteps`, where a store cannot be judged changed by its
   * children because they were never recorded. Merged over `deltas` after the
   * step statuses settle, so a late change wins over an earlier recorded one.
   */
  lateDeltas?: Map<string, unknown>;
  /** writable store ref id → value before the first change in this transaction */
  previousValues: Map<string, unknown>;
  payload: unknown;
  /** what the panel got, until something in the transaction changes */
  encoded?: Tx;
  /** for synthetic transactions (skipped steps of a replay) */
  synthetic?: { unitId: string; op: string; text: string };
  /** trace step this transaction replays */
  replayOf?: number;
}
