import type { RawTransaction } from '../history';
import type { Texts } from '../i18n';
import { errorMessage } from '../utils';
import type { FindingCounter } from './types';
import type { UnitLabels } from './unitLabels';

export interface TransactionCheckContext {
  labels: UnitLabels;
  texts: Texts;
  /** the step limit of one transaction, for the runaway text */
  maxSteps: number;
  findings: FindingCounter;
}

type Check = (transaction: RawTransaction, context: TransactionCheckContext) => void;

const checkOutOfScope: Check = (transaction, { labels, texts, findings }) => {
  if (!transaction.flags.outOfScope) return;
  const rootId = transaction.root.id;
  const root = labels.name(rootId);
  findings.count(
    `out-of-scope:${rootId}`,
    () => ({
      level: 'error',
      code: 'out-of-scope',
      node: rootId,
      file: labels.location(rootId),
      title: texts.outOfScopeTitle(root),
      detail: texts.outOfScopeDetail(root),
      fix: texts.outOfScopeFix(root),
    }),
    transaction.id,
  );
};

const checkDoubleUpdates: Check = (transaction, { labels, texts, findings }) => {
  for (const id of transaction.flags.double || []) {
    const name = labels.name(id);
    findings.count(
      `double:${id}`,
      () => ({
        level: 'warning',
        code: 'double-update',
        node: id,
        file: labels.location(id),
        title: texts.doubleTitle(name),
        detail: texts.doubleDetail,
        fix: texts.doubleFix(name),
      }),
      transaction.id,
    );
  }
};

const checkBlockedByFilter: Check = (transaction, { labels, texts, findings }) => {
  for (const { node } of transaction.flags.blocked || []) {
    findings.count(
      `blocked:${node}`,
      () => ({
        level: 'info',
        code: 'filter-blocked',
        node,
        file: labels.location(node),
        title: texts.blockedTitle(labels.name(node)),
        detail: texts.blockedDetail,
      }),
      transaction.id,
    );
  }
};

const checkExceptions: Check = (transaction, { labels, texts, findings }) => {
  if (!transaction.flags.error) return;
  const skipped = (transaction.flags.skippedChildren || []).map((id) => labels.name(id)).join(', ');
  for (const step of transaction.steps) {
    if (!step.hasFailed) continue;
    const message = errorMessage(step.error);
    const nodeId = step.node.id;
    findings.count(
      `error:${nodeId}`,
      () => ({
        level: 'error',
        code: 'pure-error',
        node: nodeId,
        file: labels.location(nodeId),
        title: texts.errorTitle(labels.name(nodeId)),
        detail: texts.errorDetail(message) + (skipped ? ` ${texts.skippedChildren(skipped)}.` : ''),
        fix: texts.errorFix,
      }),
      transaction.id,
    );
  }
};

const checkStaleReads: Check = (transaction, { labels, texts, findings }) => {
  for (const staleRead of transaction.flags.staleReads || []) {
    const reader = labels.name(staleRead.reader);
    const store = labels.name(staleRead.store);
    findings.count(
      `stale:${staleRead.reader}>${staleRead.store}`,
      () => ({
        level: 'warning',
        code: 'stale-read',
        node: staleRead.store,
        nodes: [staleRead.reader, staleRead.store],
        file: labels.location(staleRead.reader) || labels.location(staleRead.store),
        title: texts.staleReadTitle(reader, store),
        detail: texts.staleReadDetail(store),
        fix: texts.staleReadFix(store),
      }),
      transaction.id,
    );
  }
};

const checkDerivedWrites: Check = (transaction, { labels, texts, findings }) => {
  for (const id of transaction.flags.derivedWrite || []) {
    const name = labels.name(id);
    findings.count(
      `derived-write:${id}`,
      () => ({
        level: 'warning',
        code: 'derived-write',
        node: id,
        file: labels.location(id),
        title: texts.derivedWriteTitle(name),
        detail: texts.derivedWriteDetail,
        fix: texts.derivedWriteFix(name),
      }),
      transaction.id,
    );
  }
};

const checkEffectFailure: Check = (transaction, { labels, texts, findings }) => {
  const { settle } = transaction;
  if (!settle || settle.status !== 'fail') return;
  const { id } = settle.node;
  findings.count(
    `fail:${id}`,
    () => ({
      level: 'info',
      code: 'effect-fail',
      node: id,
      file: labels.location(id),
      title: texts.failTitle(labels.name(id)),
      detail: errorMessage(settle.value),
    }),
    transaction.id,
  );
};

/**
 * More steps than `maxSteps` means the step tree was cut, not that the
 * transaction never ended: a few hundred list items with a model each, or a
 * store feeding a few hundred derived ones, reach the limit while finishing
 * perfectly well. A synchronous loop that really does not end is what the
 * emergency stop reports, with the units it was looping through.
 */
const checkRecordingLimit: Check = (transaction, { labels, texts, maxSteps, findings }) => {
  if (!transaction.flags.truncated || transaction.flags.stopped) return;
  const rootId = transaction.root.id;
  findings.count(
    `recording-limit:${rootId}`,
    () => ({
      level: 'info',
      code: 'recording-limit',
      node: rootId,
      file: labels.location(rootId),
      title: texts.limitTitle(labels.name(rootId)),
      detail: texts.limitDetail(maxSteps),
      fix: texts.limitFix,
    }),
    transaction.id,
  );
};

/** a stopped runaway repeats everything: its doubles, filters and errors are noise */
const CHECKS_OF_FINISHED_RUNS: Check[] = [
  checkDoubleUpdates,
  checkBlockedByFilter,
  checkExceptions,
  checkStaleReads,
  checkDerivedWrites,
  checkEffectFailure,
  checkRecordingLimit,
];

/** Findings of one closed transaction (skipped steps of a replay have none). */
export function checkTransaction(transaction: RawTransaction, context: TransactionCheckContext) {
  if (transaction.flags.skipped) return;
  checkOutOfScope(transaction, context);
  if (transaction.flags.stopped) return;
  for (const check of CHECKS_OF_FINISHED_RUNS) check(transaction, context);
}
