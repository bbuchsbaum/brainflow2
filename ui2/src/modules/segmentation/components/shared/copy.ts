/** Words the directions share, computed from the scene so they stay true. */

import { LABEL_BY_ID } from './mockData';
import { SCENE } from './scenes';

export function blockedCopy() {
  const names = SCENE.blocked.byLabel.map(([id]) => LABEL_BY_ID.get(id)?.name ?? String(id));
  const first = names[0] ?? 'a label';
  const total = SCENE.blocked.written + SCENE.blocked.blocked;
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : first;
  return {
    reason: `Stroke blocked: ${first} is locked`,
    detail: `${SCENE.blocked.written} of ${total} voxels changed`,
    explain: `Every voxel under the stroke is ${list}, which ${names.length > 1 ? 'are' : 'is'} locked. CA1 paints over unlocked labels only.`,
    action: `Unlock ${first}`,
    total,
    names,
  };
}
