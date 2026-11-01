import { COLUMN_WIDTH, MARGIN, ROW_HEIGHT } from './graphGeometry';
import type { GraphViewEdge, GraphViewNode, Point } from './graphTypes';

/** Extra room below the last row for the curves of backward edges. */
const BOTTOM_PADDING = 24;
/** Visits per node the layering may spend before it stops: cycles would loop forever. */
const VISITS_PER_NODE = 8;

export interface GraphLayout {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

function pushTo<Value>(map: Map<string, Value[]>, key: string, value: Value) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/**
 * Layer of every node: the longest chain of `next` edges from a source. Cycles are cut by a visit
 * budget, and when everything is in a cycle (groups that feed each other) the biggest feeder starts.
 */
function assignLayers(
  nodes: readonly GraphViewNode[],
  outgoing: Map<string, string[]>,
  incomingCount: Map<string, number>,
): Map<string, number> {
  const layer = new Map<string, number>();
  const queue = nodes.filter((node) => !incomingCount.get(node.id)).map((node) => node.id);
  if (!queue.length && nodes.length) {
    const feederScore = (id: string) =>
      (outgoing.get(id)?.length || 0) - (incomingCount.get(id) || 0);
    queue.push(
      [...nodes].sort((left, right) => feederScore(right.id) - feederScore(left.id))[0].id,
    );
  }
  for (const id of queue) layer.set(id, 0);
  let remainingVisits = nodes.length * VISITS_PER_NODE;
  for (let head = 0; head < queue.length && remainingVisits > 0; head += 1) {
    remainingVisits -= 1;
    const id = queue[head];
    const nextLayer = layer.get(id)! + 1;
    for (const to of outgoing.get(id) || []) {
      if ((layer.get(to) ?? -1) < nextLayer && nextLayer < nodes.length) {
        layer.set(to, nextLayer);
        queue.push(to);
      }
    }
  }
  for (const node of nodes) if (!layer.has(node.id)) layer.set(node.id, 0);
  return layer;
}

/**
 * Layered left-to-right layout over `next` edges. Within a layer, nodes are ordered by the
 * barycenter of their parents, which keeps related units next to each other.
 */
export function layoutGraph(nodes: GraphViewNode[], edges: GraphViewEdge[]): GraphLayout {
  const ids = new Set(nodes.map((node) => node.id));
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== 'next' || !ids.has(edge.from) || !ids.has(edge.to)) continue;
    // a self-loop is drawn on the node itself: it neither layers nor orders it
    if (edge.from === edge.to) continue;
    incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
    pushTo(outgoing, edge.from, edge.to);
    pushTo(parents, edge.to, edge.from);
  }
  const layerOf = assignLayers(nodes, outgoing, incomingCount);
  const layers = new Map<number, GraphViewNode[]>();
  for (const node of nodes) {
    const layer = layerOf.get(node.id)!;
    const members = layers.get(layer) ?? [];
    members.push(node);
    layers.set(layer, members);
  }
  const positions = new Map<string, Point>();
  const layerNumbers = [...layers.keys()].sort((left, right) => left - right);
  for (const layer of layerNumbers) {
    const members = layers.get(layer)!;
    const barycenter = new Map<string, number>();
    for (const node of members) {
      const parentYs = (parents.get(node.id) || [])
        .map((parent) => positions.get(parent)?.y)
        .filter((y): y is number => y !== undefined);
      barycenter.set(
        node.id,
        parentYs.length ? parentYs.reduce((sum, y) => sum + y, 0) / parentYs.length : Infinity,
      );
    }
    members.sort(
      (left, right) =>
        barycenter.get(left.id)! - barycenter.get(right.id)! || left.name.localeCompare(right.name),
    );
    members.forEach((node, row) =>
      positions.set(node.id, { x: MARGIN + layer * COLUMN_WIDTH, y: MARGIN + row * ROW_HEIGHT }),
    );
  }
  const layerCount = layerNumbers.length ? layerNumbers[layerNumbers.length - 1] + 1 : 1;
  const tallestLayer = Math.max(1, ...[...layers.values()].map((members) => members.length));
  return {
    positions,
    width: MARGIN + layerCount * COLUMN_WIDTH,
    height: MARGIN + tallestLayer * ROW_HEIGHT + BOTTOM_PADDING,
  };
}
