import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNumericInputGuard } from '@/utils/numericInput';

const setCrosshair = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: (selector: any) =>
    selector({
      viewState: { crosshair: { world_mm: [10, -18.5, 17.5] }, layers: layerState.current.viewLayers ?? [] },
      setCrosshair,
    }),
}));
const layerState = vi.hoisted(() => ({
  current: { layers: [] as any[], layerMetadata: new Map<string, any>() } as {
    layers: any[];
    layerMetadata: Map<string, any>;
    selectedLayerId?: string;
    viewLayers?: any[];
  },
}));
vi.mock('@/stores/layerStore', () => ({
  useLayerStore: (selector: any) => selector(layerState.current),
}));
vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ getVolumeBounds: vi.fn(async () => null) }),
}));

import { GoToCoordinateDialog } from '../GoToCoordinateDialog';

const paste = (el: HTMLElement, text: string) =>
  fireEvent.paste(el, { clipboardData: { getData: () => text } });

describe('GoToCoordinateDialog: pasted display numbers keep their sign', () => {
  let uninstall: () => void;
  beforeEach(() => {
    setCrosshair.mockClear();
    uninstall = installNumericInputGuard(document);
  });
  afterEach(() => uninstall());

  it('coordinate fields reach the DOM with autocorrect, autocapitalize and spellcheck off', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    for (const label of ['X (mm)', 'Y (mm)', 'Z (mm)']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('autocorrect', 'off');
      expect(input).toHaveAttribute('autocapitalize', 'off');
      expect(input).toHaveAttribute('spellcheck', 'false');
    }
  });

  it('pasting "−37.5" (U+2212, as the status bar shows it) into X goes to x = -37.5', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    const x = screen.getByLabelText('X (mm)') as HTMLInputElement;
    paste(x, '−37.5');
    expect(x.value).toBe('-37.5');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([-37.5, -18.5, 17.5], true));
  });

  it.each(['–', '‒', '﹣', '－'])('accepts %j as a minus', async (dash) => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    const z = screen.getByLabelText('Z (mm)') as HTMLInputElement;
    paste(z, `${dash}4`);
    expect(z.value).toBe('-4');
  });

  it('pasting the status-bar triple fills X, Y and Z', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    const y = screen.getByLabelText('Y (mm)') as HTMLInputElement;
    paste(y, '(−37.5, −18.5, 17.5)');
    expect((screen.getByLabelText('X (mm)') as HTMLInputElement).value).toBe('-37.5');
    expect(y.value).toBe('-18.5');
    expect((screen.getByLabelText('Z (mm)') as HTMLInputElement).value).toBe('17.5');
  });

  it('an unparseable paste shows the invalid state and disables Go, never another number', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    const x = screen.getByLabelText('X (mm)') as HTMLInputElement;
    paste(x, '37.5 mm left');
    expect(x.value).toBe('10.0');
    expect(x).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Pasted X is not a number.');
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    // Editing the field clears it.
    fireEvent.change(x, { target: { value: '-37.5' } });
    expect(x).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled();
  });
});

describe('GoToCoordinateDialog: voxel mode converts through the reference affine', () => {
  // Non-identity, axis-flipped affine (column-major, as the backend sends it):
  // x = -2 i + 90, y = 2 j - 126, z = 2 k - 72.
  const voxelToWorld = [-2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 90, -126, -72, 1];
  const worldToVoxel = [-0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 45, 63, 36, 1];
  let uninstall: () => void;
  beforeEach(() => {
    setCrosshair.mockClear();
    uninstall = installNumericInputGuard(document);
    layerState.current = {
      layers: [{ id: 'mni', volumeId: 'vol-mni' }],
      layerMetadata: new Map([['mni', { voxelToWorld, worldToVoxel, dimensions: [91, 109, 91] }]]),
    };
  });
  afterEach(() => {
    uninstall();
    layerState.current = { layers: [], layerMetadata: new Map() };
  });

  const toVoxel = () => fireEvent.click(screen.getByRole('radio', { name: 'Voxel' }));
  const set = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('typed voxel indices go to the voxel centre in world mm, not to the indices as mm', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    set('i (voxel index)', '45');
    set('j (voxel index)', '63');
    set('k (voxel index)', '54');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([0, 0, 36], true));
  });

  it('an index outside the volume warns (not invalid), keeps Go enabled and is not clamped', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    set('i (voxel index)', '0');
    set('j (voxel index)', '0');
    set('k (voxel index)', '120');
    const z = screen.getByLabelText('k (voxel index)');
    expect(z).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('status')).toHaveTextContent('Voxel index is outside the volume.');
    expect(z.getAttribute('aria-describedby')).toContain('goto-oob');
    const go = screen.getByRole('button', { name: 'Go' });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([90, -126, 168], true));
  });

  it('Current fills the crosshair voxel index', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    fireEvent.click(screen.getByRole('button', { name: 'Current' }));
    // crosshair (10, -18.5, 17.5) -> (40, 53.75, 44.75) -> rounded.
    expect((screen.getByLabelText('i (voxel index)') as HTMLInputElement).value).toBe('40');
    expect((screen.getByLabelText('j (voxel index)') as HTMLInputElement).value).toBe('54');
    expect((screen.getByLabelText('k (voxel index)') as HTMLInputElement).value).toBe('45');
  });

  it('without an affine, voxel mode cannot navigate (Go disabled, explained)', () => {
    layerState.current = { layers: [{ id: 'mni', volumeId: 'vol-mni' }], layerMetadata: new Map() };
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('voxel-to-world');
  });

  it('footer: Cancel is secondary, left of the primary Go', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const go = screen.getByRole('button', { name: 'Go' });
    expect(cancel.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

  it('World -> Voxel converts the typed mm to the nearest voxel indices (integers)', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '11'); // i = (11 - 90) / -2 = 39.5 -> 40
    set('Y (mm)', '20'); // j = (20 + 126) / 2 = 73
    set('Z (mm)', '30.4'); // k = (30.4 + 72) / 2 = 51.2 -> 51
    toVoxel();
    expect(val('i (voxel index)')).toBe('40');
    expect(val('j (voxel index)')).toBe('73');
    expect(val('k (voxel index)')).toBe('51');
  });

  it('Voxel -> World converts the typed indices to their voxel centre in mm', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    set('i (voxel index)', '45');
    set('j (voxel index)', '63');
    set('k (voxel index)', '54');
    fireEvent.click(screen.getByRole('radio', { name: 'World (mm)' }));
    expect(val('X (mm)')).toBe('0');
    expect(val('Y (mm)')).toBe('0');
    expect(val('Z (mm)')).toBe('36');
  });

  it('switching straight back without an edit restores the exact typed text', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '11.3');
    set('Y (mm)', '20');
    set('Z (mm)', '30');
    toVoxel();
    expect(val('i (voxel index)')).toBe('39'); // (11.3 - 90) / -2 = 39.35
    fireEvent.click(screen.getByRole('radio', { name: 'World (mm)' }));
    expect([val('X (mm)'), val('Y (mm)'), val('Z (mm)')]).toEqual(['11.3', '20', '30']);
    toVoxel();
    expect(val('i (voxel index)')).toBe('39');
  });

  it('after an edit, switching back converts the edited indices (voxel centre)', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '11.3');
    set('Y (mm)', '20');
    set('Z (mm)', '30');
    toVoxel();
    set('i (voxel index)', '40');
    fireEvent.click(screen.getByRole('radio', { name: 'World (mm)' }));
    expect([val('X (mm)'), val('Y (mm)'), val('Z (mm)')]).toEqual(['10', '20', '30']);
    toVoxel();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([10, 20, 30], true));
  });

  it('empty fields stay empty, invalid ones are cleared, valid ones convert (QA 2026-10-30 F42)', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '');
    set('Y (mm)', '20');
    // A refused paste marks Z invalid (its text stays "17.5").
    paste(screen.getByLabelText('Z (mm)'), '30 mm up');
    toVoxel();
    expect(val('i (voxel index)')).toBe('');
    expect(val('j (voxel index)')).toBe('73');
    // Never carried into voxel space under the other unit.
    expect(val('k (voxel index)')).toBe('');
    expect(screen.getByLabelText('k (voxel index)')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('World Z was not a number and was cleared.')).toBeInTheDocument();
  });

  it('names voxel fields i, j, k without a unit', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    expect(screen.getByText('i')).toBeInTheDocument();
    expect(screen.getByText('k')).toBeInTheDocument();
    expect(screen.queryByText('vox')).toBeNull();
  });
});

describe('GoToCoordinateDialog: Enter submits only from the fields', () => {
  beforeEach(() => {
    setCrosshair.mockClear();
    layerState.current = { layers: [], layerMetadata: new Map() };
  });

  it('Enter in a coordinate field runs Go', async () => {
    const onClose = vi.fn();
    render(<GoToCoordinateDialog open onClose={onClose} />);
    const x = screen.getByLabelText('X (mm)');
    fireEvent.change(x, { target: { value: '12' } });
    fireEvent.keyDown(x, { key: 'Enter' });
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([12, -18.5, 17.5], true));
    expect(onClose).toHaveBeenCalled();
  });

  it('the coordinate controls sit in a form whose submit button is Go', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    const go = screen.getByRole('button', { name: 'Go' });
    expect(go).toHaveAttribute('type', 'submit');
    expect(go.closest('form')).toContainElement(screen.getByLabelText('X (mm)'));
    for (const name of ['Cancel', 'Current']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('type', 'button');
    }
  });

  it('Enter on Cancel cancels: no navigation', async () => {
    const onClose = vi.fn();
    render(<GoToCoordinateDialog open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('X (mm)'), { target: { value: '12' } });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Enter' });
    // A browser turns Enter on a button into its click.
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 0));
    expect(setCrosshair).not.toHaveBeenCalled();
  });

  it('Enter on a space radio or on the dialog body does not run Go', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'World (mm)' }), { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await new Promise(r => setTimeout(r, 0));
    expect(setCrosshair).not.toHaveBeenCalled();
  });
});

describe('GoToCoordinateDialog: oblique affine and partial fields', () => {
  // A 90-degree in-plane rotation (column-major): world = (10 - 2j, 20 + 2i, 30 + 2k).
  const voxelToWorld = [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1];
  const worldToVoxel = [0, -0.5, 0, 0, 0.5, 0, 0, 0, 0, 0, 0.5, 0, -10, 5, -15, 1];
  let uninstall: () => void;
  beforeEach(() => {
    setCrosshair.mockClear();
    uninstall = installNumericInputGuard(document);
    layerState.current = {
      layers: [{ id: 'obl', volumeId: 'vol-obl' }],
      layerMetadata: new Map([['obl', { voxelToWorld, worldToVoxel, dimensions: [64, 64, 64] }]]),
    };
  });
  afterEach(() => {
    uninstall();
    layerState.current = { layers: [], layerMetadata: new Map() };
  });
  const set = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

  it('an empty field takes the crosshair value so every axis converts (and says so)', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '14');
    set('Y (mm)', ''); // crosshair y = -18.5
    set('Z (mm)', '34');
    fireEvent.click(screen.getByRole('radio', { name: 'Voxel' }));
    // i = (y - 20) / 2 = -19.25 -> -19; j = (10 - x) / 2 = -2; k = (z - 30) / 2 = 2
    expect([val('i (voxel index)'), val('j (voxel index)'), val('k (voxel index)')]).toEqual(['-19', '-2', '2']);
    // (Index -19 is also outside the volume: a second status, the warning.)
    expect(screen.getAllByRole('status').map(n => n.textContent)).toContain('Empty world Y taken from the crosshair.');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([14, -18, 34], true));
  });

  it('an unparseable field blocks the switch: the label never changes under old numbers', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '14');
    paste(screen.getByLabelText('Y (mm)'), 'twelve');
    fireEvent.click(screen.getByRole('radio', { name: 'Voxel' }));
    expect(screen.getByRole('radio', { name: 'World (mm)' })).toHaveAttribute('aria-checked', 'true');
    expect(val('X (mm)')).toBe('14');
    expect(screen.getByRole('status')).toHaveTextContent('Fix Y before switching the coordinate space.');
  });

  it('the form does not repeat the dialog name', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const form = screen.getByLabelText('X (mm)').closest('form')!;
    expect(form).not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('GoToCoordinateDialog: no affine', () => {
  it('switching to Voxel clears the mm values (never relabelled) and switching back restores them', () => {
    layerState.current = { layers: [{ id: 'mni', volumeId: 'vol-mni' }], layerMetadata: new Map() };
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('X (mm)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Voxel' }));
    expect((screen.getByLabelText('i (voxel index)') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('radio', { name: 'World (mm)' }));
    expect((screen.getByLabelText('X (mm)') as HTMLInputElement).value).toBe('12');
    layerState.current = { layers: [], layerMetadata: new Map() };
  });
});

describe('GoToCoordinateDialog focus return', () => {
  it('returns focus to the element that was focused when it opened', async () => {
    const { fireEvent } = await import('@testing-library/react');
    function Host() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Crosshair
          </button>
          <GoToCoordinateDialog open={open} onClose={() => setOpen(false)} />
        </>
      );
    }
    render(<Host />);
    const invoker = screen.getByRole('button', { name: 'Crosshair' });
    invoker.focus();
    fireEvent.click(invoker);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(invoker);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });
});

describe('GoToCoordinateDialog: voxel indices are on the selected layer\u2019s grid', () => {
  // T1 2 mm (reference) and zstat1 3 mm with another origin.
  const t1 = {
    voxelToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -95.5, -131.5, -77.5, 1],
    worldToVoxel: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 47.75, 65.75, 38.75, 1],
    dimensions: [96, 114, 96],
  };
  const z = {
    voxelToWorld: [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, -90, -126, -72, 1],
    worldToVoxel: [1 / 3, 0, 0, 0, 0, 1 / 3, 0, 0, 0, 0, 1 / 3, 0, 30, 42, 24, 1],
    dimensions: [61, 73, 61],
  };
  beforeEach(() => {
    setCrosshair.mockClear();
    layerState.current = {
      layers: [
        { id: 't1', name: 'T1.nii.gz', volumeId: 't1' },
        { id: 'z', name: 'zstat1.nii.gz', volumeId: 'z' },
      ],
      layerMetadata: new Map([
        ['t1', t1],
        ['z', z],
      ]),
      selectedLayerId: 'z',
      viewLayers: [
        { id: 't1', name: 'T1', visible: true },
        { id: 'z', name: 'zstat1', visible: true },
      ],
    };
  });
  afterEach(() => {
    layerState.current = { layers: [], layerMetadata: new Map() };
  });

  it('names the grid, fills Current on it and goes to its voxel centre without re-snapping', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Voxel' }));
    expect(screen.getByTestId('goto-grid')).toHaveTextContent('ijk on the grid of zstat1');
    fireEvent.click(screen.getByRole('button', { name: 'Current' }));
    // Crosshair (10, −18.5, 17.5) on the 3 mm grid: (33.33, 35.83, 29.83) -> 33, 36, 30.
    expect(screen.getByLabelText('i (voxel index)')).toHaveValue(33);
    expect(screen.getByLabelText('j (voxel index)')).toHaveValue(36);
    expect(screen.getByLabelText('k (voxel index)')).toHaveValue(30);
    fireEvent.change(screen.getByLabelText('i (voxel index)'), { target: { value: '23' } });
    fireEvent.change(screen.getByLabelText('j (voxel index)'), { target: { value: '41' } });
    fireEvent.change(screen.getByLabelText('k (voxel index)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() =>
      expect(setCrosshair).toHaveBeenCalledWith([-21, -3, 18], true, false, undefined, { snap: false }),
    );
  });
});
