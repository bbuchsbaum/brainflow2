import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  MONTAGE_SELECT_SETTLE_MS,
  MontageToolbar,
  type MontageToolbarProps,
} from '../MontageToolbar';
import { MontageFooter } from '../MontageFooter';
import { MontageSelectionBar, type MontageSelectionBarProps } from '../MontageSelectionBar';
import { PopulationMontage } from '../PopulationMontage';
import {
  montageGroupOptions,
  montageSortOptions,
  montageToolbarLayout,
  presetTilesPerRow,
} from '../montageModel';
import {
  POPULATION_HIDDEN_FRACTION,
  populationColorbarGradient,
} from '@/services/studio/PopulationSliceService';

afterEach(() => {
  cleanup();
  delete (window.navigator as { platform?: string }).platform;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function toolbarProps(overrides: Partial<MontageToolbarProps> = {}): MontageToolbarProps {
  return {
    sort: 'source',
    sortOptions: montageSortOptions({ columns: ['age'], crosshairAvailable: true }),
    onSort: vi.fn(),
    reversed: false,
    onReverse: vi.fn(),
    group: 'none',
    groupOptions: montageGroupOptions(['site'], null),
    onGroup: vi.fn(),
    orientation: 'axial',
    onOrientation: vi.fn(),
    slice: 'z −8.5 mm',
    canStep: true,
    onStep: vi.fn(),
    tilesPerRow: 5,
    tilesRange: { min: 2, max: 9 },
    onTilesPerRow: vi.fn(),
    gridWidth: 726,
    ...overrides,
  };
}

function toolbar(overrides: Partial<MontageToolbarProps> = {}) {
  const props = toolbarProps(overrides);
  render(<MontageToolbar {...props} />);
  return props;
}

it('is one named row: Sort, Group, Slice with a stepper, and a tiles-per-row slider', () => {
  const props = toolbar();
  const row = screen.getByRole('group', { name: 'Montage' });
  const sort = within(row).getByRole('combobox', { name: 'Sort' });
  expect([...sort.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    'Source order',
    'Similarity · correlation',
    'Similarity · amplitude',
    'Distance from mean',
    'Value at pin',
    // C′ (row 46): the witnesses are a Sort option.
    'Value at pin, 12 sampled',
    'age',
  ]);
  // Each option carries its one-line explanation.
  expect(within(sort).getByRole('option', { name: 'Similarity · correlation' })).toHaveAttribute(
    'title',
    'Neighbours are the most alike. Correlation distance of raw values (amplitude ignored), whole volume or mask, unthresholded',
  );
  fireEvent.change(sort, { target: { value: 'similarity:pattern-shape' } });
  expect(props.onSort).toHaveBeenCalledWith('similarity:pattern-shape');
  // Reversal is a toggle beside Sort, not an option that snaps back.
  const reverse = within(row).getByRole('button', { name: 'Reverse order' });
  expect(reverse).toHaveAttribute('aria-pressed', 'false');
  // C5: clear of the Sort select's chevron.
  expect(reverse.className).toMatch(/\bml-1\b/);
  fireEvent.click(reverse);
  expect(props.onReverse).toHaveBeenCalledTimes(1);
  expect(props.onSort).toHaveBeenCalledTimes(1);

  const group = within(row).getByRole('combobox', { name: 'Group' });
  expect([...group.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    'None',
    'Similarity · correlation',
    'Similarity · amplitude',
    'site',
    // C5: no "Restore previous grouping" while there is nothing to restore.
  ]);
  fireEvent.change(group, { target: { value: 'factor:site' } });
  expect(props.onGroup).toHaveBeenCalledWith('factor:site');

  fireEvent.change(within(row).getByRole('combobox', { name: 'Slice' }), {
    target: { value: 'coronal' },
  });
  expect(props.onOrientation).toHaveBeenCalledWith('coronal');
  expect(within(row).getByText('z −8.5 mm')).toHaveClass('font-mono');
  fireEvent.click(within(row).getByRole('button', { name: 'Previous slice' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Next slice' }));
  expect(vi.mocked(props.onStep).mock.calls).toEqual([[-1], [1]]);

  // Whole tiles per row: one step is one more tile across.
  const size = within(row).getByRole('slider', { name: 'Tiles per row' });
  expect(size).toHaveAttribute('aria-valuemin', '2');
  expect(size).toHaveAttribute('aria-valuemax', '9');
  expect(size).toHaveAttribute('aria-valuenow', '5');
  fireEvent.keyDown(size, { key: 'ArrowRight' });
  expect(props.onTilesPerRow).toHaveBeenCalledWith(6);
  // The row never wraps, and no icons flank the size control.
  expect(row.className).toContain('flex-nowrap');
  expect(row.querySelectorAll('svg.lucide-grid-2x2, svg.lucide-square')).toHaveLength(0);
});

/** Lay the toolbar out: `content[level]` px of content in a row `row.width` px wide. */
function measureToolbar(content: number[], row: { width: number }) {
  const isToolbar = (element: Element) => element.getAttribute('aria-label') === 'Montage';
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return isToolbar(this) ? content[Number((this as HTMLElement).dataset.level)] : 0;
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return isToolbar(this) ? row.width : 0;
  });
}

it('steps its layout down while its content does not fit, by measurement', () => {
  const row = () => screen.getByRole('group', { name: 'Montage' });
  // Short names in a 750 px pane (726 px row): only the word "Slice" has to go.
  measureToolbar([760, 720, 660, 600, 540, 470], { width: 726 });
  toolbar();
  expect(row().dataset.level).toBe('1');
  expect(row().dataset.layout).toBe('field-words slider');
  expect(screen.getByRole('combobox', { name: 'Slice' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Tiles per row' })).toBeInTheDocument();
  // Nothing clips: the row has no hidden overflow to cut its last control off.
  expect(row().className).not.toContain('overflow-hidden');
  cleanup();
  vi.restoreAllMocks();

  // Narrower: the other words go, then the slider becomes S / M / L.
  measureToolbar([760, 720, 660, 600, 540, 470], { width: 610 });
  const narrow = toolbar();
  expect(row().dataset.level).toBe('3');
  expect(screen.getByRole('combobox', { name: 'Sort' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Group' })).toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Tiles per row' })).toBeNull();
  const sizes = screen.getByRole('radiogroup', { name: 'Tile size' });
  expect(within(sizes).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['S', 'M', 'L']);
  expect(within(sizes).getByRole('radio', { name: 'Medium tiles' })).toBeChecked();
  fireEvent.click(within(sizes).getByRole('radio', { name: 'Large tiles' }));
  expect(narrow.onTilesPerRow).toHaveBeenCalledWith(presetTilesPerRow('L', 726));
});

it('long column names at 750 px never clip the tile-size control: it moves into a menu', () => {
  // Two 176 px selects: even the narrowest row layout is wider than the pane.
  const row = { width: 726 };
  const content = [1100, 1060, 980, 920, 860, 700];
  measureToolbar(content, row);
  const props = toolbar({
    sort: 'column:a_very_long_design_column_name',
    sortOptions: montageSortOptions({
      columns: ['a_very_long_design_column_name'],
      crosshairAvailable: true,
    }),
  });
  const bar = screen.getByRole('group', { name: 'Montage' });
  expect(bar.dataset.level).toBe('5');
  expect(bar.dataset.layout).toBe('menu compact-selects');
  // The sizes are in a menu on the row: present, operable, not cut off.
  const menu = within(bar).getByTitle('Tile size').closest('details')!;
  fireEvent.click(within(menu).getByRole('radio', { name: 'Small tiles' }));
  expect(props.onTilesPerRow).toHaveBeenCalledWith(presetTilesPerRow('S', 726));
  // At the narrowest Sort and Group take a fixed width and truncate inside
  // their own box; Sort keeps room for "Value at pin". Neither the select nor
  // its field ever shrinks under its neighbour.
  const sort = screen.getByRole('combobox', { name: 'Sort' });
  expect(sort.className).toMatch(/\bw-28\b/);
  expect(sort.className).toMatch(/\btruncate\b/);
  expect(sort.className).toMatch(/\bshrink-0\b/);
  expect(screen.getByRole('combobox', { name: 'Group' }).className).toMatch(/\bw-32\b/);
  expect(sort.closest('[data-toolbar-segment]')!.className).toMatch(/\bshrink-0\b/);
  // The slice readout stays at the narrowest step.
  expect(screen.getByTestId('montage-slice-readout')).toHaveTextContent('z −8.5 mm');
  expect(screen.getByTestId('montage-slice-readout')).not.toHaveClass('sr-only');
  // With room again (another sort, shorter content) it climbs back to the full row.
  content.splice(0, content.length, 700, 660, 600, 540, 480, 420);
  cleanup();
  toolbar();
  expect(screen.getByRole('group', { name: 'Montage' }).dataset.level).toBe('0');
  expect(screen.getByRole('slider', { name: 'Tiles per row' })).toBeInTheDocument();
});

it('re-measures when the slice readout, orientation or summary choices change, not only Sort and Group', () => {
  const content = [800, 760, 700, 640, 580, 520];
  measureToolbar(content, { width: 726 });
  const props = toolbarProps();
  const { rerender } = render(<MontageToolbar {...props} />);
  const bar = () => screen.getByRole('group', { name: 'Montage' });
  expect(bar().dataset.level).toBe('2');
  // The content now fits at the full layout (e.g. a shorter readout): a new
  // orientation starts over from the full row.
  content.splice(0, content.length, 700, 660, 600, 540, 480, 420);
  rerender(<MontageToolbar {...props} orientation="coronal" slice="y 4 mm" />);
  expect(bar().dataset.level).toBe('0');
  // A longer readout no longer fits: it steps down again.
  content.splice(0, content.length, 800, 760, 700, 640, 580, 520);
  rerender(<MontageToolbar {...props} orientation="coronal" slice="y −104.5 mm" />);
  expect(bar().dataset.level).toBe('2');
});

it('the summary row re-measures when its Show or Zoom choice changes', () => {
  const isToolbar = (element: Element) => element.getAttribute('aria-label') === 'Summary';
  const content = [800, 760, 700, 640, 580, 520];
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return isToolbar(this) ? content[Number((this as HTMLElement).dataset.level)] : 0;
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return isToolbar(this) ? 726 : 0;
  });
  const choice = (value: string) => ({
    label: 'Zoom',
    value,
    options: [
      { value: '1', label: '1×', description: '' },
      { value: '2', label: 'A much longer zoom label', description: '' },
    ],
    onChange: vi.fn(),
  });
  const props = toolbarProps({ mode: 'summary', zoom: choice('2') });
  const { rerender } = render(<MontageToolbar {...props} />);
  const bar = () => screen.getByRole('group', { name: 'Summary' });
  expect(bar().dataset.level).toBe('2');
  content.splice(0, content.length, 700, 660, 600, 540, 480, 420);
  rerender(<MontageToolbar {...props} zoom={choice('1')} />);
  expect(bar().dataset.level).toBe('0');
});

it('shows a spinner beside the control whose choice is being computed', () => {
  toolbar({ group: 'similarity:pattern-shape', groupBusy: true });
  expect(screen.getByRole('img', { name: 'Computing the groups' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Computing the order' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Group' })).toHaveAttribute('aria-busy', 'true');
});

it('stepping through Sort with the keyboard acts only on the option it settles on', () => {
  vi.useFakeTimers();
  const props = toolbar();
  const sort = screen.getByRole('combobox', { name: 'Sort' });
  // Arrow down through the closed select: both similarities, Distance, Value at crosshair.
  for (const value of ['similarity:pattern-shape', 'similarity:effect', 'distance', 'crosshair']) {
    fireEvent.keyDown(sort, { key: 'ArrowDown' });
    fireEvent.change(sort, { target: { value } });
  }
  // The select shows where the keys are; nothing has started.
  expect(sort).toHaveValue('crosshair');
  expect(props.onSort).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(MONTAGE_SELECT_SETTLE_MS);
  });
  expect(vi.mocked(props.onSort).mock.calls).toEqual([['crosshair']]);

  // Enter and leaving the field act at once; arriving back where it began acts on nothing.
  vi.mocked(props.onSort).mockClear();
  fireEvent.keyDown(sort, { key: 'ArrowUp' });
  fireEvent.change(sort, { target: { value: 'distance' } });
  fireEvent.keyDown(sort, { key: 'Enter' });
  expect(vi.mocked(props.onSort).mock.calls).toEqual([['distance']]);
  fireEvent.keyDown(sort, { key: 'ArrowUp' });
  fireEvent.change(sort, { target: { value: 'similarity:effect' } });
  fireEvent.keyDown(sort, { key: 'ArrowUp' });
  fireEvent.change(sort, { target: { value: 'similarity:pattern-shape' } });
  fireEvent.keyDown(sort, { key: 'ArrowUp' });
  fireEvent.change(sort, { target: { value: 'source' } });
  fireEvent.blur(sort);
  act(() => {
    vi.advanceTimersByTime(MONTAGE_SELECT_SETTLE_MS);
  });
  expect(vi.mocked(props.onSort).mock.calls).toEqual([['distance']]);

  // The same holds for Group, whose Similarity starts a fit.
  const group = screen.getByRole('combobox', { name: 'Group' });
  fireEvent.keyDown(group, { key: 'ArrowDown' });
  fireEvent.change(group, { target: { value: 'similarity:pattern-shape' } });
  fireEvent.keyDown(group, { key: 'ArrowDown' });
  fireEvent.change(group, { target: { value: 'similarity:effect' } });
  fireEvent.keyDown(group, { key: 'ArrowDown' });
  fireEvent.change(group, { target: { value: 'factor:site' } });
  expect(props.onGroup).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(MONTAGE_SELECT_SETTLE_MS);
  });
  expect(vi.mocked(props.onGroup).mock.calls).toEqual([['factor:site']]);
  // A choice made with the pointer is acted on at once.
  fireEvent.pointerDown(group);
  fireEvent.change(group, { target: { value: 'none' } });
  expect(props.onGroup).toHaveBeenLastCalledWith('none');
});

it('a settling keyboard choice compares against the latest value, not the one it began with', () => {
  vi.useFakeTimers();
  const props = toolbarProps();
  const { rerender } = render(<MontageToolbar {...props} />);
  const sort = screen.getByRole('combobox', { name: 'Sort' });
  fireEvent.keyDown(sort, { key: 'ArrowDown' });
  fireEvent.change(sort, { target: { value: 'distance' } });
  // The order arrives from elsewhere while the keyboard choice is settling.
  rerender(<MontageToolbar {...props} sort="distance" />);
  act(() => {
    vi.advanceTimersByTime(MONTAGE_SELECT_SETTLE_MS);
  });
  expect(props.onSort).not.toHaveBeenCalled();
  // And a settled choice away from the new value still acts.
  fireEvent.keyDown(sort, { key: 'ArrowDown' });
  fireEvent.change(sort, { target: { value: 'crosshair' } });
  act(() => {
    vi.advanceTimersByTime(MONTAGE_SELECT_SETTLE_MS);
  });
  expect(vi.mocked(props.onSort).mock.calls).toEqual([['crosshair']]);
});

it('shows a reversed order as a pressed toggle', () => {
  toolbar({ reversed: true });
  expect(screen.getByRole('button', { name: 'Reverse order' })).toHaveAttribute('aria-pressed', 'true');
});

it('marks a pending order as busy and disables the stepper without a slice', () => {
  toolbar({ sort: 'similarity:pattern-shape', sortBusy: true, canStep: false });
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: 'Next slice' })).toBeDisabled();
});

it('footer: editing either limit sets the shared scale, and the bar is the renderer\'s own ramp', () => {
  const onLimit = vi.fn(),
    onFit = vi.fn();
  render(
    <MontageFooter
      description="35 of 35 subjects · source order"
      limit={0.0219876}
      onLimit={onLimit}
      onFit={onFit}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('35 of 35 subjects · source order');
  const upper = screen.getByRole('spinbutton', { name: 'Upper limit' });
  const lower = screen.getByRole('spinbutton', { name: 'Lower limit' });
  expect(upper).toHaveValue(0.022);
  expect(lower).toHaveValue(-0.022);
  fireEvent.change(upper, { target: { value: '0.5' } });
  expect(onLimit).toHaveBeenLastCalledWith(0.5);
  // The lower end is the same symmetric limit, given as a magnitude.
  fireEvent.change(lower, { target: { value: '-0.25' } });
  expect(onLimit).toHaveBeenLastCalledWith(0.25);
  // Nothing invalid reaches the scale.
  fireEvent.change(upper, { target: { value: '0' } });
  fireEvent.change(upper, { target: { value: '' } });
  expect(onLimit).toHaveBeenCalledTimes(2);

  const bar = screen.getByTestId('montage-scale-bar');
  expect(bar.style.backgroundImage).toBe(
    populationColorbarGradient(true, POPULATION_HIDDEN_FRACTION, 'to right'),
  );
  expect(bar.style.backgroundImage).toContain('to right');
  // The legend is a picture; fitting is a real button, the same for mouse and keyboard.
  expect(bar).toHaveAttribute('role', 'img');
  expect(bar).not.toHaveAttribute('tabindex');
  const fit = screen.getByRole('button', { name: 'Fit scale to the data' });
  fireEvent.click(fit);
  expect(onFit).toHaveBeenCalledTimes(1);
});

it('footer: shows the hovered value without announcing it, an error as an alert, and pages', () => {
  const onPage = vi.fn();
  const { rerender } = render(
    <MontageFooter
      description="80 of 120 subjects · source order"
      hover="sub-01  0.5"
      limit={null}
      onLimit={vi.fn()}
      page={{ page: 1, count: 2, onPage }}
    />,
  );
  // The value under the pointer is shown but never announced: the live region keeps the state.
  expect(screen.getByTestId('montage-footer-text')).toHaveTextContent('sub-01 0.5');
  expect(screen.getByTestId('montage-footer-text')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('80 of 120 subjects · source order');
  expect(screen.getByRole('status')).not.toHaveTextContent('sub-01');
  expect(screen.getByRole('spinbutton', { name: 'Upper limit' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Fit scale to the data' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(onPage).toHaveBeenCalledWith(2);
  rerender(
    <MontageFooter
      description="x"
      error="These maps have no single direction to order along."
      limit={1}
      onLimit={vi.fn()}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('no single direction');
});

it('selection segment: absent with nothing selected, and each action is wired', () => {
  const actions = {
    onSaveGroup: vi.fn(),
    onCompareRest: vi.fn(),
    onClear: vi.fn(),
  };
  const { rerender } = render(<MontageSelectionBar count={0} {...actions} />);
  expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
  rerender(<MontageSelectionBar count={3} {...actions} />);
  const bar = screen.getByRole('group', { name: 'Selection' });
  expect(within(bar).getByRole('status')).toHaveTextContent('3 selected');
  // "Save as group…" names the group in place: prefilled, Enter saves, Escape cancels.
  fireEvent.click(within(bar).getByRole('button', { name: 'Save as group…' }));
  const name = within(bar).getByRole('textbox', { name: 'Group name' });
  expect(name).toHaveValue('3 subjects');
  fireEvent.keyDown(name, { key: 'Escape' });
  expect(within(bar).queryByRole('textbox', { name: 'Group name' })).toBeNull();
  expect(actions.onSaveGroup).not.toHaveBeenCalled();
  expect(actions.onClear).not.toHaveBeenCalled();
  fireEvent.click(within(bar).getByRole('button', { name: 'Save as group…' }));
  fireEvent.change(within(bar).getByRole('textbox', { name: 'Group name' }), {
    target: { value: 'One observer' },
  });
  fireEvent.submit(within(bar).getByRole('textbox', { name: 'Group name' }).closest('form')!);
  expect(actions.onSaveGroup).toHaveBeenCalledWith('One observer');
  fireEvent.click(within(bar).getByRole('button', { name: 'Compare with the rest' }));
  // C′: Open in Deck lives in the Inspector's focused block, not on the bar.
  expect(within(bar).queryByRole('button', { name: 'Open in Deck' })).toBeNull();
  fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
  Object.values(actions).forEach((action) => expect(action).toHaveBeenCalledTimes(1));
  // Escape from the bar clears the selection too.
  fireEvent.keyDown(within(bar).getByRole('button', { name: 'Save as group…' }), { key: 'Escape' });
  expect(actions.onClear).toHaveBeenCalledTimes(2);
  // With no one left to compare against, the comparison is not offered.
  rerender(<MontageSelectionBar count={3} {...actions} onCompareRest={undefined} />);
  expect(screen.getByRole('button', { name: 'Compare with the rest' })).toBeDisabled();
  rerender(<MontageSelectionBar count={0} {...actions} />);
  expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
});

function montage(selection: Partial<MontageSelectionBarProps> | null) {
  return (
    <PopulationMontage
      display={null}
      mirrorX={false}
      ids={['sub-01', 'sub-02']}
      groups={null}
      columns={2}
      onWidth={vi.fn()}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
      onClearSelection={vi.fn()}
      footer={{ description: '', limit: 1, onLimit: vi.fn() }}
      emptyText=""
      height={400}
      selection={
        selection
          ? { count: 0, onSaveGroup: vi.fn(), onCompareRest: vi.fn(), onClear: vi.fn(), ...selection }
          : null
      }
    />
  );
}

it('the selection has a line of its own above the tiles, never on the toolbar row (A7)', () => {
  // The toolbar row has no selection segment at all: a selection never costs
  // Sort, Group or Slice their room.
  render(<MontageToolbar {...toolbarProps()} />);
  expect(
    within(screen.getByRole('group', { name: 'Montage' })).queryByRole('group', { name: 'Selection' }),
  ).toBeNull();
  cleanup();

  const { rerender } = render(montage({ count: 8 }));
  const region = screen.getByRole('region', { name: 'Montage of subjects' });
  const line = screen.getByTestId('montage-selection-line');
  const segment = within(line).getByRole('group', { name: 'Selection' });
  // "8 selected · Save as group… · Compare with the rest · ✕", in the montage's own flow.
  expect(segment).toHaveTextContent(/8 selected\s*·\s*Save as group…\s*·\s*Compare with the rest/);
  expect(within(segment).getByRole('button', { name: 'Clear selection' })).toBeInTheDocument();
  expect(`${line.className} ${segment.className}`).not.toMatch(/\b(absolute|fixed)\b|shadow-|-translate-/);
  expect(line.className).toMatch(/\bshrink-0\b/);
  // Above the tiles, below the progress hairline, inside the montage.
  const tilesArea = screen.getByTestId('montage-tiles-area');
  expect(region.contains(line)).toBe(true);
  expect(line.compareDocumentPosition(tilesArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Nothing selected: the same line says how to select (so selecting never
  // moves the tiles), in the words of the gestures that exist.
  // (On a Mac: the command key is named ⌘.)
  Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
  rerender(montage({ count: 0 }));
  expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
  expect(screen.getByTestId('montage-selection-line')).toBe(line);
  expect(screen.getByTestId('montage-selection-hint')).toHaveTextContent(
    'Click to focus · Shift- or ⌘-click to select · drag across tiles to select several · Esc clears',
  );
  // Without selection actions (another owner) there is no line.
  rerender(montage(null));
  expect(screen.queryByTestId('montage-selection-line')).toBeNull();
});

it('no control is ever drawn over another: at every step each control keeps its own width', () => {
  const content = [1100, 1060, 980, 920, 860, 700];
  for (let level = 0; level <= 5; level++) {
    // Content that fits only once the row reaches `level`.
    measureToolbar(
      content.map((_, at) => (at < level ? 2000 : 600)),
      { width: 726 },
    );
    toolbar({ group: 'similarity:pattern-shape', groupCount: { value: 2, max: 6, onChange: vi.fn() } });
    const row = screen.getByRole('group', { name: 'Montage' });
    expect(row.dataset.level).toBe(String(level));
    // Every group of controls and every control in it refuses to shrink, so a
    // row that does not fit is wider than its box (measured, and stepped
    // down) rather than squeezed into overprinting: the Sort text over the
    // reverse toggle, the Group select cut to "r · 2…".
    for (const segment of row.querySelectorAll<HTMLElement>('[data-toolbar-segment]')) {
      expect(segment.className).toMatch(/\bshrink-0\b/);
      expect(segment.className).not.toMatch(/\bmin-w-0\b/);
      for (const control of segment.querySelectorAll<HTMLElement>('select, button')) {
        expect(control.className).toMatch(/\bshrink-0\b/);
        // The field around a select (label + select) does not shrink either.
        if (control.tagName === 'SELECT') expect(control.parentElement!.className).toMatch(/\bshrink-0\b/);
      }
    }
    // The reverse toggle follows the Sort select, never inside or over it.
    const sort = within(row).getByRole('combobox', { name: 'Sort' });
    const reverse = within(row).getByRole('button', { name: 'Reverse order' });
    expect(sort.contains(reverse)).toBe(false);
    expect(sort.compareDocumentPosition(reverse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Field words leave as a whole (screen-reader only), never half-drawn.
    const words = [...row.querySelectorAll('label')].filter((label) =>
      ['Sort', 'Group'].includes(label.textContent ?? ''),
    );
    for (const word of words)
      expect(word.parentElement!.className.includes('[&>label]:sr-only')).toBe(level >= 2);
    // The slice readout always shows its value, in tabular figures and a fixed minimum width.
    const readout = screen.getByTestId('montage-slice-readout');
    expect(readout).toHaveTextContent('z −8.5 mm');
    expect(readout.className).toMatch(/\bmin-w-\[11ch\]/);
    expect(readout.className).toMatch(/\btabular-nums\b/);
    expect(readout.className).not.toMatch(/\bsr-only\b/);
    cleanup();
    vi.restoreAllMocks();
  }
});

it('the stripped ID prefix is said once, quietly, on the footer and never in the toolbar (C5)', () => {
  render(<MontageToolbar {...toolbarProps()} />);
  expect(screen.queryByTestId('montage-id-prefix')).toBeNull();
  cleanup();
  const { rerender } = render(
    <MontageFooter description="35 subjects" limit={1} onLimit={vi.fn()} idPrefix="sub-" />,
  );
  const prefix = within(screen.getByTestId('montage-footer')).getByTestId('montage-id-prefix');
  expect(prefix).toHaveTextContent('IDs without “sub-”');
  expect(prefix.className).toMatch(/\btext-bf-text-muted\b/);
  expect(prefix.className).toMatch(/\bwhitespace-nowrap\b/);
  expect(prefix.className).toMatch(/\bshrink-0\b/);
  rerender(<MontageFooter description="35 subjects" limit={1} onLimit={vi.fn()} />);
  expect(screen.queryByTestId('montage-id-prefix')).toBeNull();
});

it('grouped by similarity, the closed Group select reads "r · 2 groups" (C5)', () => {
  toolbar({
    group: 'similarity:pattern-shape',
    groupCount: { value: 2, max: 8, onChange: vi.fn() },
  });
  const group = screen.getByRole('combobox', { name: 'Group' }) as HTMLSelectElement;
  expect(group.selectedOptions[0].textContent).toBe('r · 2 groups');
  expect(group.title).toMatch(/Correlation distance/);
});

it('footer: a slider sets the symmetric limit, previewing while it moves and applying on release', () => {
  const onLimit = vi.fn();
  render(
    <MontageFooter
      description="35 of 35 subjects · source order"
      limit={2}
      dataLimit={4}
      onLimit={onLimit}
      onFit={vi.fn()}
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Colour scale limit' });
  // From a two-hundredth of the data's largest magnitude up to it.
  expect(slider).toHaveAttribute('aria-valuemax', '4');
  expect(Number(slider.getAttribute('aria-valuemin'))).toBeCloseTo(0.02);
  expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(2);
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  // The numbers follow the slider at once; the maps are redrawn on release.
  expect(screen.getByRole('spinbutton', { name: 'Upper limit' })).toHaveValue(2.02);
  expect(screen.getByRole('spinbutton', { name: 'Lower limit' })).toHaveValue(-2.02);
  fireEvent.keyUp(slider, { key: 'ArrowRight' });
  expect(onLimit).toHaveBeenCalledTimes(1);
  expect(onLimit.mock.calls[0][0]).toBeCloseTo(2.02);
  // The number fields and Fit remain.
  expect(screen.getByRole('button', { name: 'Fit scale to the data' })).toBeEnabled();
});

it('footer: a calculation in progress is said first, with Cancel, and announced as the state', () => {
  const onCancel = vi.fn();
  render(
    <MontageFooter
      description="35 of 35 subjects · source order"
      busy={{ text: 'Computing similarity for 35 subjects…', onCancel }}
      limit={1}
      onLimit={vi.fn()}
    />,
  );
  expect(screen.getByTestId('montage-footer-busy')).toHaveTextContent(
    'Computing similarity for 35 subjects…',
  );
  expect(screen.getByRole('status')).toHaveTextContent('Computing similarity for 35 subjects…');
  expect(screen.queryByTestId('montage-footer-text')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('footer: the slider keeps the released value until the redrawn maps carry it', () => {
  const onLimit = vi.fn();
  const footer = (limit: number | null, scaleIdentity = 'set:image') => (
    <MontageFooter
      description="x"
      limit={limit}
      dataLimit={4}
      scaleIdentity={scaleIdentity}
      onLimit={onLimit}
    />
  );
  const { rerender } = render(footer(2));
  const slider = () => screen.getByRole('slider', { name: 'Colour scale limit' });
  const upper = () => screen.getByRole('spinbutton', { name: 'Upper limit' });
  fireEvent.keyDown(slider(), { key: 'ArrowRight' });
  fireEvent.keyUp(slider(), { key: 'ArrowRight' });
  expect(onLimit).toHaveBeenCalledTimes(1);
  // Released, with the old result still displayed: no snap back to 2.
  expect(upper()).toHaveValue(2.02);
  expect(Number(slider().getAttribute('aria-valuenow'))).toBeCloseTo(2.02);
  rerender(footer(2));
  expect(upper()).toHaveValue(2.02);
  // The redrawn result arrives with the new limit: the footer shows the result again.
  rerender(footer(2.02));
  rerender(footer(3));
  expect(upper()).toHaveValue(3);

  // A set switched mid-drag does not leave the old value stuck on the new set's scale.
  fireEvent.keyDown(slider(), { key: 'ArrowRight' });
  expect(upper()).not.toHaveValue(3);
  rerender(footer(3, 'other-set:image'));
  expect(upper()).toHaveValue(3);
  // Nor does a result that goes away.
  fireEvent.keyDown(slider(), { key: 'ArrowRight' });
  fireEvent.keyUp(slider(), { key: 'ArrowRight' });
  rerender(footer(null, 'other-set:image'));
  expect(upper()).toHaveValue(null);
  rerender(footer(1, 'other-set:image'));
  expect(upper()).toHaveValue(1);
});

it('folds the group count into the Group select: its label says it, its menu sets it', () => {
  const onChange = vi.fn(),
    onGroup = vi.fn();
  toolbar({
    group: 'similarity:pattern-shape',
    onGroup,
    groupCount: { value: 3, max: 6, onChange, suggested: 2 },
  });
  // No separate number field: the closed select reads "r · 3 groups" (C5).
  expect(screen.queryByRole('spinbutton', { name: 'Number of similarity groups' })).toBeNull();
  const group = screen.getByRole('combobox', { name: 'Group' });
  const selected = [...group.querySelectorAll('option')].find((o) => o.selected)!;
  expect(selected.textContent).toBe('r · 3 groups');
  // The counts are choices inside the menu, right under the similarity it cuts.
  const counts = group.querySelector('optgroup[label="Number of groups"]')!;
  expect([...counts.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    '2 groups · suggested',
    '✓ 3 groups',
    '4 groups',
    '5 groups',
    '6 groups',
  ]);
  expect(counts.previousElementSibling).toBe(selected);
  fireEvent.pointerDown(group);
  fireEvent.change(group, { target: { value: 'count:4' } });
  expect(onChange).toHaveBeenCalledWith(4);
  expect(onGroup).not.toHaveBeenCalled();
  // The select stays on the grouping it was.
  expect(group).toHaveValue('similarity:pattern-shape');
  cleanup();
  toolbar({ group: 'factor:site', groupCount: null });
  const plain = screen.getByRole('combobox', { name: 'Group' });
  expect(plain.querySelector('optgroup[label="Number of groups"]')).toBeNull();
  expect([...plain.querySelectorAll('option')].find((o) => o.selected)!.textContent).toBe('site');
});

it('counts groups apart from outliers, and offers Auto (n) to return to the suggestion', () => {
  const onChange = vi.fn(),
    onAuto = vi.fn(),
    onGroup = vi.fn();
  const cuts = [
    { count: 2, groups: 2, outliers: 0 },
    { count: 3, groups: 2, outliers: 1 },
    { count: 4, groups: 1, outliers: 3 },
  ];
  toolbar({
    group: 'similarity:pattern-shape',
    onGroup,
    groupCount: { value: 4, max: 4, onChange, onAuto, suggested: 3, cuts, auto: false },
  });
  const group = screen.getByRole('combobox', { name: 'Group' });
  expect([...group.querySelectorAll('option')].find((o) => o.selected)!.textContent).toBe(
    'r · 1 group · +3 outliers',
  );
  const counts = group.querySelector('optgroup[label="Number of groups"]')!;
  expect([...counts.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    'Auto (2)',
    '2 groups',
    '2 groups + 1 outlier · suggested',
    '✓ 1 group + 3 outliers',
  ]);
  fireEvent.pointerDown(group);
  fireEvent.change(group, { target: { value: 'count:auto' } });
  expect(onAuto).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  expect(onGroup).not.toHaveBeenCalled();
});

it('says "auto" on the Group select while the count is the fit\'s suggestion', () => {
  const { rerender } = render(
    <MontageToolbar
      {...toolbarProps({
        group: 'similarity:pattern-shape',
        groupCount: { value: 2, max: 6, onChange: vi.fn(), title: 'Number of groups', auto: true },
      })}
    />,
  );
  const group = screen.getByRole('combobox', { name: 'Group' });
  expect([...group.querySelectorAll('option')].find((o) => o.selected)!.textContent).toBe(
    'r · 2 groups',
  );
  expect(group).toHaveAttribute('data-auto', 'true');
  expect(group).toHaveAccessibleDescription(/auto: the fit suggests 2/);
  rerender(
    <MontageToolbar
      {...toolbarProps({
        group: 'similarity:pattern-shape',
        groupCount: { value: 3, max: 6, onChange: vi.fn(), title: 'Number of groups', auto: false },
      })}
    />,
  );
  expect(group).not.toHaveAttribute('data-auto');
  expect(group).not.toHaveAccessibleDescription(/auto/);
  expect([...group.querySelectorAll('option')].find((o) => o.selected)!.textContent).toBe(
    'r · 3 groups',
  );
});

it('footer: transport and place only; what the grid shows is its tooltip and status', () => {
  const description =
    '2 groups · correlation distance · whole volume, unthresholded · 35 subjects · source order';
  render(
    <MontageFooter
      description={description}
      limit={0.0413}
      onLimit={vi.fn()}
      onFit={vi.fn()}
      transport={<span data-testid="transport">‹ ▷ › 26 / 35</span>}
    />,
  );
  const footer = screen.getByTestId('montage-footer');
  expect(footer).toHaveAttribute('title', description);
  expect(screen.getByRole('status')).toHaveTextContent(description);
  // Nothing of the description is on the line itself.
  expect(screen.queryByTestId('montage-footer-text')).toBeNull();
  const visible = [...footer.childNodes]
    .filter((node) => !(node instanceof HTMLElement && node.classList.contains('sr-only')))
    .map((node) => node.textContent)
    .join(' ');
  expect(visible).not.toMatch(/correlation distance|source order|subjects/);
  expect(screen.getByTestId('transport')).toHaveTextContent('26 / 35');
});

it('footer: the colour scale is a compact bar; its popover holds the limits, slider and Fit', () => {
  render(
    <MontageFooter description="x" limit={0.0413} onLimit={vi.fn()} onFit={vi.fn()} unit="z" />,
  );
  const popover = screen.getByTestId('montage-scale-popover').closest('details')!;
  const trigger = popover.querySelector('summary')!;
  // About 160 × 6 px, with ticks at −max, 0 and +max, a notch for the hidden band, and the unit.
  const bar = within(trigger).getByTestId('montage-scale-bar');
  expect(bar.parentElement!.style.width).toBe('160px');
  expect(bar.className).toContain('h-1.5');
  expect(trigger.querySelectorAll('[data-scale-tick]')).toHaveLength(3);
  expect(within(trigger).getByTestId('montage-scale-notch').style.width).toBe('10%');
  expect(trigger).toHaveTextContent('−0.0413');
  expect(trigger).toHaveTextContent('0.0413');
  expect(trigger).toHaveTextContent('z');
  // The limits, the slider and Fit are in the popover, not on the line.
  expect(popover.open).toBe(false);
  const panel = screen.getByTestId('montage-scale-popover');
  for (const name of ['Lower limit', 'Upper limit'])
    expect(panel.contains(screen.getByRole('spinbutton', { name }))).toBe(true);
  expect(panel.contains(screen.getByRole('slider', { name: 'Colour scale limit' }))).toBe(true);
  expect(panel.contains(screen.getByRole('button', { name: 'Fit scale to the data' }))).toBe(true);
  expect(screen.getByTestId('montage-scale-threshold')).toHaveTextContent(
    'Values between −0.00413 and 0.00413 are not drawn',
  );
  fireEvent.click(trigger);
  expect(popover.open).toBe(true);
});

/**
 * An estimate of the row's width at each step of narrowing, from what each
 * level shows (montageToolbarLayout) and IBM Plex Sans at 12 px (≈ 6.6 px a
 * character). Selects add 28 px of padding and chevron and stop at 176 px
 * (max-w-44); gaps are the row's 12 px. jsdom has no layout, so this is the
 * arithmetic the browser's measurement follows, not a measurement.
 */
function estimateRow(level: number, sortLabel: string, groupLabel: string, grouped: boolean) {
  const text = (s: string) => Math.ceil(s.length * 6.6);
  const select = (s: string) => Math.min(176, text(s) + 28);
  const layout = montageToolbarLayout(level);
  const word = (s: string) => (layout.fieldLabels ? text(s) + 6 : 0);
  // The reverse toggle sits 8 px from the select (gap 4 + ml-1, C5).
  const sort = word('Sort') + select(sortLabel) + 8 + 24;
  // Grouped by similarity, the count is in the Group select's own label (up to 224 px).
  const group =
    word('Group') +
    (grouped ? Math.min(224, text(`${groupLabel} · 3 groups`) + 28) : select(groupLabel));
  const slice =
    (layout.sliceLabel ? text('Slice') + 6 : 0) +
    select('Coronal') +
    6 +
    40 +
    // The readout is never given up.
    80;
  const tiles =
    layout.tileControl === 'slider' ? 96 + text('Tiles per row') : layout.tileControl === 'presets' ? 66 : 24;
  return sort + group + 1 + slice + tiles + 4 * 12;
}

it('at a 750 px centre pane, grouped and sorted by similarity, the slice readout stays', () => {
  const levels = [0, 1, 2, 3, 4, 5];
  // C5: Sort names the measure in words; the closed Group select uses its notation ("r · 3 groups").
  const short = levels.map((level) => estimateRow(level, 'Similarity · correlation', 'r', true));
  const long = levels.map((level) =>
    estimateRow(level, 'Similarity (correlation)', 'Similarity (correlation)', true),
  );
  // The earlier labels needed ~940 px for the full row and lost the readout at 750 px.
  expect(long[0]).toBeGreaterThan(900);
  measureToolbar(long, { width: 726 });
  const props = {
    sort: 'similarity:pattern-shape',
    group: 'similarity:pattern-shape',
    groupCount: { value: 3, max: 6, onChange: vi.fn() },
  };
  toolbar(props);
  expect(Number(screen.getByRole('group', { name: 'Montage' }).dataset.level)).toBeGreaterThanOrEqual(4);
  // Even then the readout keeps its value.
  expect(screen.getByTestId('montage-slice-readout')).not.toHaveClass('sr-only');
  cleanup();
  vi.restoreAllMocks();
  // The short labels: the full row is narrower, and at 726 px the readout survives.
  measureToolbar(short, { width: 726 });
  toolbar(props);
  const row = screen.getByRole('group', { name: 'Montage' });
  expect(Number(row.dataset.level)).toBeLessThanOrEqual(3);
  expect(screen.getByText('z −8.5 mm')).not.toHaveClass('sr-only');
  expect(
    [...screen.getByRole('combobox', { name: 'Sort' }).querySelectorAll('option')]
      .find((o) => o.selected)?.textContent,
  ).toBe('Similarity · correlation');
  expect(
    [...screen.getByRole('combobox', { name: 'Group' }).querySelectorAll('option')]
      .find((o) => o.selected)?.textContent,
  ).toBe('r · 3 groups');
});

it('measures again when a spinner or the group count joins the row', () => {
  const content = [700, 660, 600, 540, 480, 420];
  measureToolbar(content, { width: 726 });
  const props: Partial<MontageToolbarProps> = { sort: 'source', group: 'none' };
  const view = render(<MontageToolbar {...toolbarProps(props)} />);
  expect(screen.getByRole('group', { name: 'Montage' }).dataset.level).toBe('0');
  // A fit starts: the spinner (and later the count field) make the row wider.
  content.splice(0, content.length, 760, 740, 700, 640, 560, 480);
  view.rerender(<MontageToolbar {...toolbarProps({ ...props, sortBusy: true })} />);
  expect(screen.getByRole('group', { name: 'Montage' }).dataset.level).toBe('2');
});
