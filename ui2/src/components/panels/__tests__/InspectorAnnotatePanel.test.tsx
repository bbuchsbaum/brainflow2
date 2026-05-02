import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { InspectorAnnotatePanel } from '../InspectorAnnotatePanel';
import { useLayerStore } from '@/stores/layerStore';

function resetLayerStore() {
  act(() => {
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

function seedLayer(layer: Record<string, unknown>) {
  act(() => {
    useLayerStore.setState({
      layers: [layer as never],
      selectedLayerId: (layer as { id: string }).id,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

describe('InspectorAnnotatePanel', () => {
  beforeEach(() => {
    resetLayerStore();
  });

  it('renders the Inspector|Annotate mode toggle (not a Surface|Volume|Atlas|Annotate type-tab strip)', () => {
    render(<InspectorAnnotatePanel />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Inspector', 'Annotate']);

    // Acceptance #2 guard: there must be no Surface / Volume / Atlas top-level tab.
    expect(screen.queryByRole('tab', { name: /surface/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /volume/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /atlas/i })).toBeNull();
  });

  it('starts in Inspector mode by default', () => {
    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-mode')).toBe('inspector');
    expect(
      screen.getByTestId('inspector-annotate-mode-inspector').getAttribute('data-active'),
    ).toBe('true');
    expect(
      screen.getByTestId('inspector-annotate-mode-annotate').getAttribute('data-active'),
    ).toBe('false');
  });

  it('honors `defaultMode` and switches mode on click, firing `onModeChange`', () => {
    const onModeChange = vi.fn();
    render(<InspectorAnnotatePanel defaultMode="annotate" onModeChange={onModeChange} />);

    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-mode')).toBe('annotate');

    fireEvent.click(screen.getByTestId('inspector-annotate-mode-inspector'));

    expect(onModeChange).toHaveBeenLastCalledWith('inspector');
    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-mode')).toBe('inspector');
  });

  it('renders the empty state when no layer is selected (acceptance #4)', () => {
    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-annotate-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('inspector-annotate-layer-summary')).toBeNull();
    expect(screen.queryByTestId('inspector-content-placeholder')).toBeNull();
  });

  it('shows a mode-aware empty-state message', () => {
    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-annotate-empty').textContent).toMatch(/inspect/i);

    fireEvent.click(screen.getByTestId('inspector-annotate-mode-annotate'));
    expect(screen.getByTestId('inspector-annotate-empty').textContent).toMatch(/annotat/i);
  });

  it('follows the selected layer (acceptance #1) — header and body update together', () => {
    seedLayer({
      id: 'vol-1',
      name: 'BOLD run-01',
      type: 'functional',
      timeSeriesInfo: { num_timepoints: 200 },
    });

    render(<InspectorAnnotatePanel />);

    expect(screen.queryByTestId('inspector-annotate-empty')).toBeNull();
    expect(screen.getByTestId('inspector-annotate-layer-name').textContent).toBe('BOLD run-01');
    expect(screen.getByTestId('inspector-annotate-layer-kind').textContent).toBe('Functional');
    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-layer-id')).toBe('vol-1');
    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-layer-kind')).toBe(
      'volume-4d',
    );
    expect(screen.getByTestId('inspector-content-placeholder')).toBeInTheDocument();
  });

  it('classifies an atlas layer as kind="atlas" regardless of timeSeriesInfo presence', () => {
    seedLayer({
      id: 'atlas-1',
      name: 'AAL',
      type: 'label',
      source: 'atlas',
      atlasMetadata: { id: 'aal', space: 'mni', resolution: '2mm', n_regions: 116 },
    });

    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-layer-kind')).toBe('atlas');
    expect(screen.getByTestId('inspector-annotate-layer-kind').textContent).toBe('Label');
  });

  it('classifies a 3D anatomical layer as kind="volume-3d"', () => {
    seedLayer({ id: 'vol-2', name: 'T1w', type: 'anatomical' });

    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-layer-kind')).toBe(
      'volume-3d',
    );
    expect(screen.getByTestId('inspector-annotate-layer-kind').textContent).toBe('Anatomical');
  });

  it('reactively swaps content when the active layer selection changes', () => {
    seedLayer({ id: 'vol-1', name: 'T1w', type: 'anatomical' });

    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-annotate-layer-name').textContent).toBe('T1w');

    seedLayer({ id: 'vol-2', name: 'BOLD', type: 'functional', timeSeriesInfo: { num_timepoints: 50 } });

    expect(screen.getByTestId('inspector-annotate-layer-name').textContent).toBe('BOLD');
    expect(screen.getByTestId('inspector-annotate-panel').getAttribute('data-layer-kind')).toBe('volume-4d');
  });

  it('returns to the empty state when the selection is cleared', () => {
    seedLayer({ id: 'vol-1', name: 'T1w', type: 'anatomical' });

    render(<InspectorAnnotatePanel />);

    expect(screen.queryByTestId('inspector-annotate-empty')).toBeNull();

    resetLayerStore();

    expect(screen.getByTestId('inspector-annotate-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('inspector-content-placeholder')).toBeNull();
  });

  it('renders the mode-correct content placeholder when a layer is selected (no real content sections yet — that is 6b)', () => {
    seedLayer({ id: 'vol-1', name: 'T1w', type: 'anatomical' });

    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-content-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('annotate-content-placeholder')).toBeNull();

    fireEvent.click(screen.getByTestId('inspector-annotate-mode-annotate'));

    expect(screen.getByTestId('annotate-content-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('inspector-content-placeholder')).toBeNull();
  });
});
