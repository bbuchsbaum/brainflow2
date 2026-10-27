import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SceneItem } from '@/types/sceneItem';

vi.mock('@/components/panels/SurfaceGeometryControls', () => ({
  SurfaceGeometryControls: () => <div>controls</div>,
}));
vi.mock('@/hooks/useResolvedActiveSurfaceViewId', () => ({
  useResolvedActiveSurfaceViewId: () => null,
}));

import { GeometrySection } from '../GeometrySection';

describe('GeometrySection: Surface settings popover', () => {
  it('opens a dialog named "Surface settings"', async () => {
    const item = {
      id: 's1',
      kind: 'surface-geometry',
      group: 'surface',
      name: 'lh.pial',
      subtitle: 'surface geometry',
      visible: true,
      opacity: 1,
      ref: { type: 'surface-geometry', surfaceId: 's1' },
    } as SceneItem;
    render(<GeometrySection item={item} />);
    fireEvent.click(screen.getByRole('button', { name: /Surface settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Surface settings' });
    expect(dialog).toHaveTextContent('controls');
  });
});
