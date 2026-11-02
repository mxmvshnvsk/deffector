/**
 * A server forks a scope per request, so the agent must not keep one base
 * snapshot of writable store values per request it has ever seen. The snapshot
 * is what makes a retained transaction reconstruct, so it may only go once no
 * transaction of that scope is left.
 */
import { describe, expect, it } from 'vitest';
import { allSettled, createEvent, createStore, fork } from 'effector';
import { createMemoryTransportPair } from '@deffector/protocol';
import { Agent } from '../src/agent';

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const requestStarted = createEvent<number>({ name: 'baseStarted' });
const $payload = createStore<unknown>(null, { sid: 'base$payload' }).on(
  requestStarted,
  (_current, n) => ({ n, rows: new Array(50).fill(n) }),
);

function setup(maxTransactions: number) {
  const agent = new Agent({ name: 'base', maxTransactions });
  const pair = createMemoryTransportPair();
  agent.connect(pair.agent);
  pair.panel.send({ type: 'connect', locale: 'en' });
  return { agent, flush: () => sleep(60) };
}

/** base snapshots the agent is holding, by scope id */
const bases = (agent: Agent) =>
  (agent.history as unknown as { baseSnapshots: Map<string, unknown> }).baseSnapshots;

const baseCount = (agent: Agent) => bases(agent).size;

describe('base snapshots of scopes that are done', () => {
  it('does not keep one per request', async () => {
    const { agent, flush } = setup(2);
    for (let i = 0; i < 20; i += 1) {
      await allSettled(requestStarted, { scope: fork(), params: i });
    }
    await flush();

    // one per scope that still has a retained transaction, plus the live one
    expect(agent.history.transactions.length).toBeLessThanOrEqual(2);
    expect(baseCount(agent)).toBeLessThanOrEqual(3);
  });

  it('keeps the base while a transaction of that scope is retained', async () => {
    const { agent, flush } = setup(5);
    const scope = fork();
    await allSettled(requestStarted, { scope, params: 7 });
    await flush();

    const transaction = agent.history.transactions.at(-1)!;
    const refId = agent.registry.get(
      agent.registry.allInfos().find((info) => info.sid === 'base$payload')!.id,
    )!.stateRef!.id;

    expect(agent.history.hasTransactionsOf(transaction.scopeId)).toBe(true);
    expect(agent.history.forgetBaseOf(transaction.scopeId)).toBe(false);
    // the state before it still reconstructs
    expect(
      agent.history
        .valuesAt(transaction.scopeId, transaction.id - 1, [refId], () => 'current')
        .get(refId),
    ).toBe(null);
  });

  it('keeps the live scope its base even with nothing retained', async () => {
    const { agent, flush } = setup(1);
    const live = fork();
    agent.registerScope(live, { name: 'client', switcher: () => {} });
    await allSettled(requestStarted, { scope: live, params: 1 });
    await flush();
    const liveId = agent.scopes.liveId!;
    expect(bases(agent).has(liveId)).toBe(true);

    // other scopes push the live scope's only transaction out of the buffer
    await allSettled(requestStarted, { scope: fork(), params: 2 });
    await allSettled(requestStarted, { scope: fork(), params: 3 });
    await flush();

    expect(agent.history.hasTransactionsOf(liveId)).toBe(false);
    // revert and a trace export still ask the live scope for the state before
    // the oldest retained transaction, so Recording spares it
    expect(bases(agent).has(liveId)).toBe(true);
  });

  it('forgets the base of an abandoned time-travel branch', async () => {
    const { agent, flush } = setup(10);
    const scope = fork();
    agent.registerScope(scope, { name: 'client', switcher: () => {} });
    await allSettled(requestStarted, { scope, params: 1 });
    await allSettled(requestStarted, { scope, params: 2 });
    await flush();

    const past = agent.history.transactions[0];
    agent.jump(past.id);
    await flush();
    const branchId = agent.scopes.viewId!;
    expect(branchId).not.toBe(agent.scopes.liveId);
    expect(bases(agent).has(branchId)).toBe(true);

    agent.jump(null);
    await flush();
    expect(bases(agent).has(branchId)).toBe(false);
  });
});
