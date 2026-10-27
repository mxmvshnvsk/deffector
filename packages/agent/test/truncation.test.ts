import { describe, expect, it } from 'vitest';
import { allSettled, createEvent, createStore, fork, sample } from 'effector';
import { createMemoryTransportPair } from '@deffector/protocol';
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
