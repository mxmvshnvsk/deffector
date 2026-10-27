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
import { asInternalScope } from '../src/effector';

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

  it('drops the switcher when the adapter tears its registration down', async () => {
    const { agent, flush } = setup();
    const scope = fork();
    await allSettled(requestStarted, { scope, params: 1 });
    await flush();

    const teardown = agent.registerScope(scope, { name: 'client', switcher: () => {} });
    const { id } = agent.scopes.list().find((item) => item.name === 'client')!;
    expect(agent.scopes.hasSwitcher()).toBe(true);
    expect(agent.scopes.list().find((item) => item.id === id)!.switchable).toBe(true);
    expect(agent.timeline.strategy).toBe('fork');

    teardown();

    expect(agent.scopes.hasSwitcher()).toBe(false);
    expect(agent.scopes.list().find((item) => item.id === id)!.switchable).toBe(false);
    expect(agent.timeline.strategy).toBe('in-place');
    // the scope itself is still known: only the way to render it is gone
    expect(agent.scopes.get(id)).toBe(scope);
  });

  it('does not invent a record for a scope that was never registered', () => {
    const { agent } = setup();
    const before = agent.scopes.list().length;
    agent.scopes.unregister(asInternalScope(fork()));
    expect(agent.scopes.list().length).toBe(before);
  });

  it.runIf(collectGarbage)('releases a scope once its provider is gone', async () => {
    const { agent, flush } = setup();
    const teardowns: (() => void)[] = [];
    for (let i = 0; i < 20; i++) {
      const scope = fork();
      // a provider mounted per route: registers a switcher, then unmounts
      teardowns.push(agent.registerScope(scope, { name: `route ${i}`, switcher: () => {} }));
      await allSettled(requestStarted, { scope, params: i });
    }
    await flush();
    expect(agent.scopes.list().filter((item) => item.kind === 'scope').length).toBe(20);

    for (const teardown of teardowns) teardown();
    // the teardown closure holds the scope, the way React holds an effect's
    // cleanup while it is mounted; dropping it is what unmounting does
    teardowns.length = 0;
    collectGarbage!();
    await flush();
    collectGarbage!();
    await flush();

    // without the teardown the switcher would keep every record alive
    expect(agent.scopes.list().filter((item) => item.kind === 'scope').length).toBeLessThanOrEqual(
      2,
    );
  });
});
