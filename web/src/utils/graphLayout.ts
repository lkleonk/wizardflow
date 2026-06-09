import type { AgentTraceNode, AgentTraceEdge } from "@/types/agenttrace";

export type NodePosition = { x: number; y: number };

export const NODE_WIDTH = 144;
export const NODE_HEIGHT = 48;

const COLUMN_GAP = 52; // horizontal space between layers
const ROW_GAP = 28; // vertical space between nodes in the same layer

/**
 * Assign each node an (x, y) using a simple left-to-right layered layout.
 *
 * Layers come from a longest-path topological ranking: a node sits one column
 * to the right of its latest predecessor. Within a column, nodes are stacked and
 * vertically centered. If the graph has a cycle (no valid topo order), we fall
 * back to BFS distance from the entry nodes so we always return *some* layout.
 */
export function layoutGraph(
  nodes: AgentTraceNode[],
  edges: AgentTraceEdge[]
): Map<string, NodePosition> {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const level = new Map<string, number>();
  for (const id of ids) level.set(id, 0);

  // Kahn's algorithm; relax levels along edges as we pop nodes.
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const workingIndegree = new Map(indegree);
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    for (const next of outgoing.get(id)!) {
      level.set(next, Math.max(level.get(next)!, level.get(id)! + 1));
      workingIndegree.set(next, workingIndegree.get(next)! - 1);
      if (workingIndegree.get(next)! === 0) queue.push(next);
    }
  }

  // Cycle fallback: BFS distance from in-degree-0 nodes (or the first node).
  if (processed < ids.length) {
    for (const id of ids) level.set(id, 0);
    const seeds = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
    const bfs = seeds.length > 0 ? [...seeds] : ids.slice(0, 1);
    const visited = new Set(bfs);
    while (bfs.length > 0) {
      const id = bfs.shift()!;
      for (const next of outgoing.get(id)!) {
        if (visited.has(next)) continue;
        visited.add(next);
        level.set(next, level.get(id)! + 1);
        bfs.push(next);
      }
    }
  }

  // Group nodes by layer, preserving input order for stable stacking.
  const byLevel = new Map<number, string[]>();
  for (const id of ids) {
    const lvl = level.get(id)!;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(id);
  }

  const tallestColumn = Math.max(
    ...[...byLevel.values()].map((col) => col.length)
  );
  const canvasHeight = tallestColumn * (NODE_HEIGHT + ROW_GAP);

  const positions = new Map<string, NodePosition>();
  for (const [lvl, columnIds] of byLevel) {
    const columnHeight = columnIds.length * (NODE_HEIGHT + ROW_GAP);
    const top = (canvasHeight - columnHeight) / 2;
    columnIds.forEach((id, row) => {
      positions.set(id, {
        x: lvl * (NODE_WIDTH + COLUMN_GAP),
        y: top + row * (NODE_HEIGHT + ROW_GAP),
      });
    });
  }
  return positions;
}
