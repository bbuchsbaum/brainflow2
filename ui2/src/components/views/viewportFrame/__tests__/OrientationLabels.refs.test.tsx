import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrientationLabels } from '../OrientationLabels';

const axial = { origin_mm: [-90, 90, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [180, 216] } as never;

describe('OrientationLabels refs (crosshair knockouts)', () => {
  it('keeps the letter refs attached across re-renders (never detached to null)', () => {
    const writes: Array<HTMLElement | null> = [];
    const store: Array<HTMLElement | null> = [];
    const refs = {
      current: new Proxy(store, {
        set(target, key, value) {
          if (key === '0') writes.push(value);
          (target as unknown as Record<string, unknown>)[key as string] = value;
          return true;
        },
      }),
    };
    const { rerender } = render(<OrientationLabels viewPlane={axial} refs={refs} />);
    rerender(<OrientationLabels viewPlane={axial} refs={refs} topInset={2} />);
    rerender(<OrientationLabels viewPlane={axial} refs={refs} topInset={4} />);
    // Attached once; a re-render does not detach it (a detach is what let the
    // canvas draw before the letters were back).
    expect(writes.filter((w) => w === null)).toHaveLength(0);
    expect(refs.current[0]?.textContent).toBe('A');
  });
});
