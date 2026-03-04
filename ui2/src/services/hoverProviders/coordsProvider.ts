/**
 * Coordinates Provider
 *
 * Provides world coordinate information on hover.
 */

import type { HoverInfoProvider, HoverInfoEntry, HoverContext } from '@/types/hoverInfo';

export const coordsProvider: HoverInfoProvider = {
  id: 'coords',
  displayName: 'Coordinates',
  priority: 10, // Show coordinates first

  async getInfo(ctx: HoverContext): Promise<HoverInfoEntry[]> {
    const [x, y, z] = ctx.worldCoord;

    return [
      {
        label: 'World',
        value: `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} mm`,
        priority: 10,
        group: 'coords',
      },
    ];
  },
};
