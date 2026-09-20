import { buildOrganicLayout } from './layout-organic.mjs';

export const buildLayout = buildOrganicLayout;

export function buildRouter(layout) {
  const ids = layout.nodes.map(n => n.id);
  const size = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const adj = Array.from({ length: size }, () => []);
  for (const [a, b] of layout.edges) {
    adj[index.get(a)].push(index.get(b));
    adj[index.get(b)].push(index.get(a));
  }

  const queue = new Int32Array(size);
  const toward = ids.map((_, target) => {
    const previous = new Int32Array(size).fill(-1);
    previous[target] = target;
    let head = 0, tail = 0;
    queue[tail++] = target;
    while (head < tail) {
      const node = queue[head++];
      for (const next of adj[node]) {
        if (previous[next] !== -1) continue;
        previous[next] = node;
        queue[tail++] = next;
      }
    }
    return previous;
  });

  return {
    nodes: layout.nodes,
    node(id) {
      const value = layout.nodes[index.get(id)];
      if (!value) throw new Error(`Unknown node ${id}`);
      return value;
    },
    nearestNode(x, y) {
      let best = null, bestDistance = Infinity;
      for (const value of layout.nodes) {
        const distance = (value.x - x) ** 2 + (value.y - y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = value.id;
        }
      }
      return best;
    },
    path(fromNodeId, toNodeId) {
      const from = index.get(fromNodeId), to = index.get(toNodeId);
      if (from === undefined || to === undefined) {
        throw new Error(`Unknown node ${from === undefined ? fromNodeId : toNodeId}`);
      }
      const previous = toward[to];
      if (previous[from] === -1) throw new Error(`No path from ${fromNodeId} to ${toNodeId}`);
      const path = [fromNodeId];
      for (let node = from; node !== to;) {
        node = previous[node];
        path.push(ids[node]);
      }
      return path;
    }
  };
}
