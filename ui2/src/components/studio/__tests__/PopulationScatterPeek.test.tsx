import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PopulationRelationshipPanel } from '../PopulationRelationshipPanel';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import {
  populationRelationshipService,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import {
  populationRevisionKey,
  type PopulationPeekRaster,
  type PopulationSliceService,
} from '@/services/studio/PopulationSliceService';
import type { PopulationPeekTarget } from '@/services/studio/PopulationPeekService';
import { syntheticFit } from '@/services/studio/__tests__/relationshipFixtures';
import { PEEK_HOVER_DELAY_MS } from '../relationshipPresentation';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
class NoResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', NoResizeObserver);

const state = () => useSetStudioStore.getState();
const SOURCES = [{ memberId: 'sub001', revision: { sha256: 'a'.repeat(64) } }];

function raster(target: PopulationPeekTarget): PopulationPeekRaster {
  return {
    memberId: target.memberId,
    crosshairMm: [...target.crosshairMm],
    orientation: target.orientation,
    plane: {
      origin_mm: [0, 0, 0],
      u_mm: target.orientation === 'sagittal' ? [0, 1, 0] : [1, 0, 0],
      v_mm: target.orientation === 'axial' ? [0, 1, 0] : [0, 0, -1],
      dim_px: [2, 2],
    },
    values: [1, 2, null, 4],
    revisionKey: populationRevisionKey(SOURCES),
  };
}

/** A stand-in for the lens's slice owner: one displayed result and evaluatePeek. */
function fakeSlice(
  evaluate: (
    target: PopulationPeekTarget,
    signal: AbortSignal,
  ) => Promise<PopulationPeekRaster> = async (target) => raster(target),
) {
  const evaluatePeek = vi.fn(evaluate);
  const snapshot = {
    requested: null,
    pending: false,
    error: null,
    displayed: {
      query: { datasetKey: 'demo', request: { crosshairMm: [0, 0, 10], orientation: 'axial' } },
      data: { sources: SOURCES },
      effectLimit: 2,
    },
  };
  const service = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    evaluatePeek,
  } as unknown as PopulationSliceService;
  return { service, evaluatePeek };
}

async function setup(evaluate?: Parameters<typeof fakeSlice>[0]) {
  invoke.mockImplementation(async (command: string, args: { request: RelationshipRequest }) =>
    command === 'fit_population_relationship' ? syntheticFit(args.request) : undefined,
  );
  await act(async () => {
    await populationRelationshipService.fit('effect');
  });
  const slice = fakeSlice(evaluate);
  render(<PopulationRelationshipPanel sliceService={slice.service} />);
  return slice;
}
const point = (id: string) => screen.getByRole('button', { name: `Focus relationship ${id}` });
const peek = () => screen.queryByRole('dialog', { name: /^Preview of / });
const flush = () => act(async () => {});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
  invoke.mockReset();
});
afterEach(() => {
  cleanup();
  act(() => populationRelationshipService.resetScope(null));
  vi.useRealTimers();
});

describe('scatter hover peek', () => {
  it('opens after the hover delay without changing focus, and closes on leave', async () => {
    const { evaluatePeek } = await setup();
    const focus = state().selection.activeMemberId;
    const inspector = state().selection;
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS - 50);
    expect(peek()).toBeNull();
    expect(evaluatePeek).not.toHaveBeenCalled();
    advance(60);
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub002');
    expect(evaluatePeek).toHaveBeenCalledTimes(1);
    // Initialised from the shared slice.
    expect(evaluatePeek.mock.calls[0][0]).toEqual({
      memberId: 'sub002',
      crosshairMm: [0, 0, 10],
      orientation: 'axial',
    });
    // Hover never changes focus or the Inspector's selection.
    expect(state().selection.activeMemberId).toBe(focus);
    expect(state().selection).toBe(inspector);
    // The previewed point carries the transient preview mark, not the focus ring.
    expect(document.querySelector('[data-mark="preview"]')).not.toBeNull();
    fireEvent.pointerLeave(point('sub002'));
    advance(300);
    expect(peek()).toBeNull();
  });

  it('a quick pass over a point never opens the peek', async () => {
    const { evaluatePeek } = await setup();
    fireEvent.pointerEnter(point('sub002'));
    advance(80);
    fireEvent.pointerLeave(point('sub002'));
    advance(500);
    expect(peek()).toBeNull();
    expect(evaluatePeek).not.toHaveBeenCalled();
  });

  it('click focuses', async () => {
    await setup();
    fireEvent.click(point('sub005'));
    expect(state().selection.activeMemberId).toBe('sub005');
    expect(point('sub005')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(point('sub001'), { shiftKey: true });
    expect(state().selection.activeMemberId).toBe('sub005');
  });

  it('arrow keys move between points and preview them; Enter focuses; Escape closes', async () => {
    const { evaluatePeek } = await setup();
    // One tab stop, on the focused observation.
    expect(
      screen
        .getByRole('group', { name: 'Spatial MDS observations' })
        .querySelectorAll('circle[tabindex="0"]'),
    ).toHaveLength(1);
    expect(point('sub003')).toHaveAttribute('tabindex', '0');
    point('sub003').focus();
    fireEvent.keyDown(point('sub003'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(point('sub004'));
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub004');
    expect(state().selection.activeMemberId).toBe('sub003');
    fireEvent.keyDown(point('sub004'), { key: 'ArrowLeft' });
    fireEvent.keyDown(point('sub003'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(point('sub002'));
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub002');
    expect(evaluatePeek.mock.calls.map((c) => c[0].memberId)).toEqual([
      'sub004',
      'sub003',
      'sub002',
    ]);
    fireEvent.keyDown(point('sub002'), { key: 'Enter' });
    expect(state().selection.activeMemberId).toBe('sub002');
    fireEvent.keyDown(point('sub002'), { key: 'Escape' });
    expect(peek()).toBeNull();
  });

  it('the wheel over the peek changes only the peek slice; the plane switches', async () => {
    const { evaluatePeek } = await setup();
    const crosshair = useViewStateStore.getState().viewState.crosshair.world_mm;
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS);
    await flush();
    const image = within(peek()!).getByTestId('peek-image');
    fireEvent.wheel(image, { deltaY: -100 });
    await flush();
    fireEvent.wheel(image, { deltaY: -100 });
    await flush();
    expect(evaluatePeek.mock.calls.at(-1)![0].crosshairMm).toEqual([0, 0, 12]);
    expect(within(peek()!).getByTestId('peek-slice').textContent).toMatch(/^Axial · z 12/);
    const calls = evaluatePeek.mock.calls.length;
    fireEvent.wheel(image, { deltaY: 100 });
    await flush();
    // Back to z 11: a raster already peeked is served from the cache.
    expect(within(peek()!).getByTestId('peek-slice').textContent).toMatch(/^Axial · z 11/);
    expect(evaluatePeek).toHaveBeenCalledTimes(calls);
    // Shared state is untouched.
    expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual(crosshair);
    expect(state().selection.activeMemberId).toBe('sub003');
    fireEvent.click(within(peek()!).getByRole('radio', { name: 'Coronal' }));
    await flush();
    expect(evaluatePeek.mock.calls.at(-1)![0]).toMatchObject({
      memberId: 'sub002',
      orientation: 'coronal',
    });
  });

  it('pins open; pinned peeks ignore hover but follow keyboard steps; Escape and close unpin', async () => {
    await setup();
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS);
    await flush();
    fireEvent.click(within(peek()!).getByRole('button', { name: 'Pin preview' }));
    expect(peek()).toHaveAttribute('data-pinned', 'true');
    fireEvent.pointerLeave(point('sub002'));
    advance(1000);
    expect(peek()).toHaveAccessibleName('Preview of sub002');
    fireEvent.pointerEnter(point('sub005'));
    advance(1000);
    expect(peek()).toHaveAccessibleName('Preview of sub002');
    // Stepping between points keeps the pinned peek open.
    point('sub002').focus();
    fireEvent.keyDown(point('sub002'), { key: 'ArrowRight' });
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub003');
    expect(peek()).toHaveAttribute('data-pinned', 'true');
    fireEvent.keyDown(peek()!, { key: 'Escape' });
    expect(peek()).toBeNull();
    // Reopened unpinned; the close button also dismisses.
    fireEvent.pointerEnter(point('sub004'));
    advance(PEEK_HOVER_DELAY_MS);
    await flush();
    expect(peek()).not.toHaveAttribute('data-pinned');
    fireEvent.click(within(peek()!).getByRole('button', { name: 'Close preview' }));
    expect(peek()).toBeNull();
  });

  it('shows Open in viewer disabled with an explanation', async () => {
    await setup();
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS);
    await flush();
    const open = within(peek()!).getByRole('button', { name: 'Open in viewer' });
    expect(open).toHaveAttribute('aria-disabled', 'true');
    expect(open).toHaveAccessibleDescription(/Not available yet/);
    fireEvent.click(open);
    expect(peek()).not.toBeNull();
  });

  it('drops a response once the pointer has moved on and reuses cached rasters', async () => {
    const pending: { target: PopulationPeekTarget; signal: AbortSignal; resolve: () => void }[] =
      [];
    const { evaluatePeek } = await setup(
      (target, signal) =>
        new Promise((resolve) => {
          pending.push({ target, signal, resolve: () => resolve(raster(target)) });
        }),
    );
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS);
    fireEvent.pointerLeave(point('sub002'));
    fireEvent.pointerEnter(point('sub004'));
    advance(PEEK_HOVER_DELAY_MS);
    expect(pending.map((p) => p.target.memberId)).toEqual(['sub002', 'sub004']);
    expect(pending[0].signal.aborted).toBe(true);
    // The late sub002 response is ignored; the peek waits for sub004.
    pending[0].resolve();
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub004');
    expect(within(peek()!).getByText('Loading slice…')).toBeInTheDocument();
    pending[1].resolve();
    await flush();
    expect(within(peek()!).queryByText('Loading slice…')).toBeNull();
    // Back to sub004 after another point: served from the cache.
    fireEvent.pointerLeave(point('sub004'));
    fireEvent.pointerEnter(point('sub005'));
    advance(PEEK_HOVER_DELAY_MS);
    pending[2].resolve();
    await flush();
    fireEvent.pointerLeave(point('sub005'));
    fireEvent.pointerEnter(point('sub004'));
    advance(PEEK_HOVER_DELAY_MS);
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub004');
    expect(evaluatePeek).toHaveBeenCalledTimes(3);
  });

  it('coalesces a burst of wheel steps into at most two evaluations', async () => {
    const pending: (() => void)[] = [];
    const { evaluatePeek } = await setup(
      (target) =>
        new Promise((resolve) => {
          pending.push(() => resolve(raster(target)));
        }),
    );
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS);
    pending.shift()!();
    await flush();
    const before = evaluatePeek.mock.calls.length;
    const image = within(peek()!).getByTestId('peek-image');
    for (let i = 0; i < 20; i++) fireEvent.wheel(image, { deltaY: -100 });
    await flush();
    expect(evaluatePeek.mock.calls.length - before).toBe(1);
    // The label shows the slice on screen and the one being fetched.
    expect(within(peek()!).getByTestId('peek-slice').textContent).toMatch(/z 10.* → 30/);
    pending.shift()!();
    await flush();
    expect(evaluatePeek.mock.calls.length - before).toBe(2);
    expect(evaluatePeek.mock.calls.at(-1)![0].crosshairMm).toEqual([0, 0, 30]);
    pending.shift()!();
    await flush();
    expect(evaluatePeek.mock.calls.length - before).toBe(2);
    expect(within(peek()!).getByTestId('peek-slice').textContent).toMatch(/^Axial · z 30(\.0)? mm$/);
  });

  it('steps along the new plane after a plane switch, before its raster arrives', async () => {
    const { evaluatePeek } = await setup();
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS);
    await flush();
    fireEvent.click(within(peek()!).getByRole('radio', { name: 'Coronal' }));
    fireEvent.wheel(within(peek()!).getByTestId('peek-image'), { deltaY: -100 });
    await flush();
    await flush();
    expect(evaluatePeek.mock.calls.at(-1)![0]).toMatchObject({
      orientation: 'coronal',
      crosshairMm: [0, 1, 10],
    });
  });

  it('keeps an unpinned peek open when a click inside it blurs the point without a related target', async () => {
    await setup();
    point('sub003').focus();
    fireEvent.keyDown(point('sub003'), { key: 'ArrowRight' });
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub004');
    // WKWebView: pressing a button in the peek does not focus it.
    fireEvent.pointerDown(within(peek()!).getByRole('button', { name: 'Pin preview' }));
    fireEvent.blur(point('sub004'), { relatedTarget: null });
    expect(peek()).not.toBeNull();
    // Without the pointer in the peek, losing focus closes it.
    fireEvent.pointerLeave(peek()!);
    point('sub004').focus();
    fireEvent.blur(point('sub004'), { relatedTarget: null });
    expect(peek()).toBeNull();
  });

  it('offers keys on the point for pin, plane and slice, and links the point to its peek', async () => {
    const { evaluatePeek } = await setup();
    point('sub003').focus();
    fireEvent.keyDown(point('sub003'), { key: 'p' });
    await flush();
    expect(peek()).toHaveAccessibleName('Preview of sub003');
    expect(peek()).toHaveAttribute('data-pinned', 'true');
    expect(point('sub003')).toHaveAttribute('aria-describedby', peek()!.id);
    expect(point('sub004')).not.toHaveAttribute('aria-describedby');
    fireEvent.keyDown(point('sub003'), { key: 'c' });
    await flush();
    expect(evaluatePeek.mock.calls.at(-1)![0].orientation).toBe('coronal');
    fireEvent.keyDown(point('sub003'), { key: 'PageUp' });
    await flush();
    expect(evaluatePeek.mock.calls.at(-1)![0].crosshairMm).toEqual([0, 1, 10]);
    fireEvent.keyDown(point('sub003'), { key: 'PageDown' });
    fireEvent.keyDown(point('sub003'), { key: 'PageDown' });
    await flush();
    expect(evaluatePeek.mock.calls.at(-1)![0].crosshairMm).toEqual([0, -1, 10]);
    fireEvent.keyDown(point('sub003'), { key: 'P' });
    expect(peek()).not.toHaveAttribute('data-pinned');
    // Only the slice position is a live region; the pointer readout is not.
    expect(within(peek()!).getByTestId('peek-slice')).toHaveAttribute('role', 'status');
    expect(within(peek()!).getByText('Point at the image for its value')).toHaveAttribute(
      'aria-live',
      'off',
    );
    expect(screen.getByText(/P pins the preview/)).toBeInTheDocument();
  });

  it('drops a raster read from other source revisions than the lens shows', async () => {
    await setup(async (target) => ({ ...raster(target), revisionKey: 'other' }));
    fireEvent.pointerEnter(point('sub002'));
    advance(PEEK_HOVER_DELAY_MS);
    await flush();
    expect(within(peek()!).getByText(/sources changed since the lens read them/)).toBeInTheDocument();
  });
});
