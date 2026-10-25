import { haversine } from './geo.js';

class MinHeap {
  #items = [];

  push(item) {
    const a = this.#items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.#items.length;
  }
}

function buildResult(startId, goalId, prevNode, prevEdge, cost) {
  const nodeIds = [goalId];
  const edges = [];
  let cur = goalId;
  while (cur !== startId) {
    edges.push(prevEdge.get(cur));
    cur = prevNode.get(cur);
    nodeIds.push(cur);
  }
  nodeIds.reverse();
  edges.reverse();
  return {
    nodeIds,
    edges,
    cost,
    lengthM: edges.reduce((s, e) => s + e.lengthM, 0),
  };
}

export function astar(graph, startId, goalId, edgeCost) {
  const goal = graph.nodes.get(goalId);
  const start = graph.nodes.get(startId);
  if (!goal || !start) return null;
  if (startId === goalId) return { nodeIds: [startId], edges: [], cost: 0, lengthM: 0 };

  const g = new Map([[startId, 0]]);
  const prevNode = new Map();
  const prevEdge = new Map();
  const closed = new Set();
  const open = new MinHeap();
  open.push({ id: startId, f: haversine(start, goal) });

  while (open.size) {
    const cur = open.pop();
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);
    if (cur.id === goalId) return buildResult(startId, goalId, prevNode, prevEdge, g.get(goalId));

    for (const e of graph.adj.get(cur.id) || []) {
      const c = edgeCost(e);
      if (!Number.isFinite(c)) continue;
      const tentative = g.get(cur.id) + c;
      if (tentative < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, tentative);
        prevNode.set(e.to, cur.id);
        prevEdge.set(e.to, e);
        const n = graph.nodes.get(e.to);
        if (n) open.push({ id: e.to, f: tentative + haversine(n, goal) });
      }
    }
  }
  return null;
}
