import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNumericInputGuard } from '@/utils/numericInput';

const setCrosshair = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: (selector: any) =>
    selector({
      viewState: { crosshair: { world_mm: [10, -18.5, 17.5] } },
      setCrosshair,
    }),
}));
const layerState = vi.hoisted(() => ({ current: { layers: [] as any[], layerMetadata: new Map<string, any>() } }));
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
    set('X (voxel index)', '45');
    set('Y (voxel index)', '63');
    set('Z (voxel index)', '54');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([0, 0, 36], true));
  });

  it('an index outside the volume warns (not invalid), keeps Go enabled and is not clamped', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    set('X (voxel index)', '0');
    set('Y (voxel index)', '0');
    set('Z (voxel index)', '120');
    const z = screen.getByLabelText('Z (voxel index)');
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
    expect((screen.getByLabelText('X (voxel index)') as HTMLInputElement).value).toBe('40');
    expect((screen.getByLabelText('Y (voxel index)') as HTMLInputElement).value).toBe('54');
    expect((screen.getByLabelText('Z (voxel index)') as HTMLInputElement).value).toBe('45');
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
    expect(val('X (voxel index)')).toBe('40');
    expect(val('Y (voxel index)')).toBe('73');
    expect(val('Z (voxel index)')).toBe('51');
  });

  it('Voxel -> World converts the typed indices to their voxel centre in mm', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    toVoxel();
    set('X (voxel index)', '45');
    set('Y (voxel index)', '63');
    set('Z (voxel index)', '54');
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
    expect(val('X (voxel index)')).toBe('39'); // (11.3 - 90) / -2 = 39.35
    fireEvent.click(screen.getByRole('radio', { name: 'World (mm)' }));
    expect([val('X (mm)'), val('Y (mm)'), val('Z (mm)')]).toEqual(['11.3', '20', '30']);
    toVoxel();
    expect(val('X (voxel index)')).toBe('39');
  });

  it('after an edit, switching back converts the edited indices (voxel centre)', async () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '11.3');
    set('Y (mm)', '20');
    set('Z (mm)', '30');
    toVoxel();
    set('X (voxel index)', '40');
    fireEvent.click(screen.getByRole('radio', { name: 'World (mm)' }));
    expect([val('X (mm)'), val('Y (mm)'), val('Z (mm)')]).toEqual(['10', '20', '30']);
    toVoxel();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(setCrosshair).toHaveBeenCalledWith([10, 20, 30], true));
  });

  it('empty or invalid fields are left as typed; valid ones still convert', () => {
    render(<GoToCoordinateDialog open onClose={() => {}} />);
    set('X (mm)', '');
    set('Y (mm)', '20');
    // A refused paste marks Z invalid (its text stays "17.5").
    paste(screen.getByLabelText('Z (mm)'), '30 mm up');
    toVoxel();
    expect(val('X (voxel index)')).toBe('');
    expect(val('Y (voxel index)')).toBe('73');
    expect(val('Z (voxel index)')).toBe('17.5');
    expect(screen.getByLabelText('Z (voxel index)')).toHaveAttribute('aria-invalid', 'true');
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
    expect([val('X (voxel index)'), val('Y (voxel index)'), val('Z (voxel index)')]).toEqual(['-19', '-2', '2']);
    // (Index -19 is also outside the volume: a second status, the warning.)
    expect(screen.getAllByRole('status').map(n => n.textContent)).toContain('Empty Y taken from the crosshair.');
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
    expect((screen.getByLabelText('X (voxel index)') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('radio', { name: 'World (mm)' }));
    expect((screen.getByLabelText('X (mm)') as HTMLInputElement).value).toBe('12');
    layerState.current = { layers: [], layerMetadata: new Map() };
  });
});
