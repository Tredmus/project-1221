/**
 * Dijkstra's shortest-path algorithm over the node connection graph.
 *
 * Designed to run on the client (after connections are loaded once) as
 * well as on the server (for authoritative cost verification in Server
 * Actions before spending AP).
 *
 * The node graph is undirected but each connection is stored once:
 * (node_a_id, node_b_id). This function treats every edge as traversable
 * in both directions.
 *
 * Time complexity: O(E · log V) with the min-heap below. For the MVP map
 * size (hundreds of nodes) this is effectively instant. When the graph
 * grows to thousands of nodes, the heap already handles it gracefully.
 *
 * Travel tiers:
 *   A connection with min_tier_required = 2 is skipped for a character
 *   whose travel_tier = 1. Pass the character's travel_tier to respect
 *   this gate. Defaults to 1 (no premium roads excluded).
 */

export interface PathResult {
  /** Ordered list of node ids from start to end, inclusive. Empty when not reachable. */
  path: number[];
  /** Sum of travel_cost along each edge in the path. 0 when start === end. */
  totalCost: number;
  reachable: boolean;
}

export interface ConnectionInput {
  node_a_id: number;
  node_b_id: number;
  travel_cost: number;
  min_tier_required: number;
}

interface Edge {
  to: number;
  cost: number;
}

/**
 * Minimal binary min-heap keyed on the first element of a [cost, nodeId] pair.
 * Avoids the O(E log E) penalty of Array.sort on every push in a naive PQ.
 */
class MinHeap {
  private data: [number, number][] = [];

  push(item: [number, number]) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }

  pop(): [number, number] | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() {
    return this.data.length;
  }

  private _bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent][0] <= this.data[i][0]) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }

  private _sinkDown(i: number) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.data[l][0] < this.data[smallest][0]) smallest = l;
      if (r < n && this.data[r][0] < this.data[smallest][0]) smallest = r;
      if (smallest === i) break;
      [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
      i = smallest;
    }
  }
}

export function dijkstra(
  connections: ReadonlyArray<ConnectionInput>,
  startId: number,
  endId: number,
  travelTier = 1,
): PathResult {
  if (startId === endId) {
    return { path: [startId], totalCost: 0, reachable: true };
  }

  // Build adjacency list (each connection is undirected).
  const adj = new Map<number, Edge[]>();
  for (const c of connections) {
    if (c.min_tier_required > travelTier) continue;
    if (!adj.has(c.node_a_id)) adj.set(c.node_a_id, []);
    if (!adj.has(c.node_b_id)) adj.set(c.node_b_id, []);
    adj.get(c.node_a_id)!.push({ to: c.node_b_id, cost: c.travel_cost });
    adj.get(c.node_b_id)!.push({ to: c.node_a_id, cost: c.travel_cost });
  }

  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new MinHeap();

  dist.set(startId, 0);
  heap.push([0, startId]);

  while (heap.size > 0) {
    const [cost, u] = heap.pop()!;
    if (u === endId) break;
    if (cost > (dist.get(u) ?? Infinity)) continue;

    for (const { to, cost: edgeCost } of adj.get(u) ?? []) {
      const newCost = cost + edgeCost;
      if (newCost < (dist.get(to) ?? Infinity)) {
        dist.set(to, newCost);
        prev.set(to, u);
        heap.push([newCost, to]);
      }
    }
  }

  if (!dist.has(endId)) {
    return { path: [], totalCost: Infinity, reachable: false };
  }

  // Reconstruct path by walking backwards through prev.
  const path: number[] = [];
  let cursor: number | undefined = endId;
  while (cursor !== undefined) {
    path.unshift(cursor);
    cursor = prev.get(cursor);
  }

  return { path, totalCost: dist.get(endId)!, reachable: true };
}

/**
 * Returns a Set of canonical edge keys `"a-b"` (smaller id first) for the
 * edges that lie on a given path. Useful for highlighting in SVG.
 */
export function pathEdgeSet(path: number[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const a = Math.min(path[i], path[i + 1]);
    const b = Math.max(path[i], path[i + 1]);
    s.add(`${a}-${b}`);
  }
  return s;
}
