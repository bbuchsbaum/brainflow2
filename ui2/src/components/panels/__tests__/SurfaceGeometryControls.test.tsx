import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceGeometryControls } from '@/components/panels/SurfaceGeometryControls';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { LIGHTING_PRESETS } from '@/utils/surfaceAppearancePresets';

const VIEW = 'surface-view-1';

describe('SurfaceGeometryControls', () => {
  const original = useSurfaceStore.getState();
  let lighting: ReturnType<typeof vi.fn>;
  let display: ReturnType<typeof vi.fn>;
  let material: ReturnType<typeof vi.fn>;
  let projection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    lighting = vi.fn();
    display = vi.fn();
    material = vi.fn();
    projection = vi.fn();
    useSurfaceStore.setState({
      updateSurfaceViewLightingSettings: lighting,
      updateSurfaceViewDisplaySettings: display,
      updateSurfaceViewMaterialSettings: material,
      updateSurfaceViewProjectionSettings: projection,
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    useSurfaceStore.setState(original, true);
  });

  it('writes the light position from the segmented control', () => {
    render(<SurfaceGeometryControls surfaceViewId={VIEW} />);
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Top' }));
    expect(lighting).toHaveBeenCalledWith(VIEW, { lightPosition: [0, 100, 0] });
  });

  it('applies a lighting preset', () => {
    render(<SurfaceGeometryControls surfaceViewId={VIEW} />);
    const preset = LIGHTING_PRESETS[0];
    fireEvent.click(screen.getByRole('button', { name: preset.name }));
    expect(lighting).toHaveBeenCalledWith(VIEW, preset.values);
  });

  it('debounces slider writes by 120 ms and flushes a pending write on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(<SurfaceGeometryControls surfaceViewId={VIEW} />);
    const ambient = screen.getByRole('slider', { name: 'Ambient' });
    const start = Number(ambient.getAttribute('aria-valuenow'));

    fireEvent.keyDown(ambient, { key: 'ArrowRight' });
    expect(lighting).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(lighting).toHaveBeenCalledTimes(1);
    const [id, partial] = lighting.mock.calls[0];
    expect(id).toBe(VIEW);
    expect(partial.ambientLightIntensity).toBeGreaterThan(start);

    fireEvent.keyDown(ambient, { key: 'ArrowRight' });
    unmount();
    expect(lighting).toHaveBeenCalledTimes(2);
  });

  it('keeps collapsed sections reachable and wires their switches', () => {
    render(<SurfaceGeometryControls surfaceViewId={VIEW} />);
    fireEvent.click(screen.getByRole('button', { name: /Appearance/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Wireframe' }));
    expect(display).toHaveBeenCalledWith(VIEW, { wireframe: true });

    fireEvent.click(screen.getByRole('button', { name: /Volume projection/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'GPU mode' }));
    expect(projection).toHaveBeenCalledWith(VIEW, { useGPUProjection: expect.any(Boolean) });
  });
});
