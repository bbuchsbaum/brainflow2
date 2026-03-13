import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayerDropdown } from '../LayerDropdown';

vi.mock('@/components/ui/shadcn/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    align: _align,
    sideOffset: _sideOffset,
    ...props
  }: {
    children: ReactNode;
    align?: string;
    sideOffset?: number;
    [key: string]: unknown;
  }) => (
    <div {...props}>{children}</div>
  ),
}));

const layers = [
  {
    id: 'layer-1',
    name: 'T1 Anatomical',
    volumeId: 'vol-1',
    type: 'anatomical' as const,
    visible: true,
    order: 0,
  },
  {
    id: 'layer-2',
    name: 'Functional Overlay',
    volumeId: 'vol-2',
    type: 'functional' as const,
    visible: false,
    order: 1,
  },
];

describe('LayerDropdown', () => {
  it('renders an empty state when there are no layers', () => {
    render(
      <LayerDropdown
        layers={[]}
        selectedLayerId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
      />
    );

    expect(screen.getByText('Layer stack empty')).toBeInTheDocument();
  });

  it('shows the selected layer label and exposes listbox semantics', () => {
    render(
      <LayerDropdown
        layers={layers}
        selectedLayerId="layer-1"
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Select active layer' })).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.getByRole('listbox', { name: 'Active layer options' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /T1 Anatomical/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects layers on click and keyboard activation', () => {
    const onSelect = vi.fn();

    render(
      <LayerDropdown
        layers={layers}
        selectedLayerId="layer-1"
        onSelect={onSelect}
        onToggleVisibility={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('option', { name: /Functional Overlay/i }));
    expect(onSelect).toHaveBeenCalledWith('layer-2');

    fireEvent.keyDown(screen.getByRole('option', { name: /T1 Anatomical/i }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('layer-1');
  });

  it('keeps metadata and visibility actions isolated from row selection', () => {
    const onSelect = vi.fn();
    const onToggleVisibility = vi.fn();
    const onShowMetadata = vi.fn();

    render(
      <LayerDropdown
        layers={layers}
        selectedLayerId="layer-1"
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onShowMetadata={onShowMetadata}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show metadata for Functional Overlay' }));
    expect(onShowMetadata).toHaveBeenCalledWith('layer-2');
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Hide T1 Anatomical' }));
    expect(onToggleVisibility).toHaveBeenCalledWith('layer-1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
