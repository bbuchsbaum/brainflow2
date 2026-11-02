import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorbarFit } from '../colorbarPlacement';
import {
  chooseColorbarHost,
  HOST_SETTLE_MS,
  useViewportFrameStore,
  type ColorbarHost,
  type FrameSlot,
} from '../viewportFrameStore';

const slot = (fit: ColorbarFit, room = 0, area = 100_000): FrameSlot => ({ fit, room, area });
const host = (plane: ColorbarHost['plane'], over: Partial<ColorbarHost> = {}): ColorbarHost => ({
  plane,
  fullSince: null,
  settledFull: false,
  ...over,
});

describe('colorbar host (QA 2026-10-31 N16)', () => {
  it('picks the view with the best margin: fit first, then margin, then size', () => {
    expect(
      chooseColorbarHost({
        axial: slot(ColorbarFit.Corner, 0, 900_000),
        coronal: slot(ColorbarFit.FullMargin, 20_000),
        sagittal: slot(ColorbarFit.FullMargin, 40_000),
      })?.plane,
    ).toBe('sagittal');
    expect(
      chooseColorbarHost({
        axial: slot(ColorbarFit.CompactMargin, 90_000),
        coronal: slot(ColorbarFit.FullMargin, 10_000),
      })?.plane,
    ).toBe('coronal');
    // Corners only: the largest view; axial on ties.
    expect(
      chooseColorbarHost({ axial: slot(ColorbarFit.Corner), coronal: slot(ColorbarFit.Corner) })
        ?.plane,
    ).toBe('axial');
    expect(chooseColorbarHost({})).toBeNull();
    expect(chooseColorbarHost({ axial: slot(ColorbarFit.None) })).toBeNull();
  });

  it('keeps the current host on small resizes (hysteresis)', () => {
    const current = host('axial', { fullSince: 0 });
    // Coronal's margin is now 20% larger: axial keeps the bar.
    expect(
      chooseColorbarHost(
        {
          axial: slot(ColorbarFit.FullMargin, 50_000),
          coronal: slot(ColorbarFit.FullMargin, 60_000),
        },
        current,
        100,
      )?.plane,
    ).toBe('axial');
    // Twice as large: coronal takes it.
    expect(
      chooseColorbarHost(
        {
          axial: slot(ColorbarFit.FullMargin, 50_000),
          coronal: slot(ColorbarFit.FullMargin, 100_000),
        },
        current,
        100,
      )?.plane,
    ).toBe('coronal');
  });

  it('a host that held a full margin keeps the bar when it narrows to a compact one', () => {
    // Full since t=0; narrowed at t=2000.
    const next = chooseColorbarHost(
      {
        axial: slot(ColorbarFit.CompactMargin, 20_000),
        sagittal: slot(ColorbarFit.FullMargin, 90_000),
      },
      host('axial', { fullSince: 0 }),
      2000,
    );
    expect(next?.plane).toBe('axial');
    expect(next?.settledFull).toBe(true);
    // Later updates while compact keep it there.
    expect(
      chooseColorbarHost(
        {
          axial: slot(ColorbarFit.CompactMargin, 18_000),
          sagittal: slot(ColorbarFit.FullMargin, 95_000),
        },
        next,
        9000,
      )?.plane,
    ).toBe('axial');
  });

  it('a full margin seen only briefly (start-up) does not lock the bar in (review W2)', () => {
    // Full at t=0, compact 50 ms later while coronal has a full margin.
    const next = chooseColorbarHost(
      {
        axial: slot(ColorbarFit.CompactMargin, 5_000),
        coronal: slot(ColorbarFit.FullMargin, 5_000),
      },
      host('axial', { fullSince: 0 }),
      50,
    );
    expect(next?.plane).toBe('coronal');
    // Compact for a while, then a full margin appears elsewhere: still moves.
    const compactHost = host('axial');
    expect(
      chooseColorbarHost(
        {
          axial: slot(ColorbarFit.CompactMargin, 5_000),
          coronal: slot(ColorbarFit.FullMargin, 5_000),
        },
        compactHost,
        HOST_SETTLE_MS * 10,
      )?.plane,
    ).toBe('coronal');
  });

  it('moves off a view whose bar would sit on the image', () => {
    expect(
      chooseColorbarHost(
        { axial: slot(ColorbarFit.Corner), coronal: slot(ColorbarFit.CompactMargin, 5_000) },
        host('axial', { settledFull: true }),
        100,
      )?.plane,
    ).toBe('coronal');
  });
});

describe('viewportFrameStore groups', () => {
  beforeEach(() => {
    useViewportFrameStore.setState({ slots: {}, hosts: {} });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('keeps a Studio view from overwriting the main views of the same plane', () => {
    const { setSlot } = useViewportFrameStore.getState();
    setSlot('main', 'axial', slot(ColorbarFit.FullMargin, 10_000));
    setSlot('main', 'coronal', slot(ColorbarFit.Corner));
    setSlot('studio', 'coronal', slot(ColorbarFit.FullMargin, 99_000));
    const { hosts } = useViewportFrameStore.getState();
    expect(hosts.main?.plane).toBe('axial');
    expect(hosts.studio?.plane).toBe('coronal');
  });

  it('follows a host through resizes and removal, and prunes empty groups', () => {
    const { setSlot } = useViewportFrameStore.getState();
    setSlot('main', 'axial', slot(ColorbarFit.FullMargin, 50_000));
    setSlot('main', 'sagittal', slot(ColorbarFit.FullMargin, 45_000));
    expect(useViewportFrameStore.getState().hosts.main?.plane).toBe('axial');
    // Settled, then axial narrows (~140 px): compact in its own margin, still the host.
    vi.advanceTimersByTime(HOST_SETTLE_MS + 100);
    setSlot('main', 'axial', slot(ColorbarFit.CompactMargin, 20_000));
    expect(useViewportFrameStore.getState().hosts.main?.plane).toBe('axial');
    // Axial unmounts: sagittal hosts.
    setSlot('main', 'axial', null);
    expect(useViewportFrameStore.getState().hosts.main?.plane).toBe('sagittal');
    // The last view goes: no entries left for the group.
    setSlot('main', 'sagittal', null);
    expect(useViewportFrameStore.getState().slots.main).toBeUndefined();
    expect(useViewportFrameStore.getState().hosts.main).toBeUndefined();
  });

  it('a host narrowed right after start-up hands the bar to the full view', () => {
    const { setSlot } = useViewportFrameStore.getState();
    setSlot('main', 'axial', slot(ColorbarFit.FullMargin, 50_000));
    setSlot('main', 'coronal', slot(ColorbarFit.FullMargin, 45_000));
    vi.advanceTimersByTime(30);
    setSlot('main', 'axial', slot(ColorbarFit.CompactMargin, 20_000));
    expect(useViewportFrameStore.getState().hosts.main?.plane).toBe('coronal');
  });
});
