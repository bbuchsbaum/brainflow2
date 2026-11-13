import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { studioSetMaps } from '@/services/studio/studioMaps';
import type { StudioFeatureSummary } from '@/types/studio';

// Round 2 stream ζ: map identity in the header (A5), popovers (A12) and the
// simpler lens model (B5).
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => ({ reviewOpenedFolder: vi.fn() }),
}));
vi.mock('../LensCanvas', () => ({ LensCanvas: () => null }));
vi.mock('../PopulationProbePanel', () => ({ PopulationProbePanel: () => null }));
vi.mock('../StudioStrip', () => ({ StudioStrip: () => null }));
vi.mock('../StudioTimeRow', () => ({ StudioTimeRow: () => null }));
vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => ({ getTemplateCatalog: async () => [] }),
}));

import { StudioCenterPane } from '../StudioCenterPane';
import { StudioPopover } from '../StudioToolbarSlot';
import { StudioLensSwitcher } from '../StudioLensSwitcher';

const MAPS = ['same_item', 'same_run', 'temporal_dist'].map((name) => `enc_rep/maps/${name}.nii.gz`);

/** The demo set, with three maps per member as enc_rep_rsa has. */
function useThreeMaps(units?: string) {
  act(() => {
    const state = useSetStudioStore.getState();
    const set = state.sets[state.selection.activeSetId!];
    const features: Record<string, StudioFeatureSummary> = { ...state.features };
    for (const id of MAPS) features[id] = { id, label: id, kind: 'volume', ...(units ? { units } : {}) };
    useSetStudioStore.setState({
      features,
      sets: {
        ...state.sets,
        [set.id]: {
          ...set,
          primaryFeatureId: MAPS[0],
          memberSummaries: set.memberSummaries.map((member) => ({
            ...member,
            bindings: MAPS.map((id, index) => ({
              role: id,
              featureId: id,
              sourceLocator: null,
              sourcePath: `/data/${member.id}/${id}`,
              relativePath: null,
              selector: null,
              supportKind: 'volume' as const,
              supportLabel: null,
              availability: 'available' as const,
              isPrimary: index === 0,
            })),
          })),
        },
      },
      selection: { ...state.selection, activeFeatureId: MAPS[0], activeLens: 'population' },
    });
  });
}

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
afterEach(cleanup);

const row1 = () => screen.getByTestId('studio-toolbar-row-1');

describe('A5 map identity', () => {
  it('lists a set\'s maps by their short names, primary first', () => {
    useThreeMaps('r');
    const state = useSetStudioStore.getState();
    const maps = studioSetMaps(state.sets[state.selection.activeSetId!], state.features);
    expect(maps.map((map) => map.short)).toEqual(['same_item', 'same_run', 'temporal_dist']);
    expect(maps.every((map) => map.units === 'r')).toBe(true);
    expect(studioSetMaps(null, state.features)).toEqual([]);
  });

  it('names the shown map after the set name, and switching it switches Population\'s feature', () => {
    useThreeMaps();
    render(<StudioCenterPane />);
    const select = within(row1()).getByRole('combobox', { name: 'Map' });
    const name = within(row1()).getByTestId('studio-set-name');
    expect(name.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'same_item',
      'same_run',
      'temporal_dist',
    ]);
    expect(select).toHaveValue(MAPS[0]);
    fireEvent.change(select, { target: { value: MAPS[2] } });
    expect(useSetStudioStore.getState().selection.activeFeatureId).toBe(MAPS[2]);
    expect(within(row1()).getByRole('combobox', { name: 'Map' })).toHaveValue(MAPS[2]);
    // The dataset ⓘ lists the maps and marks the shown one.
    const list = within(row1()).getByTestId('studio-set-maps');
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'same_item',
      'same_run',
      'temporal_dist · shown',
    ]);
  });

  it('ignores a feature the set does not have, and names a single map without a select', () => {
    useThreeMaps();
    act(() => useSetStudioStore.getState().setActiveFeature('not-a-map'));
    expect(useSetStudioStore.getState().selection.activeFeatureId).toBe(MAPS[0]);
    // The demo set has one map: its name, no select.
    act(() => {
      useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
      useSetStudioStore.getState().loadDemoSession();
      useSetStudioStore.getState().setActiveLens('population');
    });
    render(<StudioCenterPane />);
    expect(within(row1()).queryByRole('combobox', { name: 'Map' })).toBeNull();
    expect(within(row1()).getByTestId('studio-map-name')).toHaveTextContent('Stat Map');
  });

  it('is shown only in Population (Deck and Subject vs mean show the member\'s own image)', () => {
    useThreeMaps();
    act(() => useSetStudioStore.getState().setActiveLens('compare'));
    render(<StudioCenterPane />);
    expect(within(row1()).queryByRole('combobox', { name: 'Map' })).toBeNull();
  });
});

describe('A12 popovers', () => {
  it('close on a press outside them as well as on Escape, and stay open for presses inside', () => {
    render(
      <div>
        <button type="button">elsewhere</button>
        <StudioPopover label="Colour scale" summary="scale">
          <button type="button">inside</button>
        </StudioPopover>
      </div>,
    );
    const details = screen.getByTitle('Colour scale').closest('details')!;
    const open = () => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    };
    open();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'inside' }));
    expect(details.open).toBe(true);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(details.open).toBe(false);
    open();
    fireEvent.keyDown(screen.getByRole('button', { name: 'inside' }), { key: 'Escape' });
    expect(details.open).toBe(false);
  });
});

describe('B5 lenses', () => {
  const switcher = (activeLens: 'population' | 'deck' | 'compare', onSelectLens = vi.fn()) =>
    render(
      <StudioLensSwitcher
        activeLens={activeLens}
        onSelectLens={onSelectLens}
        compareCohort={null}
        cohorts={[]}
        onSelectCompareCohort={() => {}}
      />,
    );

  it('offers Population and Subject vs mean; an open subject shows as a third, selected segment', () => {
    switcher('population');
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Population',
      'Subject vs mean',
    ]);
    cleanup();
    const onSelectLens = vi.fn();
    switcher('deck', onSelectLens);
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Population',
      'Subject vs mean',
      'Subject',
    ]);
    expect(screen.getByRole('radio', { name: 'Subject' })).toBeChecked();
    // The way back.
    fireEvent.click(screen.getByRole('radio', { name: 'Population' }));
    expect(onSelectLens).toHaveBeenCalledWith('population');
  });
});
