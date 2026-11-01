import type { GraphEdge, GraphNode } from '@deffector/protocol';
import type { Node } from '../effector';
import type { Registry, UnitRecord } from '../registry';

export interface UnitGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function factoryLabel(record: UnitRecord): string | undefined {
  const { factory } = record.info;
  if (!factory) return undefined;
  const name = factory.name || factory.method || 'factory';
  if (!factory.file) return name;
  return `${name} · ${factory.file}${factory.line ? `:${factory.line}` : ''}`;
}

function graphNodeOf(record: UnitRecord): GraphNode {
  const { info } = record;
  return {
    id: info.id,
    kind: info.kind,
    name: info.name,
    derived: info.derived,
    internal: false,
    file: info.file,
    factory: factoryLabel(record),
    domain: info.domain,
    model: info.model,
  };
}

/**
 * Edges without duplicates. Self-loops are kept: a unit that feeds itself is the
 * shortest runaway there is, and `findCycles` recognises it only if the edge is
 * here. Collapsed groups drop their own `from === to` edges in `collapseGroups`.
 */
class EdgeList {
  readonly edges: GraphEdge[] = [];

  private readonly keys = new Set<string>();

  add(from: string, to: string, kind: GraphEdge['kind'], via?: string) {
    const key = `${from}>${to}${kind}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.edges.push({ from, to, kind, via });
  }
}

/** `next` edges: walk operator nodes between units, unit → op* → unit, naming the operators passed. */
function addNextEdges(registry: Registry, nodes: Map<string, GraphNode>, edges: EdgeList) {
  const isVisibleUnit = (node: Node) =>
    registry.units.has(node.id) && !registry.units.get(node.id)!.info.internal;
  for (const record of registry.units.values()) {
    if (!nodes.has(record.info.id)) continue;
    const pending: { node: Node; via: string[] }[] = record.node.next.map((node) => ({
      node,
      via: [],
    }));
    const visited = new Set<Node>();
    while (pending.length) {
      const { node, via } = pending.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      if (isVisibleUnit(node)) {
        edges.add(record.info.id, node.id, 'next', via.join(' → ') || undefined);
        continue;
      }
      if (registry.units.has(node.id)) continue;
      const op = node.meta && node.meta.op;
      for (const next of node.next || [])
        pending.push({ node: next, via: op ? [...via, op] : via });
    }
  }
}

/** `read` edges: operator steps that read a store state (sample source, combine). */
function addReadEdges(registry: Registry, nodes: Map<string, GraphNode>, edges: EdgeList) {
  const ownerByStateRef = new Map<string, string>();
  for (const record of registry.units.values()) {
    if (record.stateRef) ownerByStateRef.set(record.stateRef.id, record.info.id);
  }
  for (const record of registry.units.values()) {
    for (const link of record.node.family?.links || []) {
      const op = link.meta && link.meta.op;
      if (!op || registry.units.has(link.id)) continue;
      for (const operation of link.seq || []) {
        const { data } = operation;
        if (operation.type !== 'mov' || !data || data.from !== 'store' || !data.store) continue;
        const source = ownerByStateRef.get(data.store.id);
        if (!source) continue;
        for (const target of link.next || []) {
          if (nodes.has(source) && nodes.has(target.id)) edges.add(source, target.id, 'read', op);
        }
      }
    }
  }
}

/** The unit graph for the Graph tab: user units and the edges between them. */
export function buildGraph(registry: Registry): UnitGraph {
  registry.fillLocations();
  const nodes = new Map<string, GraphNode>();
  for (const record of registry.units.values()) {
    if (record.info.internal || record.info.kind === 'domain') continue;
    nodes.set(record.info.id, graphNodeOf(record));
  }
  const edges = new EdgeList();
  addNextEdges(registry, nodes, edges);
  addReadEdges(registry, nodes, edges);
  return { nodes: [...nodes.values()], edges: edges.edges };
}
