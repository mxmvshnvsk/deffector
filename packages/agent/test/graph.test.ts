import { describe, expect, it } from 'vitest';
import { allSettled, createEvent, createStore, fork, sample } from 'effector';
import { createMemoryTransportPair } from '@deffector/protocol';
import { Agent } from '../src/agent';
import { findCycles } from '../src/agent/cycles';

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function setup() {
  const agent = new Agent({ name: 'graph' });
  const pair = createMemoryTransportPair();
  agent.connect(pair.agent);
  pair.panel.send({ type: 'connect', locale: 'en' });
  return { agent, flush: () => sleep(60) };
}

describe('cycles in the unit graph', () => {
  it('finds a unit that feeds itself', async () => {
    const { agent, flush } = setup();
    const ping = createEvent<number>({ name: 'selfPing' });
    // the shortest runaway there is: an event that re-triggers itself
    sample({ clock: ping, filter: () => false, fn: (value: number) => value + 1, target: ping });
    await allSettled(ping, { scope: fork(), params: 1 });
    await flush();

    const graph = agent.graph();
    const ping6 = graph.nodes.find((node) => node.name === 'selfPing')!;
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: ping6.id, to: ping6.id, kind: 'next' }),
    );

    const cycles = findCycles(graph, () => false);
    expect(cycles).toEqual([{ ids: [ping6.id], isEventsOnly: true }]);
  });

  it('finds a cycle of two units and tells a store cycle from an events-only one', async () => {
    const { agent, flush } = setup();
    const bump = createEvent<number>({ name: 'cycleBump' });
    const $count = createStore(0, { sid: 'cycle$count', name: 'cycleCount' }).on(
      bump,
      (_, value) => value,
    );
    sample({
      clock: $count,
      filter: (value: number) => value < 2,
      fn: (value: number) => value + 1,
      target: bump,
    });
    await allSettled(bump, { scope: fork(), params: 1 });
    await flush();

    const graph = agent.graph();
    const isStore = (id: string) => graph.nodes.find((node) => node.id === id)?.kind === 'store';
    const cycles = findCycles(graph, isStore);
    const cycle = cycles.find((item) => item.ids.length === 2);
    expect(cycle).toBeDefined();
    expect(cycle!.isEventsOnly).toBe(false);
    expect(cycle!.ids.map((id) => graph.nodes.find((node) => node.id === id)!.name).sort()).toEqual(
      ['cycleBump', 'cycleCount'],
    );
  });

  it('reports no cycle for an acyclic graph', async () => {
    const { agent, flush } = setup();
    const go = createEvent<number>({ name: 'acyclicGo' });
    const $value = createStore(0, { sid: 'acyclic$value' }).on(go, (_, value) => value);
    const $doubled = $value.map((value) => value * 2);
    void $doubled;
    await allSettled(go, { scope: fork(), params: 3 });
    await flush();

    expect(findCycles(agent.graph(), () => true)).toEqual([]);
  });
});
