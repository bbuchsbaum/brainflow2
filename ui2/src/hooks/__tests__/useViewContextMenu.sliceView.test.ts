import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { fitView } = vi.hoisted(() => ({ fitView: vi.fn(async () => {}) }));
vi.mock('@/services/ViewZoomService', () => ({ fitView }));

import { useViewContextMenu } from '../useViewContextMenu';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';

const open = (contextId: string) => {
  const { result } = renderHook(() => useViewContextMenu(contextId));
  result.current({ preventDefault() {}, stopPropagation() {}, clientX: 5, clientY: 5 } as React.MouseEvent<HTMLDivElement>);
  return useContextMenuStore.getState().items;
};

describe('slice view context menu (QA features 2026-10-31 §1–2)', () => {
  it('offers Fit and the display convention on a slice view', () => {
    const items = open('axial');
    items.find((item) => item.id === 'fit-view')!.onClick!();
    expect(fitView).toHaveBeenCalledWith('axial');
    const toggle = items.find((item) => item.id === 'toggle-radiological')!;
    expect(toggle.label).toBe('Use radiological convention');
    toggle.onClick!();
    expect(useViewDisplaySettingsStore.getState().radiological).toBe(true);
    expect(open('coronal').find((item) => item.id === 'toggle-radiological')!.label).toBe('Use neurological convention');
    useViewDisplaySettingsStore.getState().setRadiological(false);
  });

  it('not on other renderables', () => {
    const ids = open('surface-view').map((item) => item.id);
    expect(ids).not.toContain('fit-view');
    expect(ids).not.toContain('toggle-radiological');
  });
});
