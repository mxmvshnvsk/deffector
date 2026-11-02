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
import { GLOBAL_ID } from '../src/scopes';

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

  it('ignores a teardown for a registration that installed no switcher', () => {
    const { agent } = setup();
    const before = agent.scopes.list().length;
    agent.scopes.unregister(undefined);
    agent.scopes.unregister(9999);
    expect(agent.scopes.list().length).toBe(before);
  });

  it('keeps a newer registration when an older teardown runs', async () => {
    const { agent, flush } = setup();
    const scope = fork();
    await allSettled(requestStarted, { scope, params: 1 });
    await flush();

    const first = agent.registerScope(scope, { name: 'first', switcher: () => {} });
    agent.registerScope(scope, { name: 'second', switcher: () => {} });
    first();

    // the second registration owns a different token and must survive
    expect(agent.scopes.hasSwitcher()).toBe(true);
    expect(agent.timeline.strategy).toBe('fork');
  });

  it('invalidates the switcher copies a time-travel branch made', async () => {
    const { agent, flush } = setup();
    const scope = fork();
    await allSettled(requestStarted, { scope, params: 1 });
    await flush();
    const teardown = agent.registerScope(scope, { name: 'root', switcher: () => {} });
    const past = agent.history.transactions.at(-1)!;
    await allSettled(requestStarted, { scope, params: 2 });
    await flush();

    // the branch record copies the root's switcher
    agent.jump(past.id);
    await flush();
    expect(agent.scopes.hasSwitcher()).toBe(true);

    teardown();
    expect(agent.scopes.hasSwitcher()).toBe(false);
    expect(agent.timeline.strategy).toBe('in-place');
  });

  it.runIf(collectGarbage)(
    'refuses to act on a collected scope instead of hitting global',
    async () => {
      const { agent, flush } = setup();
      const $global = createStore(0, { sid: 'scopes$global', name: 'scopesGlobal' }).on(
        requestStarted,
        (_current, n) => n,
      );
      await allSettled(requestStarted, { scope: fork(), params: 42 });
      await flush();
      const tx = agent.history.transactions.at(-1)!;
      expect(tx.scopeId).not.toBe(GLOBAL_ID);

      collectGarbage!();
      await flush();
      collectGarbage!();
      await flush();
      expect(agent.scopes.get(tx.scopeId)).toBe(null);
      expect(agent.scopes.isAvailable(tx.scopeId)).toBe(false);
      // the global graph is always available, and is a different thing
      expect(agent.scopes.isAvailable(GLOBAL_ID)).toBe(true);

      agent.jump(tx.id);
      await flush();
      expect($global.getState()).toBe(0);

      agent.dispatch(
        tx.scopeId,
        agent.registry.allInfos().find((i) => i.sid === 'scopes$global')!.id,
        7,
      );
      await flush();
      expect($global.getState()).toBe(0);

      expect(agent.stateValues(tx.scopeId, null)).toEqual({});
    },
  );

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
