import { NODE_HEIGHT, NODE_WIDTH } from './graphGeometry';
import type { Point } from './graphTypes';

export interface EdgeGeometry {
  /** SVG path */
  path: string;
  /** where the label goes */
  labelX: number;
  labelY: number;
}

/**
 * A unit that feeds itself: a small loop off the right edge of its box. It stays
 * inside the column, which is `COLUMN_WIDTH - NODE_WIDTH` wider than the box, so
 * it never reaches the next layer and never leaves the drawing.
 */
function selfLoopGeometry(at: Point): EdgeGeometry {
  const edgeX = at.x + NODE_WIDTH;
  const middleY = at.y + NODE_HEIGHT / 2;
  const reachX = edgeX + 34;
  return {
    path: `M${edgeX} ${middleY - 6} C${reachX} ${middleY - 16} ${reachX} ${middleY + 16} ${edgeX + 2} ${middleY + 6}`,
    labelX: reachX + 4,
    labelY: middleY + 3,
  };
}

/**
 * A forward edge is a horizontal S-curve from the right side of the source to the left side of the
 * target; an edge going back (or within a layer) dips below both boxes. A unit feeding itself gets
 * a loop off its own box.
 */
export function edgeGeometry(from: Point, to: Point): EdgeGeometry {
  if (from.x === to.x && from.y === to.y) return selfLoopGeometry(from);
  if (to.x > from.x) {
    const startX = from.x + NODE_WIDTH;
    const startY = from.y + NODE_HEIGHT / 2;
    const endX = to.x - 2;
    const endY = to.y + NODE_HEIGHT / 2;
    return {
      path: `M${startX} ${startY} C${startX + 60} ${startY} ${endX - 60} ${endY} ${endX} ${endY}`,
      labelX: (startX + endX) / 2,
      labelY: (startY + endY) / 2,
    };
  }
  const startX = from.x + NODE_WIDTH / 2;
  const startY = from.y + NODE_HEIGHT;
  const endX = to.x + NODE_WIDTH / 2;
  const endY = to.y + NODE_HEIGHT + 2;
  const dipY = Math.max(startY, endY) + 30;
  return {
    path: `M${startX} ${startY} C${startX} ${dipY} ${endX} ${dipY} ${endX} ${endY}`,
    labelX: (startX + endX) / 2,
    labelY: dipY - 8,
  };
}
