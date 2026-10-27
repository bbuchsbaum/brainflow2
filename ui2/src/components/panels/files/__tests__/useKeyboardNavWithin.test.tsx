import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KBD_NAV_ATTR, useKeyboardNavWithin } from '../useKeyboardNavWithin';

function Harness() {
  const ref = useKeyboardNavWithin();
  return (
    <div>
      <button type="button">outside</button>
      <div ref={ref} data-testid="container">
        <div role="treeitem" tabIndex={0} aria-selected="false">
          row a
        </div>
        <div role="treeitem" tabIndex={0} aria-selected="false">
          row b
        </div>
      </div>
    </div>
  );
}

describe('useKeyboardNavWithin', () => {
  it('stays unset when focus is parked without keyboard use inside', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    // A keydown elsewhere (e.g. a global shortcut on window) must not light it.
    fireEvent.keyDown(window, { key: 'c' });
    screen.getByText('row a').focus();
    expect(container.hasAttribute(KBD_NAV_ATTR)).toBe(false);
  });

  it('sets on a keydown inside the container and clears on pointerdown', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    const row = screen.getByText('row a');
    row.focus();
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(container.getAttribute(KBD_NAV_ATTR)).toBe('true');
    fireEvent.pointerDown(document.body);
    expect(container.hasAttribute(KBD_NAV_ATTR)).toBe(false);
  });

  it('ignores bare modifier presses', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    fireEvent.keyDown(screen.getByText('row a'), { key: 'Shift' });
    expect(container.hasAttribute(KBD_NAV_ATTR)).toBe(false);
  });

  it('sets when focus arrives by Tab and clears when focus leaves', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    const outside = screen.getByText('outside');
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    screen.getByText('row a').focus();
    expect(container.getAttribute(KBD_NAV_ATTR)).toBe('true');
    outside.focus();
    expect(container.hasAttribute(KBD_NAV_ATTR)).toBe(false);
  });
});
