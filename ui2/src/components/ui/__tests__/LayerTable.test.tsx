import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayerTable } from '../LayerTable';

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PointerSensor: class PointerSensorMock {},
  KeyboardSensor: class KeyboardSensorMock {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  closestCenter: vi.fn(),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  arrayMove: (items: unknown[], from: number, to: number) => {
    const copy = [...items];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  },
  sortableKeyboardCoordinates: vi.fn(),
}));

const baseLayer = {
  id: 'layer-1',
  name: 'Schaefer 100 parcels',
  volumeId: 'vol-1',
  type: 'label' as const,
  visible: true,
  order: 0,
  source: 'atlas' as const,
  layerType: 'volume' as const,
  opacity: 0.8,
};

describe('LayerTable', () => {
  it('renders metadata and exposes quick action buttons', () => {
    const onSelect = vi.fn();
    const onToggleVisibility = vi.fn();
    const onRemove = vi.fn();

    render(
      <LayerTable
        layers={[baseLayer]}
        selectedLayerId="layer-1"
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onRemove={onRemove}
      />
    );

    expect(screen.getByRole('option')).toBeInTheDocument();
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('Source: Atlas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide Schaefer 100 parcels/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove Schaefer 100 parcels/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Layer actions for Schaefer 100 parcels/i })).toBeInTheDocument();
  });

  it('supports keyboard navigation and visibility toggle from listbox', () => {
    const onSelect = vi.fn();
    const onToggleVisibility = vi.fn();
    const onRemove = vi.fn();
    const layers = [
      baseLayer,
      {
        ...baseLayer,
        id: 'layer-2',
        name: 'AAL Atlas',
        volumeId: 'vol-2',
        order: 1,
      },
    ];

    render(
      <LayerTable
        layers={layers}
        selectedLayerId="layer-1"
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onRemove={onRemove}
      />
    );

    const listbox = screen.getByRole('listbox', { name: 'Layer list' });
    expect(listbox).toHaveAttribute('aria-activedescendant', 'layer-option-layer-1');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('layer-2');

    fireEvent.keyDown(listbox, { key: ' ' });
    expect(onToggleVisibility).toHaveBeenCalledWith('layer-1');

    const callsBefore = onSelect.mock.calls.length;
    fireEvent.keyDown(listbox, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledTimes(callsBefore);
  });

  it('calls remove callback from row action', () => {
    const onSelect = vi.fn();
    const onToggleVisibility = vi.fn();
    const onRemove = vi.fn();

    render(
      <LayerTable
        layers={[baseLayer]}
        selectedLayerId="layer-1"
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onRemove={onRemove}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Remove Schaefer 100 parcels/i }));
    expect(onRemove).toHaveBeenCalledWith('layer-1');
  });
});
