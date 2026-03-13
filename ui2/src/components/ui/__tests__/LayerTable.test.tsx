import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayerTable } from '@/components/ui/LayerTable';
import { LAYER_DRAG_MIME } from '@/utils/layerDrag';

const layers = [
  {
    id: 'layer-1',
    name: 'Mock Layer',
    volumeId: 'vol-1',
    type: 'anatomical' as const,
    visible: true,
    order: 0,
  },
];

describe('LayerTable', () => {
  it('publishes layer drag payloads for comparison drop targets', () => {
    render(
      <LayerTable
        layers={layers}
        selectedLayerId="layer-1"
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
      />
    );

    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(
      screen.getByRole('button', { name: 'Drag Mock Layer to comparison view' }),
      { dataTransfer }
    );

    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      LAYER_DRAG_MIME,
      JSON.stringify({ layerId: 'layer-1' })
    );
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/json',
      JSON.stringify({ layerId: 'layer-1' })
    );
  });
});
