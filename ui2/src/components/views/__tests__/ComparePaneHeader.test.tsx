import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComparePaneHeader } from '../ComparePaneHeader';
import { PANE_NAME_PREFERRED_PX, PANE_PICKER_MIN_PX, paneHeaderLayout } from '../comparePaneLayout';

/** QA features 2026-10-31 §6: a layer picker in every pane header; names never disappear. */
const options = [
  { id: 't1', name: 'MNI152NLin2009cAsym_T1w_1mm' },
  { id: 'z', name: 'sub-01_task-faces_zstat_long_name.nii.gz' },
];

describe('ComparePaneHeader', () => {
  it('names the pane’s layer in its picker, with the full name as a tooltip', () => {
    const onChoose = vi.fn();
    render(
      <ComparePaneHeader
        letter="A"
        plane="axial"
        positionMm={12.5}
        layerId="z"
        options={options}
        onChoose={onChoose}
        width={640}
        paneLabel="A, zstat"
      />,
    );
    const picker = screen.getByRole('combobox', { name: 'Layer of panel A, zstat' }) as HTMLSelectElement;
    expect(picker.value).toBe('z');
    expect(picker.title).toBe('sub-01_task-faces_zstat_long_name.nii.gz');
    expect(screen.getByTestId('compare-pane-position')).toHaveTextContent('z 12.5 mm');
    fireEvent.change(picker, { target: { value: 't1' } });
    expect(onChoose).toHaveBeenCalledWith('t1');
  });

  it('an empty pane asks for a layer', () => {
    render(
      <ComparePaneHeader letter="B" plane="axial" positionMm={0} layerId={null} options={options} onChoose={vi.fn()} width={300} paneLabel="B" />,
    );
    const picker = screen.getByRole('combobox', { name: 'Layer of panel B' }) as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(picker).toHaveTextContent('Choose a layer…');
  });

  it('drops the position before the name, at any width', () => {
    for (const width of [40, 120, 200, 320, 640, 1200]) {
      const { pickerMax } = paneHeaderLayout(width, -126.5, 'sagittal', true, [-130, 130]);
      expect(pickerMax).toBeGreaterThanOrEqual(PANE_PICKER_MIN_PX);
    }
    expect(paneHeaderLayout(120, -126.5, 'sagittal', true).position).toBeNull();
    expect(paneHeaderLayout(1200, -126.5, 'sagittal', true).position).toBe('x −126.5 mm');
    // Laid out for the widest position of the range: scrubbing never re-flows it.
    const narrowValue = paneHeaderLayout(330, 2, 'axial', true, [-130, 130]);
    const wideValue = paneHeaderLayout(330, -126.5, 'axial', true, [-130, 130]);
    expect(narrowValue.pickerMax).toBe(wideValue.pickerMax);
  });

  it('the name keeps its room first; the controls take the position’s (QA 2026-10-31 F7.3)', () => {
    // A 380 px pane with a value slot: the name gets at least ~14 characters.
    const plain = paneHeaderLayout(380, -126.5, 'axial', true, [-130, 130], { rightReservePx: 90 });
    expect(plain.pickerMax).toBeGreaterThanOrEqual(PANE_NAME_PREFERRED_PX);
    const hover = paneHeaderLayout(380, -126.5, 'axial', true, [-130, 130], { rightReservePx: 90, controlsPx: 112 });
    expect(hover.pickerMax).toBeGreaterThanOrEqual(PANE_NAME_PREFERRED_PX);
    expect(hover.trailingPx).toBeGreaterThanOrEqual(Math.min(112, 380 - 12 - 90 - 24 - PANE_NAME_PREFERRED_PX));
    // A narrow pane: controls clip; the name is never squeezed below its floor.
    const narrow = paneHeaderLayout(200, 0, 'axial', true, null, { controlsPx: 112 });
    expect(narrow.pickerMax).toBe(PANE_NAME_PREFERRED_PX);
    expect(narrow.trailingPx).toBe(200 - 12 - 24 - PANE_NAME_PREFERRED_PX);
  });
});
