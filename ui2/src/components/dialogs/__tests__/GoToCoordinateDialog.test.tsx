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
vi.mock('@/stores/layerStore', () => ({
  useLayerStore: (selector: any) => selector({ layers: [] }),
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
