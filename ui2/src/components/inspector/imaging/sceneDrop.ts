/** A Scene row's vertical extent (client px). */
export interface SceneRowExtent {
  id: string;
  top: number;
  bottom: number;
}

/**
 * The row a dragged row lands on when its centre is let go at `y`: the row
 * containing `y`, else the nearest one (above the first row → the first,
 * below the last → the last). Null with no rows.
 */
export function dropTargetAtY(rows: readonly SceneRowExtent[], y: number): string | null {
  let best: SceneRowExtent | null = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    if (y >= row.top && y <= row.bottom) return row.id;
    const distance = Math.min(Math.abs(y - row.top), Math.abs(y - row.bottom));
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}

/**
 * The drop target for a row let go at `point`, or null when the point is
 * outside the list (the drag is cancelled, not turned into a reorder).
 */
export function dropTargetInList(
  rows: readonly SceneRowExtent[],
  list: { left: number; right: number; top: number; bottom: number },
  point: { x: number; y: number },
): string | null {
  const inside =
    point.x >= list.left && point.x <= list.right && point.y >= list.top && point.y <= list.bottom;
  return inside ? dropTargetAtY(rows, point.y) : null;
}
