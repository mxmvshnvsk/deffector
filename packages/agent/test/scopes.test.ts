/**
 * The agent must not keep a scope alive. A server forks one per request, so a
 * strong reference here would retain that request's whole state for the life of
 * the process. The release itself can only be observed with `--expose-gc`:
 * `node --expose-gc ./node_modules/.bin/vitest run packages/agent/test/scopes.test.ts`
 */
import { describe, expect, it } from 'vitest';
import { allSettled, createEvent, createStore, fork } from 'effector';
import { createMemoryTransportPair } from '@deffector/protocol';
import { Agent } from '../src/agent';

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const collectGarbage = (globalThis as { gc?: () => void }).gc;

function setup() {
  const agent = new Agent({ name: 'scopes' });
  const pair = createMemoryTransportPair();
  agent.connect(pair.agent);
  pair.panel.send({ type: 'connect', locale: 'en' });
  return { agent, flush: () => sleep(60) };
}

const requestStarted = createEvent<number>({ name: 'requestStarted' });
const $request = createStore<unknown>(null, { sid: 'scopes$request' }).on(
  requestStarted,
  (_, n) => ({ n, payload: new Array(1000).fill(n) }),
);

describe('scope records', () => {
  it('reads a live scope through its weak box', async () => {
    const { agent, flush } = setup();
    const scope = fork();
    await allSettled(requestStarted, { scope, params: 1 });
    await flush();

    const info = agent.scopes.list().find((item) => item.kind === 'scope')!;
    expect(agent.scopes.get(info.id)).toBe(scope);
    expect(agent.scopes.knownScopes().map(({ scope: known }) => known)).toContain(scope);
    expect(agent.scopes.get('nope')).toBe(null);
    expect($request.getState()).toBe(null);
  });

  it('keeps a scope the app still holds', async () => {
    const { agent, flush } = setup();
    const kept = fork();
    for (let i = 0; i < 20; i++) {
      await allSettled(requestStarted, { scope: kept, params: i });
    }
    await flush();
    collectGarbage?.();
    await flush();

    expect(agent.scopes.knownScopes().map(({ scope }) => scope)).toContain(kept);
  });

  it.runIf(collectGarbage)('releases the scopes of finished requests', async () => {
    const { agent, flush } = setup();
    const requests = 50;
    for (let i = 0; i < requests; i++) {
      // the scope goes out of reach as soon as the request is served
      await allSettled(requestStarted, { scope: fork(), params: i });
    }
    await flush();
    const atPeak = agent.scopes.list().filter((item) => item.kind === 'scope').length;
    expect(atPeak).toBe(requests);

    collectGarbage!();
    await flush();
    collectGarbage!();
    await flush();

    const afterCollection = agent.scopes.list().filter((item) => item.kind === 'scope').length;
    // the first scope seen becomes the live one and is held on purpose; the rest must go
    expect(afterCollection).toBeLessThanOrEqual(2);
  });
});
