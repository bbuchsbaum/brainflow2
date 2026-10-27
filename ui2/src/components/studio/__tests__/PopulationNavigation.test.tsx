import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PopulationNavigation } from '../PopulationNavigation';
afterEach(() => vi.useRealTimers());
it('waits for each completed image, pauses on scrubbing and cancels a pending dwell on unmount', () => {
  vi.useFakeTimers();
  const onFocus = vi.fn();
  const props = {
    ids: ['a', 'b', 'c'],
    focusedId: 'a',
    ready: true,
    failed: false,
    scope: 'one',
    label: 'Source order',
    onFocus,
  };
  const view = render(<PopulationNavigation {...props} />);
  fireEvent.click(screen.getByText('Play'));
  act(() => vi.advanceTimersByTime(200));
  expect(onFocus).toHaveBeenCalledWith('b');
  view.rerender(<PopulationNavigation {...props} focusedId="b" ready={false} />);
  act(() => vi.advanceTimersByTime(5000));
  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Buffering/)).toBeTruthy();
  view.rerender(<PopulationNavigation {...props} focusedId="b" />);
  act(() => vi.advanceTimersByTime(199));
  expect(onFocus).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(1));
  expect(onFocus).toHaveBeenLastCalledWith('c');
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Focus observation' }), { key: 'Home' });
  expect(screen.getByText('Play')).toBeTruthy();
  fireEvent.click(screen.getByText('Play'));
  view.unmount();
  const calls = onFocus.mock.calls.length;
  act(() => vi.advanceTimersByTime(1000));
  expect(onFocus).toHaveBeenCalledTimes(calls);
});
it('stops on a new context and leaves nested input shortcuts alone', () => {
  vi.useFakeTimers();
  const props = {
    ids: ['a', 'b'],
    focusedId: 'a',
    ready: true,
    failed: false,
    scope: 'one',
    label: 'Source order',
    onFocus: vi.fn(),
  };
  const view = render(<PopulationNavigation {...props} />);
  fireEvent.keyDown(screen.getByLabelText('Playback speed'), { key: ' ' });
  expect(screen.getByText('Play')).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText('Population navigation'), { key: ' ' });
  expect(screen.getByText('Pause')).toBeTruthy();
  view.rerender(<PopulationNavigation {...props} scope="two" />);
  expect(screen.getByText('Play')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  expect(props.onFocus).not.toHaveBeenCalled();
});
