/**
 * The derived-write check only has something to find on effector 22, which
 * deprecated writing into a `map`/`combine` store. These tests pin both halves:
 * that effector 23 really does reject the write (the reason the check is gated),
 * and that the detector still works for the versions that allow it.
 */
import { describe, expect, it } from 'vitest';
import { allSettled, createEvent, createStore, fork, sample } from 'effector';
import { createMemoryTransportPair } from '@deffector/protocol';
import { Agent } from '../src/agent';
import { allowsDerivedStoreWrites, effectorVersion, type Node } from '../src/effector';
import { findDerivedWrites } from '../src/collector/glitches';
import type { RawStep, RawTransaction } from '../src/history';

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function setup() {
  const agent = new Agent({ name: 'derived' });
  const pair = createMemoryTransportPair();
  agent.connect(pair.agent);
  pair.panel.send({ type: 'connect', locale: 'en' });
  return { agent, flush: () => sleep(60) };
}

const step = (over: Partial<RawStep> & Pick<RawStep, 'index' | 'node' | 'op'>): RawStep => ({
  lane: 'pure',
  parentIndex: null,
  value: undefined,
  hasPreviousValue: false,
  hasFailed: false,
  childCount: 1,
  isInternal: false,
  isStore: false,
  isWritable: false,
  ...over,
});

describe('writing to a derived store', () => {
  it('is rejected by this effector, which is why the check is gated', () => {
    const fired = createEvent();
    const $source = createStore(0, { name: 'derivedSource' });
    const $derived = $source.map((value) => value + 1);

    // both forms throw at declaration time on effector 23. Its types reject them
    // as well, so the casts are what lets the runtime behaviour be asserted here
    const writeWithSample = () =>
      (sample as (config: unknown) => unknown)({ clock: fired, fn: () => 42, target: $derived });
    const writeWithOn = () =>
      ($derived as unknown as { on: (unit: unknown, reducer: unknown) => void }).on(fired, () => 7);

    expect(writeWithSample).toThrow(/derived/);
    expect(writeWithOn).toThrow(/derived/);

    // so the gate is closed here, and these tests describe effector 23
    expect(effectorVersion.startsWith('23.')).toBe(true);
    expect(allowsDerivedStoreWrites).toBe(false);
  });

  it('is not reported while the gate is closed', async () => {
    const { agent, flush } = setup();
    const bumped = createEvent<number>({ name: 'derivedBumped' });
    const $value = createStore(0, { sid: 'derived$value' }).on(bumped, (_current, n) => n);
    const $doubled = $value.map((value) => value * 2);
    void $doubled;

    await allSettled(bumped, { scope: fork(), params: 3 });
    await flush();

    expect(agent.history.transactions.at(-1)!.flags.derivedWrite).toBe(undefined);
    expect(agent.diagnostics.list().map((item) => item.code)).not.toContain('derived-write');
  });

  /**
   * The graph shape cannot be built on effector 23, so the detector is exercised
   * directly: this is the only coverage the effector 22 path can have here.
   */
  it('is still detected from a transaction that has the shape', async () => {
    const { agent, flush } = setup();
    const fired = createEvent({ name: 'shapeFired' });
    const $source = createStore(0, { sid: 'shape$source', name: 'shapeSource' }).on(
      fired,
      (current) => current + 1,
    );
    const $derived = $source.map((value) => value + 1);
    await allSettled(fired, { scope: fork() });
    await flush();

    const derivedNode = ($derived as unknown as { graphite: Node }).graphite;
    const derivedRecord = agent.registry.units.get(derivedNode.id)!;
    expect(derivedRecord.info.derived).toBe(true);

    const transaction = {
      steps: [
        step({ index: 0, node: derivedNode, op: 'sample' }),
        step({ index: 1, node: derivedNode, op: 'store', parentIndex: 0, isStore: true }),
      ],
    } as unknown as RawTransaction;

    expect(findDerivedWrites(transaction, agent.registry)).toEqual([derivedRecord.info.id]);
  });

  it('ignores a derived store recomputed by its own map', async () => {
    const { agent, flush } = setup();
    const fired = createEvent({ name: 'ownFired' });
    const $source = createStore(0, { sid: 'own$source', name: 'ownSource' }).on(
      fired,
      (current) => current + 1,
    );
    const $derived = $source.map((value) => value + 1);
    await allSettled(fired, { scope: fork() });
    await flush();

    const derivedNode = ($derived as unknown as { graphite: Node }).graphite;
    const transaction = {
      steps: [
        step({ index: 0, node: derivedNode, op: 'map' }),
        step({ index: 1, node: derivedNode, op: 'store', parentIndex: 0, isStore: true }),
      ],
    } as unknown as RawTransaction;

    expect(findDerivedWrites(transaction, agent.registry)).toEqual([]);
  });
});
