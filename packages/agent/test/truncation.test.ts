import { describe, expect, it } from 'vitest';
import { allSettled, createEvent, createStore, fork, sample } from 'effector';
import { createMemoryTransportPair, decode } from '@deffector/protocol';
import { Agent } from '../src/agent';

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** `maxSteps` only makes the test short; the same holds at the default 5000. */
const MAX_STEPS = 6;
const STORES = 12;

function setup() {
  const agent = new Agent({ name: 'truncation', maxSteps: MAX_STEPS });
  const pair = createMemoryTransportPair();
  agent.connect(pair.agent);
  pair.panel.send({ type: 'connect', locale: 'en' });
  return { agent, flush: () => sleep(60) };
}

describe('a transaction cut off at maxSteps', () => {
  it('keeps the state of every store that changed past the limit', async () => {
    const { agent, flush } = setup();
    const kick = createEvent<number>({ name: 'truncKick' });
    const stores = Array.from({ length: STORES }, (_, i) =>
      createStore(0, { sid: `trunc$${i}` }).on(kick, (_current, value) => value + i),
    );
    const scope = fork();

    await allSettled(kick, { scope, params: 100 });
    await flush();
    const truncated = agent.history.transactions.at(-1)!;
    expect(truncated.flags.truncated).toBe(true);
    expect(truncated.steps.length).toBe(MAX_STEPS);
    expect(truncated.deltas.size).toBe(STORES);

    // a later transaction moves every store, so a missing delta now shows up as
    // the present value rather than the one the panel says it is showing
    await allSettled(kick, { scope, params: 900 });
    await flush();

    const scopeId = agent.scopes.list().find((item) => item.kind === 'scope')!.id;
    const atTruncated = Object.values(agent.stateValues(scopeId, truncated.id));
    expect(atTruncated).toEqual(stores.map((_, i) => 100 + i));
    expect(stores.map((store) => scope.getState(store))).toEqual(stores.map((_, i) => 900 + i));
  });

  it('records no delta for a store the kernel left alone past the limit', async () => {
    const { agent, flush } = setup();
    const kick = createEvent<number>({ name: 'sameKick' });
    // every store is written the same value twice: the second run changes nothing
    const stores = Array.from({ length: STORES }, (_, i) =>
      createStore(0, { sid: `same$${i}` }).on(kick, (_current, value) => value + i),
    );
    const scope = fork();

    await allSettled(kick, { scope, params: 100 });
    await flush();
    await allSettled(kick, { scope, params: 100 });
    await flush();

    const second = agent.history.transactions.at(-1)!;
    expect(second.flags.truncated).toBe(true);
    expect(second.deltas.size).toBe(0);
    expect(stores.map((store) => scope.getState(store))).toEqual(stores.map((_, i) => 100 + i));
  });

  it('lets a change past the limit win over an earlier one in the same transaction', async () => {
    const { agent, flush } = setup();
    const kick = createEvent<number>({ name: 'twiceKick' });
    const $twice = createStore(0, { sid: 'twice$value' }).on(kick, (_current, value) => value);
    // filler so the second write to $twice lands past the limit
    const filler = Array.from({ length: STORES }, (_, i) =>
      createStore(0, { sid: `twiceFill$${i}` }).on(kick, (_current, value) => value + i),
    );
    const relay = createEvent<number>({ name: 'twiceRelay' });
    $twice.on(relay, (_current, value) => value);
    sample({ clock: kick, fn: (value: number) => value + 1, target: relay });
    void filler;

    const scope = fork();
    await allSettled(kick, { scope, params: 100 });
    await flush();

    const truncated = agent.history.transactions.at(-1)!;
    expect(truncated.flags.truncated).toBe(true);
    const scopeId = agent.scopes.list().find((item) => item.kind === 'scope')!.id;
    const committed = scope.getState($twice);
    expect(committed).toBe(101);
    expect(truncated.deltas.get('twice$value') ?? committed).toBe(committed);

    await allSettled(kick, { scope, params: 900 });
    await flush();
    const atTruncated = agent.stateValues(scopeId, truncated.id);
    expect(Object.values(atTruncated)).toContain(101);
    expect(Object.values(atTruncated)).not.toContain(901);
  });
});

describe('a store written both before and after the limit', () => {
  const EARLY = 100;
  const LATE = 101;

  /** 0 -> EARLY under the limit -> LATE past it, in one transaction */
  async function runEarlyThenLate() {
    const { agent, flush } = setup();
    const kick = createEvent<number>({ name: 'orderKick' });
    const relay = createEvent<number>({ name: 'orderRelay' });
    const $target = createStore(0, { sid: 'order$target', name: 'orderTarget' })
      .on(kick, (_current, value) => value)
      .on(relay, (_current, value) => value);
    const filler = Array.from({ length: STORES }, (_current, i) =>
      createStore(0, { sid: `orderFill$${i}` }).on(kick, (_x, value) => value + i),
    );
    void filler;
    sample({ clock: kick, fn: (value: number) => value + 1, target: relay });

    const scope = fork();
    await allSettled(kick, { scope, params: EARLY });
    await flush();

    const transaction = agent.history.transactions.at(-1)!;
    const unit = agent.registry.allInfos().find((info) => info.sid === 'order$target')!;
    const refId = agent.registry.get(unit.id)!.stateRef!.id;
    return { agent, flush, scope, $target, transaction, unitId: unit.id, refId };
  }

  it('keeps the latest value as the delta and the earliest as the previous one', async () => {
    const { scope, $target, transaction, refId } = await runEarlyThenLate();
    expect(transaction.flags.truncated).toBe(true);
    expect(scope.getState($target)).toBe(LATE);
    expect(transaction.deltas.get(refId)).toBe(LATE);
    // 0, not EARLY: the recorded step knows what the transaction started from
    expect(transaction.previousValues.get(refId)).toBe(0);
  });

  it('keeps the real initial value in the base snapshot', async () => {
    const { agent, transaction, refId } = await runEarlyThenLate();
    expect(agent.history.baseOf(transaction.scopeId).get(refId)).toBe(0);
  });

  it('exports the real initial value in a trace', async () => {
    const { agent, transaction, unitId } = await runEarlyThenLate();
    const trace = agent.traces.export(transaction.scopeId);
    expect(decode(trace.initial[unitId])).toBe(0);
  });

  it('reconstructs the state before the transaction, and after it once evicted', async () => {
    const { agent, flush, scope, transaction, refId } = await runEarlyThenLate();
    const { scopeId } = transaction;
    // the state before a truncated transaction comes from the base snapshot
    expect(
      agent.history.valuesAt(scopeId, transaction.id - 1, [refId], () => LATE).get(refId),
    ).toBe(0);

    // push it out of the buffer: its deltas fold into the base snapshot
    agent.history.capacity = 1;
    const settle = createEvent({ name: 'orderSettle' });
    await allSettled(settle, { scope });
    await flush();
    expect(agent.history.baseOf(scopeId).get(refId)).toBe(LATE);
  });
});

describe('what Health says about a truncated transaction', () => {
  it('reports a recording limit, not a possible infinite loop', async () => {
    const { agent, flush } = setup();
    const kick = createEvent<number>({ name: 'healthKick' });
    const stores = Array.from({ length: STORES }, (_current, i) =>
      createStore(0, { sid: `health$${i}` }).on(kick, (_x, value) => value + i),
    );
    void stores;
    await allSettled(kick, { scope: fork(), params: 100 });
    await flush();

    expect(agent.history.transactions.at(-1)!.flags.truncated).toBe(true);
    const codes = agent.diagnostics.list().map((item) => item.code);
    expect(codes).toContain('recording-limit');
    expect(codes).not.toContain('cycle');

    const limit = agent.diagnostics.list().find((item) => item.code === 'recording-limit')!;
    expect(limit.level).toBe('info');
    expect(limit.detail).toContain(String(MAX_STEPS));
    // the ok item would claim no transaction passed the limit, which this one did
    expect(codes).not.toContain('ok');
  });
});
